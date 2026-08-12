// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asNextRun } from '../asNextRun';

describe('asNextRun', () => {
  const now = new Date(2026, 7, 10, 12, 0, 0).getTime();

  it('calls an arrived deadline due now', () => {
    expect(asNextRun(now - 1, now)).toBe('Due now');
  });

  it('uses compact relative time for the rest of today', () => {
    expect(asNextRun(now + 31 * 60_000, now)).toBe('in 31m');
    expect(asNextRun(now + 2 * 60 * 60_000 + 10 * 60_000, now)).toBe('in 2h 10m');
  });

  it('names tomorrow once a clock time is more useful', () => {
    const tomorrow = new Date(2026, 7, 11, 14, 30, 0).getTime();

    expect(asNextRun(tomorrow, now)).toBe('Tomorrow at 14:30');
  });

  it('admits an invalid or absent deadline', () => {
    expect(asNextRun(null, now)).toBe('Not scheduled');
    expect(asNextRun(Number.NaN, now)).toBe('Not scheduled');
  });
});
