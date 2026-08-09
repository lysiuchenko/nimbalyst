/** Days a weekly schedule can name, lowercase and three letters. */
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export type Weekday = (typeof WEEKDAYS)[number];

interface ScheduleCommon {
  /** A schedule that is off stays in the file, so it can be turned back on. */
  enabled: boolean;
  /**
   * What to do when a scheduled run reaches a human gate with nobody there.
   *
   * `pause` waits and notifies. `skip` approves automatically and is refused by
   * the validator for any flow containing a shell node — auto-approving a gate
   * in front of a command defeats the gate.
   */
  onGate?: 'pause' | 'skip';
}

export interface IntervalSchedule extends ScheduleCommon {
  type: 'interval';
  intervalMinutes: number;
}

export interface DailySchedule extends ScheduleCommon {
  type: 'daily';
  /** 24-hour local time, `HH:MM`. */
  time: string;
}

export interface WeeklySchedule extends ScheduleCommon {
  type: 'weekly';
  time: string;
  days: Weekday[];
}

/**
 * When a flow should run on its own.
 *
 * Deliberately not a cron expression: `0 2 * * 1-5` is a barrier to half the
 * audience for this feature, and these three shapes cover what a flow needs.
 * The vocabulary matches the automations extension so the two features do not
 * disagree in front of the same user.
 */
export type FlowSchedule = IntervalSchedule | DailySchedule | WeeklySchedule;

/** Per-machine schedule state. Never written to the shared `.flow.json`. */
export interface ScheduleState {
  /** Absolute time the next run is due, so a rescan does not reset the clock. */
  dueAt?: number;
  lastRunAt?: number;
  lastRunId?: string;
  lastOutcome?: 'done' | 'failed' | 'skipped' | 'missed';
}
