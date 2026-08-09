// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FlowScheduler } from '../FlowScheduler';
import type { FlowSchedule } from '../types';

const daily: FlowSchedule = { type: 'daily', time: '02:00', enabled: true };
const due = new Date('2026-08-09T02:00:00').getTime();

function harness(over: Partial<ConstructorParameters<typeof FlowScheduler>[0]> = {}) {
  const runs: string[] = [];
  const saved: Record<string, unknown> = {};
  const scheduler = new FlowScheduler({
    listScheduled: async () => [{ flowPath: 'a.flow.json', schedule: daily }],
    readState: async () => ({ dueAt: due }),
    writeState: async (flowPath, state) => void (saved[flowPath] = state),
    runFlow: async (flowPath) => {
      runs.push(flowPath);
      return { runId: 'run-1', status: 'done' as const };
    },
    isRunning: () => false,
    now: () => due,
    ...over,
  });
  return { scheduler, runs, saved };
}

describe('FlowScheduler', () => {
  it('runs a flow that has come due', async () => {
    const { scheduler, runs } = harness();

    await scheduler.tick();

    expect(runs).toEqual(['a.flow.json']);
  });

  it('records the outcome and the next due time', async () => {
    const { scheduler, saved } = harness();

    await scheduler.tick();

    expect(saved['a.flow.json']).toMatchObject({ lastOutcome: 'done', lastRunId: 'run-1' });
    expect((saved['a.flow.json'] as { dueAt: number }).dueAt).toBeGreaterThan(due);
  });

  it('anchors the first due time, so repeated scans cannot push it away forever', async () => {
    // Recomputing `now + interval` on every 30s scan means an interval schedule
    // never arrives. The due time has to be written down once.
    const interval: FlowSchedule = { type: 'interval', intervalMinutes: 1, enabled: true };
    const { scheduler, saved } = harness({
      listScheduled: async () => [{ flowPath: 'a.flow.json', schedule: interval }],
      readState: async () => ({}),
      now: () => due,
    });

    await scheduler.tick();

    expect(saved['a.flow.json']).toEqual({ dueAt: due + 60_000 });
  });

  it('does not rewrite an anchor it already has', async () => {
    const { scheduler, saved } = harness({ now: () => due - 60_000 });

    await scheduler.tick();

    expect(saved['a.flow.json']).toBeUndefined();
  });

  it('leaves a flow alone until its time comes', async () => {
    const { scheduler, runs } = harness({ now: () => due - 60_000 });

    await scheduler.tick();

    expect(runs).toEqual([]);
  });

  it('does not start a second run of a flow already running', async () => {
    const { scheduler, runs } = harness({ isRunning: () => true });

    await scheduler.tick();

    expect(runs).toEqual([]);
  });

  it('records a run it was too late to make useful, and moves on', async () => {
    const { scheduler, runs, saved } = harness({ now: () => due + 13 * 60 * 60_000 });

    await scheduler.tick();

    expect(runs).toEqual([]);
    expect(saved['a.flow.json']).toMatchObject({ lastOutcome: 'missed' });
  });

  it('keeps scheduling after a run throws', async () => {
    const { scheduler, saved } = harness({
      runFlow: async () => {
        throw new Error('flow blew up');
      },
    });

    await scheduler.tick();

    // A failing flow must not stop the scheduler; it records and carries on.
    expect(saved['a.flow.json']).toMatchObject({ lastOutcome: 'failed' });
  });

  it('never runs two ticks at once', async () => {
    let active = 0;
    let peak = 0;
    const { scheduler } = harness({
      runFlow: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { runId: 'r', status: 'done' as const };
      },
    });

    await Promise.all([scheduler.tick(), scheduler.tick()]);

    expect(peak).toBe(1);
  });

  it('stops cleanly', () => {
    const { scheduler } = harness();
    scheduler.start();
    expect(() => scheduler.stop()).not.toThrow();
  });
});
