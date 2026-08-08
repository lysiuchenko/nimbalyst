import { compileToSlashCommand, commandPathFor } from './compileCommand';
import { parseCliArgs, USAGE, type CliArgs } from './cli';
import { parseFlowFile } from '../schema/validate';
import { runFlow } from '../runner/flowRun';
import type { AgentClient, GateController, ShellClient } from '../runner/ports';
import type { RunFileWriter } from '../runner/runStore';

export interface HeadlessDeps {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  shell: ShellClient;
  allowlist: readonly string[];
  /** CI has no one to ask, so gates fail unless the caller opts in. */
  approveGates?: boolean;
  log(message: string): void;
}

/**
 * Agent nodes cannot run outside the app.
 *
 * The host owns Claude Code's credentials and binary resolution, and this
 * extension deliberately does not re-implement either (see
 * docs/editorhost-notes.md). `compile` is the supported path for agent flows:
 * it emits a slash command the Claude Code CLI runs with the user's own login.
 */
const NO_AGENT: AgentClient = {
  run: async (request) => {
    throw new Error(
      `node ${JSON.stringify(request.nodeId)} needs an agent, which headless mode cannot run. ` +
        `Compile the flow instead: nimbalyst-flows compile <flow> — then run the generated slash command.`
    );
  },
};

function gateController(approveGates: boolean, log: HeadlessDeps['log']): GateController {
  return {
    requestApproval: async (request) => {
      if (!approveGates) {
        throw new Error(
          `gate ${JSON.stringify(request.nodeId)} needs a human decision: ${request.message}. ` +
            `Re-run with --approve-gates to approve gates automatically.`
        );
      }
      log(`gate ${request.nodeId} auto-approved: ${request.message}`);
      return 'approved';
    },
  };
}

/** Returns the process exit code: 0 ok, 1 the flow failed, 2 bad usage/invalid flow. */
export async function runHeadless(argv: string[], deps: HeadlessDeps): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    deps.log(error instanceof Error ? error.message : String(error));
    return 2;
  }

  if (args.command === 'help') {
    deps.log(USAGE);
    return 0;
  }

  const raw = await deps.readFile(args.flowPath);
  const parsed = parseFlowFile(raw);
  if (!parsed.valid) {
    deps.log(`${args.flowPath} is not a valid flow:`);
    for (const error of parsed.errors) {
      deps.log(`  ${error.path ? `${error.path}: ` : ''}${error.message}`);
    }
    return 2;
  }

  if (args.command === 'validate') {
    deps.log(`${args.flowPath} is valid (${parsed.flow.nodes.length} nodes).`);
    return 0;
  }

  if (args.command === 'compile') {
    const outPath = args.outPath ?? commandPathFor(parsed.flow.name);
    await deps.writeFile(outPath, compileToSlashCommand(parsed.flow, args.flowPath));
    deps.log(`wrote ${outPath}`);
    return 0;
  }

  const writer: RunFileWriter = { write: (path, content) => deps.writeFile(path, content) };
  const record = await runFlow(
    parsed.flow,
    args.flowPath,
    {
      agent: NO_AGENT,
      shell: deps.shell,
      gate: gateController(deps.approveGates === true, deps.log),
      writer,
      allowlist: deps.allowlist,
    },
    { variables: args.variables }
  );

  for (const node of Object.values(record.nodes)) {
    deps.log(`${node.status.padEnd(8)} ${node.nodeId}${node.error ? ` — ${node.error}` : ''}`);
  }
  deps.log(`run ${record.runId}: ${record.status}`);

  return record.status === 'done' ? 0 : 1;
}
