import type { RunRecord } from '../runner/runStore';

/**
 * What a past run should be shown as.
 *
 * `interrupted` is not a state the runner writes. A record is rewritten as the
 * run progresses, so a run whose app closed mid-flight is left saying
 * `running` forever — and a history where most rows claim to be running is
 * worse than useless. Only the run this editor is actually driving is running.
 */
export type DisplayStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export function displayStatus(record: RunRecord, liveRunId: string | null): DisplayStatus {
  if (record.status !== 'running') return record.status;
  return record.runId === liveRunId ? 'running' : 'interrupted';
}

/**
 * How far a run got, and where it stopped.
 *
 * This replaces the run id as the row's wide column: `failed at review` is what
 * a reader needs first, and a uuid never was.
 */
export function runOutcome(record: RunRecord, status: DisplayStatus): string {
  const nodes = Object.values(record.nodes ?? {});
  if (nodes.length === 0) return '';

  const done = nodes.filter((node) => node.status === 'done').length;
  const progress = `${done} of ${nodes.length} steps`;

  if (status === 'failed') {
    const failed = nodes.find((node) => node.status === 'failed');
    return failed ? `${progress} · failed at ${failed.nodeId}` : progress;
  }

  if (status === 'interrupted') {
    const stopped = nodes.find((node) => node.status === 'running');
    return stopped ? `${progress} · stopped at ${stopped.nodeId}` : progress;
  }

  return progress;
}

/**
 * Total tokens, or an admission that none were recorded.
 *
 * Zero is never a true answer here: the host leaves `tokenUsage` null on the
 * extension prompt path, so a run that spent real money still totals zero.
 * Printing `0` tells the reader the run was free.
 */
export function tokensLabel(record: RunRecord): string {
  const total = (record.usage?.inputTokens ?? 0) + (record.usage?.outputTokens ?? 0);
  return total > 0 ? total.toLocaleString() : '—';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Elapsed time while that is the useful framing, a date once it is not. */
export function relativeWhen(at: number, now: number = Date.now()): string {
  const elapsed = now - at;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} hr ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} d ago`;
  return new Date(at).toLocaleDateString();
}

/** One line of orientation above the table. */
export function historySummary(records: RunRecord[], liveRunId: string | null): string {
  const statuses = records.map((record) => displayStatus(record, liveRunId));
  const failed = statuses.filter((status) => status === 'failed').length;
  const interrupted = statuses.filter((status) => status === 'interrupted').length;

  const parts = [`${records.length} ${records.length === 1 ? 'run' : 'runs'}`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (interrupted > 0) parts.push(`${interrupted} interrupted`);
  return parts.join(' · ');
}
