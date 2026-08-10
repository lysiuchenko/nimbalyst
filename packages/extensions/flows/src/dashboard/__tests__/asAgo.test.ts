// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { asAgo } from '../asAgo';

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('asAgo', () => {
  test('reads as prose at every scale a reader cares about', () => {
    expect(asAgo(NOW - 20_000, NOW)).toBe('just now');
    expect(asAgo(NOW - 5 * MINUTE, NOW)).toBe('5m ago');
    expect(asAgo(NOW - 3 * HOUR, NOW)).toBe('3h ago');
    expect(asAgo(NOW - 2 * DAY, NOW)).toBe('2d ago');
  });

  test('falls back to a date once "days ago" stops being useful', () => {
    expect(asAgo(NOW - 40 * DAY, NOW)).toMatch(/\d/);
    expect(asAgo(NOW - 40 * DAY, NOW)).not.toContain('ago');
  });

  test('never says a run happened in the future', () => {
    expect(asAgo(NOW + HOUR, NOW)).toBe('just now');
  });

  test('has nothing to say about a flow that has not run', () => {
    expect(asAgo(null, NOW)).toBe('Never run');
    expect(asAgo(Number.NaN, NOW)).toBe('Never run');
  });
});
