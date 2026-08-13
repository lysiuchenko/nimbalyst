import type { NodeStatus } from '../runner/types';
import type { RunRecord } from '../runner/runStore';

/**
 * Replay: derive what the canvas looked like `atMs` into a finished run.
 *
 * Purely a read over the record's per-node timings — nothing executes, and the
 * scrubber can jump anywhere because every instant is computed from scratch.
 */

/** How long the run took; 0 for a record that never finished (nothing to scrub). */
export function replayDuration(record: RunRecord): number {
  return record.finishedAt !== undefined ? record.finishedAt - record.startedAt : 0;
}

export function replayStatuses(record: RunRecord, atMs: number): Record<string, NodeStatus> {
  const t = record.startedAt + atMs;
  const end = record.finishedAt ?? Number.POSITIVE_INFINITY;
  const statuses: Record<string, NodeStatus> = {};

  for (const execution of Object.values(record.nodes ?? {})) {
    if (execution.startedAt === undefined) {
      // No timings — a skip, decided somewhere along the way but not stamped.
      // Show it once the run is over rather than inventing a moment for it.
      if (t >= end) statuses[execution.nodeId] = execution.status;
      continue;
    }
    if (t < execution.startedAt) continue;
    statuses[execution.nodeId] =
      execution.finishedAt !== undefined && t >= execution.finishedAt
        ? execution.status
        : 'running';
  }

  return statuses;
}
