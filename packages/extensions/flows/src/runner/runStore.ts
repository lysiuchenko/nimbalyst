import type { NodeExecution, RunState, RunStatus, TokenUsage } from './types';

/** The one filesystem capability a run record needs. Kept narrow so it can be
 * backed by `host.fs`, `services.filesystem`, or a fake in tests. */
export interface RunFileWriter {
  write(path: string, content: string): Promise<void>;
}

/** What lands in `.flow-runs/<run-id>.json`. */
export interface RunRecord {
  runId: string;
  flowName: string;
  /** The flow this run came from, so a record is traceable back to its source. */
  flowPath: string;
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  nodes: Record<string, NodeExecution>;
  outputs: Record<string, Record<string, string>>;
  usage: TokenUsage;
  /** Sessions this run created, in node order — the UI jumps to these. */
  sessionIds: string[];
}

const RUNS_DIRECTORY = '.flow-runs';

/**
 * Persists a run next to the flow it came from.
 *
 * The same file is rewritten as the run progresses, so an interrupted run still
 * leaves a record of how far it got and which sessions it created.
 */
export class RunStore {
  constructor(
    private readonly writer: RunFileWriter,
    private readonly flowPath: string
  ) {}

  async save(state: RunState): Promise<RunRecord> {
    const record = toRecord(state, this.flowPath);
    await this.writer.write(this.pathFor(state.runId), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  }

  pathFor(runId: string): string {
    const directory = this.flowPath.slice(0, Math.max(this.flowPath.lastIndexOf('/'), 0));
    const prefix = directory ? `${directory}/` : '';
    return `${prefix}${RUNS_DIRECTORY}/${runId}.json`;
  }
}

function toRecord(state: RunState, flowPath: string): RunRecord {
  const sessionIds = Object.values(state.nodes)
    .map((node) => node.sessionId)
    .filter((sessionId): sessionId is string => sessionId !== undefined);

  return {
    runId: state.runId,
    flowName: state.flowName,
    flowPath,
    status: state.status,
    startedAt: state.startedAt,
    ...(state.finishedAt !== undefined ? { finishedAt: state.finishedAt } : {}),
    nodes: state.nodes,
    outputs: state.outputs,
    usage: state.usage,
    sessionIds,
  };
}
