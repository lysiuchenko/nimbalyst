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
  /** Last time this record was written; how an abandoned run is detected. */
  updatedAt?: number;
  /**
   * The flow's manual baseline at the time of this run.
   *
   * Copied onto the record rather than read back off the flow, so an estimate
   * always reflects what the author claimed when the run actually happened.
   */
  manualBaselineMinutes?: number;
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
  private ignoreWritten = false;

  constructor(
    private readonly writer: RunFileWriter,
    private readonly flowPath: string,
    private readonly manualBaselineMinutes?: number
  ) {}

  /**
   * Make the run directory ignore itself.
   *
   * Records carry step output, so they inherit the sensitivity of whatever the
   * flow touched — they are local history, like build output. A `.gitignore`
   * holding `*` inside the directory needs no change to the repository's own
   * ignore file, so it works in a repo the flow author does not control.
   */
  private async ensureIgnored(): Promise<void> {
    if (this.ignoreWritten) return;
    this.ignoreWritten = true;
    const directory = this.flowPath.slice(0, Math.max(this.flowPath.lastIndexOf('/'), 0));
    const prefix = directory ? `${directory}/` : '';
    try {
      await this.writer.write(
        `${prefix}${RUNS_DIRECTORY}/.gitignore`,
        '# Run records carry step output; they are local history, not source.\n*\n'
      );
    } catch {
      // A read-only workspace must not cost the user their run record.
    }
  }

  async save(state: RunState): Promise<RunRecord> {
    const record = toRecord(state, this.flowPath, this.manualBaselineMinutes);
    await this.writer.write(this.pathFor(state.runId), `${JSON.stringify(record, null, 2)}\n`);
    // After the record, so a failed write leaves nothing behind.
    await this.ensureIgnored();
    return record;
  }

  pathFor(runId: string): string {
    const directory = this.flowPath.slice(0, Math.max(this.flowPath.lastIndexOf('/'), 0));
    const prefix = directory ? `${directory}/` : '';
    return `${prefix}${RUNS_DIRECTORY}/${runId}.json`;
  }
}

function toRecord(
  state: RunState,
  flowPath: string,
  manualBaselineMinutes?: number
): RunRecord {
  // A fan-out's work lives in its sub-agents' sessions, so listing only the
  // node's own session would leave most of a run unreachable.
  const sessionIds = Object.values(state.nodes).flatMap((node) => [
    ...(node.sessionId ? [node.sessionId] : []),
    ...(node.childSessionIds ?? []),
  ]);

  return {
    runId: state.runId,
    flowName: state.flowName,
    flowPath,
    updatedAt: Date.now(),
    ...(manualBaselineMinutes !== undefined ? { manualBaselineMinutes } : {}),
    status: state.status,
    startedAt: state.startedAt,
    ...(state.finishedAt !== undefined ? { finishedAt: state.finishedAt } : {}),
    nodes: state.nodes,
    outputs: state.outputs,
    usage: state.usage,
    sessionIds,
  };
}
