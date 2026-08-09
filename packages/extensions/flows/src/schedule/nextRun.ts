import { WEEKDAYS, type FlowSchedule } from './types';

/**
 * How late a missed run may be and still worth doing.
 *
 * A schedule that came due while the app was closed should catch up, but only
 * once and only if it is still relevant: firing a week of missed nightly runs
 * on Monday morning is worse than skipping them.
 */
export const CATCH_UP_WINDOW_MS = 12 * 60 * 60_000;

/** Minutes past midnight for `HH:MM`, or null if it cannot be read. */
function minutesOfDay(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function atLocalTime(from: Date, minutes: number, dayOffset: number): number {
  const target = new Date(from);
  target.setDate(target.getDate() + dayOffset);
  target.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return target.getTime();
}

/**
 * The next time a schedule fires, or null when it never can.
 *
 * Local time throughout, because "02:00" means two in the morning where the
 * person is, and `setHours` follows the zone across a DST change.
 */
export function nextRun(schedule: FlowSchedule, now: number = Date.now()): number | null {
  if (!schedule.enabled) return null;

  if (schedule.type === 'interval') {
    return schedule.intervalMinutes > 0 ? now + schedule.intervalMinutes * 60_000 : null;
  }

  const minutes = minutesOfDay(schedule.time);
  if (minutes === null) return null;
  const from = new Date(now);

  if (schedule.type === 'daily') {
    const today = atLocalTime(from, minutes, 0);
    return today > now ? today : atLocalTime(from, minutes, 1);
  }

  const wanted = new Set(schedule.days);
  if (wanted.size === 0) return null;

  // Seven days ahead is always enough to find the next named one.
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);
    if (!wanted.has(WEEKDAYS[candidate.getDay()])) continue;

    const at = atLocalTime(from, minutes, offset);
    if (at > now) return at;
  }
  return null;
}

/**
 * Keep an already-resolved due time rather than recomputing it.
 *
 * The scheduler rescans periodically; recomputing on every scan would push an
 * interval schedule forward forever and it would never fire.
 */
export function dueAt(
  schedule: FlowSchedule,
  resolved: number | undefined,
  now: number = Date.now()
): number | null {
  return resolved ?? nextRun(schedule, now);
}

/** What to do about a due time that has passed. */
export function missedRunAction(due: number, now: number): 'run' | 'skip' | 'wait' {
  if (now < due) return 'wait';
  return now - due <= CATCH_UP_WINDOW_MS ? 'run' : 'skip';
}
