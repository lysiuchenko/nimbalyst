// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { conditionReferences } from '../edgeConditionForm';

describe('conditionReferences', () => {
  it('offers the wire port then the error port, and just error when the wire has none', () => {
    expect(conditionReferences('review', 'verdict')).toEqual(['review.verdict', 'review.error']);
    expect(conditionReferences('review')).toEqual(['review.error']);
  });
});
