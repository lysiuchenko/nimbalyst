// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { scheduleLabel } from '../label';

describe('scheduleLabel', () => {
  it('says only "Schedule" when nothing is armed', () => {
    expect(scheduleLabel(undefined)).toBe('Schedule');
    expect(scheduleLabel({ type: 'daily', time: '02:00', enabled: false })).toBe('Schedule');
  });

  it('shows when an armed flow next runs, so the toolbar tells the truth', () => {
    expect(scheduleLabel({ type: 'daily', time: '02:00', enabled: true })).toBe('Daily 02:00');
    expect(scheduleLabel({ type: 'interval', intervalMinutes: 30, enabled: true })).toBe('Every 30m');
    expect(
      scheduleLabel({ type: 'weekly', time: '09:00', days: ['mon', 'wed'], enabled: true })
    ).toBe('mon, wed 09:00');
  });
});
