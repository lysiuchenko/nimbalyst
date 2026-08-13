import type { Flow } from '../schema/types';
import { DagFlowRunner } from './dagExecutor';
import {
  createAgentExecutor,
  createFanOutExecutor,
  createHumanGateExecutor,
  createShellExecutor,
  createWriteFileExecutor,
  createSkillExecutor,
  createSlashCommandExecutor,
} from './executors';
import type { AgentClient, GateController, ShellClient } from './ports';
import { RunStore, type RunFileWriter, type RunRecord } from './runStore';
import { planResume, planRunFrom } from './resume';
import { safeWorkspacePath } from './safeWorkspacePath';
import type { NodeExecutor } from './types';

/**
 * The rehearsal's write-file: same path guard, honest output, no write. The
 * real executor's "wrote X" over a no-op writer would be a claim about a
 * write that never happened.
 */
const dryWriteFileExecutor: NodeExecutor = async (context) => {
  const target = safeWorkspacePath(context.resolved.path ?? '');
  const content = context.resolved.content ?? '';
  return { output: `[dry-run] would write ${target} (${content.length} characters)` };
};
import type { RunOptions } from './types';

export interface FlowRunDependencies {
  agent: AgentClient;
  gate: GateController;
  shell?: ShellClient;
  writer: RunFileWriter;
  /** Executables shell nodes may run. Omitted means shell nodes are disabled. */
  allowlist?: readonly string[];
}

/** A shell client that refuses everything, for hosts with no backend module. */
const NO_SHELL: ShellClient = {
  run: async () => {
    throw new Error('shell nodes are not available: this host has no shell backend');
  },
};

/**
 * Run a flow and keep its record on disk.
 *
 * This is the one place the executor, the per-type executors, and the run
 * record are wired together. The record is rewritten on every node transition,
 * so a run that is interrupted — or one still waiting at a gate — still leaves
 * a complete picture of what ran, which sessions it created, and what it cost.
 */
export async function runFlow(
  flow: Flow,
  flowPath: string,
  dependencies: FlowRunDependencies,
  options: RunOptions & { resumeFrom?: RunRecord; startAt?: string; dryRun?: boolean } = {}
): Promise<RunRecord> {
  // Dry runs persist nothing: one no-op writer removes both the run record
  // and every artifact, and the write-file executor below is swapped so its
  // output says "would write" instead of claiming a write that never happened.
  const writer: RunFileWriter = options.dryRun
    ? { write: async () => {} }
    : dependencies.writer;
  const store = new RunStore(writer, flowPath, flow.manualBaselineMinutes);

  // Two ways to carry a previous run in as seeds: `resumeFrom` alone re-runs
  // what did not finish (`planResume` decides what is still trustworthy);
  // with `startAt`, the user draws the boundary — run from that node down,
  // seed everything above it.
  const { resumeFrom, startAt, dryRun: _dryRun, ...runOptions } = options;
  const plan = resumeFrom
    ? startAt !== undefined
      ? planRunFrom(flow, resumeFrom, startAt)
      : planResume(flow, resumeFrom)
    : undefined;
  const seed = plan
    ? {
        executions: Object.fromEntries(plan.reused),
        outputs: plan.outputs,
        resumedFrom: plan.resumedFrom,
      }
    : undefined;
  const runner = new DagFlowRunner({
    executors: {
      agent: createAgentExecutor(dependencies.agent),
      'fan-out': createFanOutExecutor(dependencies.agent),
      'slash-command': createSlashCommandExecutor(dependencies.agent),
      skill: createSkillExecutor(dependencies.agent),
      shell: createShellExecutor(dependencies.shell ?? NO_SHELL, {
        allowlist: dependencies.allowlist ?? [],
      }),
      'human-gate': createHumanGateExecutor(dependencies.gate),
      // Same writer the run record uses: a flow that can record itself can
      // already write a file, so this needs no extra host capability.
      'write-file': options.dryRun
        ? dryWriteFileExecutor
        : createWriteFileExecutor(dependencies.writer),
    },
    defaultExecutor: async ({ node }) => {
      throw new Error(`no executor for node type ${JSON.stringify(node.type)}`);
    },
  });

  // Writes are queued rather than awaited inline so a slow disk cannot stall
  // the run, while still landing in order.
  let pending = Promise.resolve();
  const persist = (state: Parameters<NonNullable<RunOptions['onStateChange']>>[0]) => {
    const snapshot = structuredClone(state);
    pending = pending.then(() => store.save(snapshot)).then(() => undefined);
  };

  const state = await runner.run(flow, {
    ...runOptions,
    ...(seed ? { seed } : {}),
    onStateChange: (current) => {
      persist(current);
      options.onStateChange?.(current);
    },
  });

  await pending;
  return store.save(state);
}
