// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { activeRefQuery, applyRef, suggestRefs } from '../refComplete';

describe('activeRefQuery', () => {
  it('reports the partial token when the caret sits inside an unclosed {{', () => {
    expect(activeRefQuery('run {{pl', 8)).toEqual({ start: 4, query: 'pl' });
  });

  it('is inactive in plain prose', () => {
    expect(activeRefQuery('plain text', 5)).toBeNull();
  });

  it('is inactive once the token before the caret is already closed', () => {
    expect(activeRefQuery('{{a}} ', 6)).toBeNull();
  });

  it('completes a token the caret is editing in the middle of', () => {
    expect(activeRefQuery('{{foo}}', 5)).toEqual({ start: 0, query: 'foo' });
  });
});

describe('applyRef', () => {
  it('replaces the open token and leaves the caret past the closing braces', () => {
    expect(applyRef('run {{pl', 8, 'plan.plan_md')).toEqual({
      value: 'run {{plan.plan_md}}',
      caret: 20,
    });
  });

  it('swallows the existing braces instead of doubling them', () => {
    expect(applyRef('{{fo}}', 4, 'foo')).toEqual({ value: '{{foo}}', caret: 7 });
  });
});

describe('suggestRefs', () => {
  it('keeps only case-insensitive substring matches', () => {
    expect(suggestRefs(['plan.plan_md', 'test.out'], 'PL')).toEqual(['plan.plan_md']);
  });

  it('offers everything for an empty query', () => {
    expect(suggestRefs(['a', 'b'], '')).toEqual(['a', 'b']);
  });
});
