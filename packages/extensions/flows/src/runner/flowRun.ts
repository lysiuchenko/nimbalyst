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
import { planResume } from './resume';
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
  options: RunOptions & { resumeFrom?: RunRecord } = {}
): Promise<RunRecord> {
  const store = new RunStore(dependencies.writer, flowPath, flow.manualBaselineMinutes);

  // A resumed run carries the failed run's finished steps in as pre-completed
  // seeds; `planResume` decides which of them are still trustworthy.
  const { resumeFrom, ...runOptions } = options;
  const seed = resumeFrom
    ? (({ reused, outputs, resumedFrom }) => ({
        executions: Object.fromEntries(reused),
        outputs,
        resumedFrom,
      }))(planResume(flow, resumeFrom))
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
      'write-file': createWriteFileExecutor(dependencies.writer),
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
