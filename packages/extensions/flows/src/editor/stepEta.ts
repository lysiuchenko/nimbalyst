import type { RunRecord } from '../runner/runStore';

/**
 * How long each step usually takes, from the recorded runs.
 *
 * Median rather than mean: one stuck run must not double every future
 * estimate. Only completed executions with real timings count — failures
 * ended early and reuses never ran.
 */
export function stepEtas(records: RunRecord[]): Record<string, number> {
  const samples: Record<string, number[]> = {};
  for (const record of records) {
    for (const execution of Object.values(record.nodes ?? {})) {
      if (execution.status !== 'done' || execution.reused) continue;
      if (execution.startedAt === undefined || execution.finishedAt === undefined) continue;
      (samples[execution.nodeId] ??= []).push(execution.finishedAt - execution.startedAt);
    }
  }
  const etas: Record<string, number> = {};
  for (const [nodeId, list] of Object.entries(samples)) {
    const sorted = [...list].sort((a, b) => a - b);
    etas[nodeId] = sorted[Math.floor(sorted.length / 2)];
  }
  return etas;
}
