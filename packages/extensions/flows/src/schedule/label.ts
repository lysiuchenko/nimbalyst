import type { FlowSchedule } from './types';

/** The toolbar's one-word summary of when a flow runs by itself. */
export function scheduleLabel(schedule: FlowSchedule | undefined): string {
  if (!schedule || !schedule.enabled) return 'Schedule';

  switch (schedule.type) {
    case 'interval':
      return `Every ${schedule.intervalMinutes}m`;
    case 'daily':
      return `Daily ${schedule.time}`;
    case 'weekly':
      return schedule.days.length > 0
        ? `${schedule.days.join(', ')} ${schedule.time}`
        : 'Schedule';
  }
}
