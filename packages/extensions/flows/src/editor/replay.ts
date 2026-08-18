import type { NodeStatus, ChildProgress, NodeExecution } from '../runner/types';
import type { RunRecord } from '../runner/runStore';
import type { RunTimeline } from '../runner/runTimeline';

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

export interface ReplaySlices {
  statuses: Record<string, NodeStatus>;
  results: Record<string, NodeExecution>;
  children: Record<string, ChildProgress[]>;
}

/**
 * Reconstruct each node's slice at `atMs` (relative to the first frame) by
 * keeping the latest frame per node with `frame.at <= firstAt + atMs`. Frames
 * are appended in time order, so a single forward walk suffices. Pure.
 */
export function replayState(timeline: RunTimeline, atMs: number): ReplaySlices {
  const statuses: Record<string, NodeStatus> = {};
  const results: Record<string, NodeExecution> = {};
  const children: Record<string, ChildProgress[]> = {};
  const firstAt = timeline.frames[0]?.at ?? 0;
  const cutoff = firstAt + atMs;

  for (const frame of timeline.frames) {
    if (frame.at > cutoff) break;
    statuses[frame.nodeId] = frame.status;
    results[frame.nodeId] = {
      nodeId: frame.nodeId,
      status: frame.status,
      ...(frame.output !== undefined ? { output: frame.output } : {}),
    };
    if (frame.children) {
      children[frame.nodeId] = frame.children.map((c) => ({ label: c.label, status: c.status }));
    }
  }
  return { statuses, results, children };
}

export function replayTimelineDuration(timeline: RunTimeline): number {
  const { frames } = timeline;
  return frames.length ? frames[frames.length - 1].at - frames[0].at : 0;
}
