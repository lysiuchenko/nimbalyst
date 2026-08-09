import { dueAt, missedRunAction, nextRun } from './nextRun';
import type { FlowSchedule, ScheduleState } from './types';

/**
 * What the scheduler should do about one flow, right now.
 *
 * Separated from the timer that acts on it so the interesting decisions —
 * catch up, skip, refuse to overlap — are testable without waiting for wall
 * clock time.
 */
export type ScheduleAction =
  /** Nothing to do: disabled, or a schedule that can never fire. */
  | { kind: 'idle' }
  /** Come back at this time. */
  | { kind: 'wait'; until: number }
  /** Start a run now. */
  | { kind: 'run'; due: number }
  /** Too late to be useful; move to the next slot. */
  | { kind: 'skip'; due: number; next: number | null }
  /** A run of this flow is already in flight. */
  | { kind: 'busy'; next: number | null };

export function decideNextAction(
  schedule: FlowSchedule,
  state: ScheduleState,
  isRunning: boolean,
  now: number = Date.now()
): ScheduleAction {
  const due = dueAt(schedule, state.dueAt, now);
  if (due === null) return { kind: 'idle' };

  // Overlapping runs of one flow would compete for the same working tree, so a
  // busy flow forfeits this slot rather than queueing behind itself.
  if (isRunning) return { kind: 'busy', next: nextRun(schedule, now) };

  switch (missedRunAction(due, now)) {
    case 'wait':
      return { kind: 'wait', until: due };
    case 'run':
      return { kind: 'run', due };
    case 'skip':
      return { kind: 'skip', due, next: nextRun(schedule, now) };
  }
}
