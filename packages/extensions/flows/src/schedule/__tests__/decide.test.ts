// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decideNextAction } from '../decide';
import type { FlowSchedule, ScheduleState } from '../types';

const daily: FlowSchedule = { type: 'daily', time: '02:00', enabled: true };
const due = new Date('2026-08-09T02:00:00').getTime();

describe('decideNextAction', () => {
  it('waits until the schedule comes due', () => {
    const action = decideNextAction(daily, { dueAt: due }, false, due - 60_000);

    expect(action).toEqual({ kind: 'wait', until: due });
  });

  it('runs once the time arrives', () => {
    expect(decideNextAction(daily, { dueAt: due }, false, due).kind).toBe('run');
  });

  it('catches up a run missed while the app was closed', () => {
    expect(decideNextAction(daily, { dueAt: due }, false, due + 60_000).kind).toBe('run');
  });

  it('gives up on a run too old to matter, and moves to the next slot', () => {
    const action = decideNextAction(daily, { dueAt: due }, false, due + 13 * 60 * 60_000);

    expect(action.kind).toBe('skip');
  });

  it('never starts a second run of a flow already running', () => {
    // Two runs of the same flow would fight over the same working tree.
    expect(decideNextAction(daily, { dueAt: due }, true, due).kind).toBe('busy');
  });

  it('does nothing for a flow with the schedule turned off', () => {
    const off: FlowSchedule = { ...daily, enabled: false };

    expect(decideNextAction(off, {}, false, due).kind).toBe('idle');
  });

  it('resolves a first due time when the state has none', () => {
    const action = decideNextAction(daily, {} as ScheduleState, false, due - 3_600_000);

    expect(action).toEqual({ kind: 'wait', until: due });
  });

  it('stays idle for a schedule that can never fire', () => {
    const broken: FlowSchedule = { type: 'weekly', time: '09:00', days: [], enabled: true };

    expect(decideNextAction(broken, {}, false, due).kind).toBe('idle');
  });
});
