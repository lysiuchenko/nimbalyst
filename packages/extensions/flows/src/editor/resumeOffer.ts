import type { RunRecord } from '../runner/runStore';

/**
 * Whether the flow should open with a resume offer.
 *
 * Only an `interrupted` latest run qualifies: a failure announced itself when
 * it happened and a cancellation was the user's own hand, but an interruption
 * is the one ending nobody watched — the app went away mid-run, and without an
 * offer the finished steps' work sits invisible in the record.
 */
export function resumeOffer(
  records: RunRecord[]
): { record: RunRecord; finished: number } | null {
  const latest = records[0];
  if (latest?.status !== 'interrupted') return null;

  const finished = Object.values(latest.nodes ?? {}).filter(
    (execution) => execution.status === 'done'
  ).length;
  return { record: latest, finished };
}
