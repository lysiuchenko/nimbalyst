// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nextDisclosure, shouldApplyDisclosure } from '../disclosure';

describe('nextDisclosure', () => {
  it('advances the epoch so a repeated open value still fires', () => {
    const first = nextDisclosure({ epoch: 4, open: false }, false);
    // Same `open` as a plausible previous command, but a fresh epoch — the
    // cards must treat it as a new command, not a no-op.
    expect(first.epoch).toBe(5);
    expect(first.open).toBe(false);
    expect(first.target).toBeUndefined();
  });

  it('carries the target ids through', () => {
    const scoped = nextDisclosure({ epoch: 0, open: false }, true, ['a', 'b']);
    expect(scoped).toEqual({ epoch: 1, open: true, target: ['a', 'b'] });
  });
});

describe('shouldApplyDisclosure', () => {
  const cmd = { epoch: 7, open: true } as const;

  it('is null when this card already applied the epoch', () => {
    expect(shouldApplyDisclosure(cmd, 7, 'a')).toBeNull();
  });

  it('returns the open state for a new, untargeted command', () => {
    expect(shouldApplyDisclosure(cmd, 6, 'a')).toBe(true);
  });

  it('returns the open state when the card is in the target', () => {
    expect(shouldApplyDisclosure({ epoch: 7, open: false, target: ['a'] }, 6, 'a')).toBe(false);
  });

  it('is null when a new command targets other cards', () => {
    expect(shouldApplyDisclosure({ epoch: 7, open: true, target: ['b'] }, 6, 'a')).toBeNull();
  });
});
