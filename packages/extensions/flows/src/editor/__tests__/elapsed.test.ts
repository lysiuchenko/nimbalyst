// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatElapsed } from '../elapsed';

describe('formatElapsed', () => {
  it('shows bare seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(12)).toBe('12s');
    expect(formatElapsed(59)).toBe('59s');
  });

  it('rolls into minutes with zero-padded seconds at the boundary', () => {
    expect(formatElapsed(60)).toBe('1m 00s');
    expect(formatElapsed(63)).toBe('1m 03s');
    expect(formatElapsed(125)).toBe('2m 05s');
  });
});
