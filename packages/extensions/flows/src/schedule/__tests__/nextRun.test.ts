// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CATCH_UP_WINDOW_MS, dueAt, missedRunAction, nextRun } from '../nextRun';
import type { FlowSchedule } from '../types';

const at = (iso: string) => new Date(iso).getTime();

describe('nextRun — interval', () => {
  const schedule: FlowSchedule = { type: 'interval', intervalMinutes: 30, enabled: true };

  it('counts forward from now', () => {
    expect(nextRun(schedule, at('2026-08-09T12:00:00Z'))).toBe(at('2026-08-09T12:30:00Z'));
  });

  it('refuses an interval that would spin', () => {
    expect(nextRun({ ...schedule, intervalMinutes: 0 }, at('2026-08-09T12:00:00Z'))).toBeNull();
  });
});

describe('nextRun — daily', () => {
  const schedule: FlowSchedule = { type: 'daily', time: '02:00', enabled: true };

  it('picks today when the time is still ahead', () => {
    expect(nextRun(schedule, at('2026-08-09T01:00:00'))).toBe(at('2026-08-09T02:00:00'));
  });

  it('rolls to tomorrow once today has passed', () => {
    expect(nextRun(schedule, at('2026-08-09T03:00:00'))).toBe(at('2026-08-10T02:00:00'));
  });

  it('treats the exact moment as already run', () => {
    expect(nextRun(schedule, at('2026-08-09T02:00:00'))).toBe(at('2026-08-10T02:00:00'));
  });

  it('rejects a time it cannot read', () => {
    expect(nextRun({ ...schedule, time: 'tea time' }, at('2026-08-09T01:00:00'))).toBeNull();
  });
});

describe('nextRun — weekly', () => {
  // 2026-08-09 is a Sunday.
  const schedule: FlowSchedule = { type: 'weekly', time: '09:00', days: ['mon', 'wed'], enabled: true };

  it('finds the next named day', () => {
    expect(nextRun(schedule, at('2026-08-09T12:00:00'))).toBe(at('2026-08-10T09:00:00'));
  });

  it('wraps into next week from the last named day', () => {
    expect(nextRun(schedule, at('2026-08-12T12:00:00'))).toBe(at('2026-08-17T09:00:00'));
  });

  it('never fires when no day is named', () => {
    expect(nextRun({ ...schedule, days: [] }, at('2026-08-09T12:00:00'))).toBeNull();
  });
});

describe('nextRun — disabled', () => {
  it('does not schedule a disabled flow', () => {
    expect(
      nextRun({ type: 'daily', time: '02:00', enabled: false }, at('2026-08-09T01:00:00'))
    ).toBeNull();
  });
});

describe('missedRunAction', () => {
  const due = at('2026-08-09T02:00:00Z');

  it('runs a schedule that came due while the app was closed', () => {
    expect(missedRunAction(due, due + 60_000)).toBe('run');
  });

  it('gives up on one too old to be useful', () => {
    expect(missedRunAction(due, due + CATCH_UP_WINDOW_MS + 1)).toBe('skip');
  });

  it('waits when the time has not come', () => {
    expect(missedRunAction(due, due - 1)).toBe('wait');
  });
});

describe('dueAt', () => {
  const schedule: FlowSchedule = { type: 'interval', intervalMinutes: 60, enabled: true };

  it('keeps the time already resolved, so the clock does not reset on a rescan', () => {
    const already = at('2026-08-09T12:30:00Z');

    expect(dueAt(schedule, already, at('2026-08-09T12:00:00Z'))).toBe(already);
  });

  it('resolves a fresh time when there is none', () => {
    expect(dueAt(schedule, undefined, at('2026-08-09T12:00:00Z'))).toBe(
      at('2026-08-09T13:00:00Z')
    );
  });
});
