import type { RunRecord } from '../runner/runStore';

/**
 * What the canvas can say about a run without opening a session: what flowed
 * through a wire, and which steps have a habit of failing.
 */

export interface EdgePayload {
  /** The reference the value answers to, e.g. `plan.plan_md`. */
  label: string;
  value: string;
}

/**
 * The value that travelled this edge, from a run's outputs.
 *
 * A port edge reads the named output; a failure edge reads the error it
 * routes; an unnamed edge falls back to its from-node's output if there is
 * exactly one — with several, no honest single answer exists.
 */
export function edgePayload(
  edge: { from: string; to: string; port?: string; on?: string },
  outputs: Record<string, Record<string, string>> | undefined
): EdgePayload | null {
  const published = outputs?.[edge.from];
  if (!published) return null;

  const port = edge.on === 'failure' ? 'error' : edge.port;
  if (port !== undefined) {
    return port in published ? { label: `${edge.from}.${port}`, value: published[port] } : null;
  }

  const entries = Object.entries(published);
  if (entries.length !== 1) return null;
  return { label: `${edge.from}.${entries[0][0]}`, value: entries[0][1] };
}

/**
 * Per-node outcome counts across the recorded runs.
 *
 * `done` is evidence for, `failed` evidence against; everything else —
 * skipped, queued, running — is a run that never tested the node. A reused
 * execution counts as done: it did succeed, just in an earlier run.
 */
export function nodeReliability(
  records: RunRecord[]
): Record<string, { ok: number; total: number }> {
  const map: Record<string, { ok: number; total: number }> = {};
  for (const record of records) {
    for (const execution of Object.values(record.nodes ?? {})) {
      if (execution.status !== 'done' && execution.status !== 'failed') continue;
      const entry = (map[execution.nodeId] ??= { ok: 0, total: 0 });
      entry.total += 1;
      if (execution.status === 'done') entry.ok += 1;
    }
  }
  return map;
}
