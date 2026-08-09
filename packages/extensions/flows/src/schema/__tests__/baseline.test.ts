// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { serializeFlow, validateFlow } from '../validate';

const base = {
  version: 1,
  name: 'nightly',
  nodes: [{ id: 'a', type: 'agent', prompt: 'go' }],
  edges: [],
  variables: {},
};

const withBaseline = (manualBaselineMinutes: unknown) => ({ ...base, manualBaselineMinutes });

describe('manualBaselineMinutes', () => {
  it('accepts how long the work takes by hand', () => {
    const result = validateFlow(withBaseline(90));

    expect(result.valid && result.flow.manualBaselineMinutes).toBe(90);
  });

  it('survives a save, so the estimate is not lost on the next edit', () => {
    const result = validateFlow(withBaseline(90));
    if (!result.valid) throw new Error('expected a valid flow');

    expect(JSON.parse(serializeFlow(result.flow)).manualBaselineMinutes).toBe(90);
  });

  it('is absent from a flow that never claimed one', () => {
    const result = validateFlow(base);
    if (!result.valid) throw new Error('expected a valid flow');

    expect(JSON.parse(serializeFlow(result.flow))).not.toHaveProperty('manualBaselineMinutes');
  });

  it('rejects a figure that could not be a duration', () => {
    // A saved-time estimate built on a negative or fractional baseline is worse
    // than none, because it still gets shown as a number.
    for (const bad of [0, -5, 1.5, 'an hour']) {
      const result = validateFlow(withBaseline(bad));
      expect(!result.valid && result.errors[0].path).toBe('manualBaselineMinutes');
    }
  });
});
