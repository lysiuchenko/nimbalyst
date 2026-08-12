const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clock(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** Concise next-run copy that remains useful when a schedule is already due. */
export function asNextRun(at: number | null, now: number = Date.now()): string {
  if (at === null || !Number.isFinite(at)) return 'Not scheduled';
  if (at <= now) return 'Due now';

  const difference = at - now;
  const target = new Date(at);
  const current = new Date(now);
  // Imminence beats the calendar: at 23:35, a run due in thirty minutes must
  // read "in 30m", not "Tomorrow at 00:05" — CI caught that live near
  // midnight. Calendar phrasing is for runs genuinely far away.
  if (sameLocalDay(target, current) || difference < 6 * HOUR) {
    const minutes = Math.max(1, Math.ceil(difference / MINUTE));
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `in ${hours}h ${remainder}m` : `in ${hours}h`;
  }

  const tomorrow = new Date(current);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameLocalDay(target, tomorrow)) return `Tomorrow at ${clock(target)}`;

  if (difference < 7 * 24 * HOUR) {
    const weekday = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
    }).format(target);
    return `${weekday} at ${clock(target)}`;
  }

  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(target);
  return `${date} at ${clock(target)}`;
}
