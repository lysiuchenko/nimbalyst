/**
 * Which host session belongs to a running flow node.
 *
 * The host titles a session with the prompt it was created from (an AI title
 * may replace it later), so the reliable key is the prompt's static prefix —
 * the text before the first `{{reference}}`, which interpolation rewrites.
 * When the prefix is too short to mean anything, the newest session updated
 * since the run started is the best available answer; sessions older than the
 * run are never candidates.
 */
const MIN_PREFIX = 10;

export function pickSessionForNode(
  sessions: { id: string; title?: string; updatedAt?: number }[],
  node: { prompt?: string },
  runStartedAt: number
): string | undefined {
  const fresh = sessions
    .filter((session) => (session.updatedAt ?? 0) >= runStartedAt)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  if (fresh.length === 0) return undefined;

  const prefix = (node.prompt ?? '').split('{{')[0].trim();
  if (prefix.length >= MIN_PREFIX) {
    const match = fresh.find((session) => session.title?.startsWith(prefix.slice(0, 40)));
    if (match) return match.id;
  }
  return fresh[0].id;
}
