const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When something last happened, in the words a person would use.
 *
 * Past about a month "38d ago" stops meaning anything, so it becomes a date.
 * A clock that has drifted, or a record written by a machine in another
 * timezone, can put a run slightly in the future; that reads as "just now"
 * rather than as a negative duration.
 */
export function asAgo(at: number | null, now: number = Date.now()): string {
  if (at === null || !Number.isFinite(at)) return 'Never run';

  const elapsed = now - at;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;

  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
