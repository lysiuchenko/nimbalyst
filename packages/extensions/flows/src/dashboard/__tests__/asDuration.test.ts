// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { asDuration } from '../asDuration';

describe('asDuration', () => {
  it('shows seconds for work that took less than a minute', () => {
    // Rounding a real two seconds down to "0m" reads as nothing happened.
    expect(asDuration(2_000)).toBe('2s');
    expect(asDuration(400)).toBe('1s');
  });

  it('shows minutes, then hours', () => {
    expect(asDuration(90_000)).toBe('2m');
    expect(asDuration(3_600_000 + 120_000)).toBe('1h 2m');
  });

  it('carries a rounded sixtieth minute into the next hour', () => {
    expect(asDuration(3_599_000)).toBe('1h');
    expect(asDuration(7_199_000)).toBe('2h');
  });

  it('says nothing happened only when nothing did', () => {
    expect(asDuration(0)).toBe('0s');
  });

  // A hand-edited or half-written run record reached the panel and rendered
  // "NaNm" across every headline figure.
  it('admits it does not know rather than printing NaN', () => {
    expect(asDuration(Number.NaN)).toBe('—');
    expect(asDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
