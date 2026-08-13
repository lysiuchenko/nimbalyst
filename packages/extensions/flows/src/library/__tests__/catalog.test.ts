// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LIBRARY_FLOWS, uniqueFlowFileName } from '../catalog';
import { validateFlow } from '../../schema/validate';

describe('the library catalog', () => {
  it('every entry passes the validator — an invalid flow cannot ship', () => {
    for (const entry of LIBRARY_FLOWS) {
      const result = validateFlow(entry.flow);
      expect(result.valid ? [] : result.errors, entry.id).toEqual([]);
    }
  });

  it('ids are unique and every card can explain itself', () => {
    const ids = LIBRARY_FLOWS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of LIBRARY_FLOWS) {
      expect(entry.title.length, entry.id).toBeGreaterThan(0);
      expect(entry.description.length, entry.id).toBeGreaterThan(0);
    }
  });
});

describe('uniqueFlowFileName', () => {
  it('uses the id when free, and walks -2, -3 when taken', () => {
    expect(uniqueFlowFileName('pr-review', new Set())).toBe('pr-review.flow.json');
    expect(uniqueFlowFileName('pr-review', new Set(['pr-review.flow.json']))).toBe(
      'pr-review-2.flow.json'
    );
    expect(
      uniqueFlowFileName('pr-review', new Set(['pr-review.flow.json', 'pr-review-2.flow.json']))
    ).toBe('pr-review-3.flow.json');
  });
});
