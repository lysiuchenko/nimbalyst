// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest';
import { consumeRun, requestRun, RUN_INTENT_EVENT, RUN_INTENT_MAX_AGE_MS } from '../runIntent';

afterEach(() => {
  vi.useRealTimers();
  // Requesting replaces whatever a test left behind; consuming empties the slot.
  requestRun('/drain/everything.flow.json');
  consumeRun('/drain/everything.flow.json');
});

describe('the run intent', () => {
  test('is consumed exactly once, by the matching path', () => {
    requestRun('/repo/a.flow.json');

    expect(consumeRun('/repo/a.flow.json')).toBe(true);
    expect(consumeRun('/repo/a.flow.json')).toBe(false);
  });

  test('a different path does not consume it', () => {
    requestRun('/repo/a.flow.json');

    expect(consumeRun('/repo/b.flow.json')).toBe(false);
    // Still there for the editor it was meant for.
    expect(consumeRun('/repo/a.flow.json')).toBe(true);
  });

  test('a new request replaces the old one', () => {
    requestRun('/repo/a.flow.json');
    requestRun('/repo/b.flow.json');

    expect(consumeRun('/repo/a.flow.json')).toBe(false);
    expect(consumeRun('/repo/b.flow.json')).toBe(true);
  });

  test('nothing to consume when nothing was requested', () => {
    expect(consumeRun('/repo/a.flow.json')).toBe(false);
  });

  // An intent that never found its editor must not start a run the next time
  // that flow happens to be opened, hours later.
  test('goes stale rather than firing much later', () => {
    vi.useFakeTimers();
    requestRun('/repo/a.flow.json');

    vi.advanceTimersByTime(RUN_INTENT_MAX_AGE_MS + 1);

    expect(consumeRun('/repo/a.flow.json')).toBe(false);
  });

  test('names the window event the panel fires for already-open editors', () => {
    expect(RUN_INTENT_EVENT).toBe('flows:run-intent');
  });
});
