// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { serializeFlow, validateFlow } from '../validate';

const base = {
  version: 1,
  name: 'scheduled',
  nodes: [{ id: 'a', type: 'agent', prompt: 'go' }],
  edges: [],
  variables: {},
};

const withSchedule = (schedule: unknown, nodes: unknown[] = base.nodes) => ({
  ...base,
  nodes,
  schedule,
});

describe('schedule validation', () => {
  it('accepts each schedule shape', () => {
    expect(validateFlow(withSchedule({ type: 'daily', time: '02:00', enabled: true })).valid).toBe(true);
    expect(validateFlow(withSchedule({ type: 'interval', intervalMinutes: 30, enabled: true })).valid).toBe(true);
    expect(
      validateFlow(withSchedule({ type: 'weekly', time: '09:00', days: ['mon'], enabled: true })).valid
    ).toBe(true);
  });

  it('keeps the schedule through a round trip', () => {
    const result = validateFlow(withSchedule({ type: 'daily', time: '02:00', enabled: true }));

    expect(result.valid && result.flow.schedule).toEqual({
      type: 'daily',
      time: '02:00',
      enabled: true,
    });
  });

  it('writes the schedule back out, so setting one survives a save', () => {
    const result = validateFlow(withSchedule({ type: 'daily', time: '02:30', enabled: true }));
    if (!result.valid) throw new Error('expected a valid flow');

    expect(JSON.parse(serializeFlow(result.flow)).schedule).toEqual({
      type: 'daily',
      time: '02:30',
      enabled: true,
    });
  });

  it('leaves an unscheduled flow exactly as it was', () => {
    const result = validateFlow(base);
    if (!result.valid) throw new Error('expected a valid flow');

    expect(JSON.parse(serializeFlow(result.flow))).not.toHaveProperty('schedule');
  });

  it('rejects a time it could never fire at', () => {
    const result = validateFlow(withSchedule({ type: 'daily', time: '25:00', enabled: true }));

    expect(!result.valid && result.errors[0].path).toBe('schedule.time');
  });

  it('rejects a weekly schedule that names no day', () => {
    const result = validateFlow(withSchedule({ type: 'weekly', time: '09:00', days: [], enabled: true }));

    expect(!result.valid && result.errors[0].path).toBe('schedule.days');
  });

  it('rejects an interval that would spin', () => {
    const result = validateFlow(withSchedule({ type: 'interval', intervalMinutes: 0, enabled: true }));

    expect(!result.valid && result.errors[0].path).toBe('schedule.intervalMinutes');
  });

  it('refuses to auto-approve a gate standing in front of a command', () => {
    // The whole point of a gate before a shell node is that a person sees it.
    const result = validateFlow(
      withSchedule({ type: 'daily', time: '02:00', enabled: true, onGate: 'skip' }, [
        { id: 'g', type: 'human-gate', message: 'ok?' },
        { id: 's', type: 'shell', run: 'npm test' },
      ])
    );

    expect(!result.valid && result.errors[0].path).toBe('schedule.onGate');
  });

  it('allows skipping gates in a flow that runs no commands', () => {
    const result = validateFlow(
      withSchedule({ type: 'daily', time: '02:00', enabled: true, onGate: 'skip' }, [
        { id: 'g', type: 'human-gate', message: 'ok?' },
      ])
    );

    expect(result.valid).toBe(true);
  });
});
