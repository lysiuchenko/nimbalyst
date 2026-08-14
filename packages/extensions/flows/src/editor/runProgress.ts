import type { NodeStatus } from '../runner/types';

/**
 * The one-line answer to "how far along is this run?".
 *
 * Settled means the step's story ended — done, failed or skipped. Total is
 * everything the status map knows about, which grows as the run discovers
 * work (fan-outs); the fraction is honest at every instant it is shown.
 */
export function runProgress(
  statuses: Record<string, NodeStatus>
): { settled: number; total: number; running: string[] } | null {
  const entries = Object.entries(statuses);
  if (entries.length === 0) return null;

  let settled = 0;
  const running: string[] = [];
  for (const [nodeId, status] of entries) {
    if (status === 'done' || status === 'failed' || status === 'skipped') settled += 1;
    else if (status === 'running') running.push(nodeId);
  }
  return { settled, total: entries.length, running };
}
