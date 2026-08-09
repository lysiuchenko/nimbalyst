import type { RunRecord, RunFileWriter } from './runStore';

/**
 * How long a `running` record may go unwritten before it is presumed abandoned.
 *
 * The store rewrites a record on every node transition, so a live run touches
 * its file often. A gap this long means the app went away mid-run — the record
 * would otherwise claim to be running forever.
 */
export const STALE_AFTER_MS = 5 * 60_000;

/** Whether a record is a leftover from a run that no longer exists. */
export function isStale(record: RunRecord, liveRunId: string | null, now: number): boolean {
  if (record.status !== 'running') return false;
  if (record.runId === liveRunId) return false;
  // Records written before heartbeats existed only have a start time.
  return now - (record.updatedAt ?? record.startedAt) > STALE_AFTER_MS;
}

/**
 * Settle abandoned runs, on disk and in the list handed to the UI.
 *
 * Repairing at the source rather than only at render time matters because
 * anything else that reads these records — a scheduler deciding whether a run
 * is already in flight — would otherwise see a phantom.
 */
export async function repairStale(
  records: RunRecord[],
  liveRunId: string | null,
  writer: RunFileWriter,
  pathFor: (runId: string) => string,
  now: number = Date.now()
): Promise<RunRecord[]> {
  return Promise.all(
    records.map(async (record) => {
      if (!isStale(record, liveRunId, now)) return record;

      const repaired: RunRecord = { ...record, status: 'interrupted', updatedAt: now };
      try {
        await writer.write(pathFor(record.runId), `${JSON.stringify(repaired, null, 2)}\n`);
      } catch {
        // A read-only workspace must not cost the user their history; the
        // record still reads as interrupted for this session.
      }
      return repaired;
    })
  );
}
