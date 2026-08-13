// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateEdgeCondition, parseEdgeCondition } from '../edgeCondition';

describe('parseEdgeCondition', () => {
  it('parses the three operators', () => {
    expect(parseEdgeCondition('{{report.verdict}} contains "APPROVE"')).toEqual({
      reference: 'report.verdict',
      op: 'contains',
      literal: 'APPROVE',
    });
    expect(parseEdgeCondition('{{a.out}} == "yes"')).toEqual({
      reference: 'a.out',
      op: '==',
      literal: 'yes',
    });
    expect(parseEdgeCondition('{{a.out}} != ""')).toEqual({
      reference: 'a.out',
      op: '!=',
      literal: '',
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseEdgeCondition('  {{a.out}}   contains   "x y"  ')).toEqual({
      reference: 'a.out',
      op: 'contains',
      literal: 'x y',
    });
  });

  it.each([
    ['no braces', 'a.out contains "x"'],
    ['no operator', '{{a.out}} "x"'],
    ['unknown operator', '{{a.out}} startswith "x"'],
    ['unquoted literal', '{{a.out}} == yes'],
    ['a chain, which when does not allow', '{{a.out ?? b.out}} == "x"'],
    ['trailing junk', '{{a.out}} == "x" extra'],
    ['empty', ''],
  ])('rejects %s', (_label, expression) => {
    expect(() => parseEdgeCondition(expression)).toThrow();
  });
});

describe('evaluateEdgeCondition', () => {
  const outputs = { report: { verdict: 'APPROVE WITH NITS', error: 'boom' } };

  it('contains, equality and inequality behave as read', () => {
    expect(
      evaluateEdgeCondition(parseEdgeCondition('{{report.verdict}} contains "APPROVE"'), outputs)
    ).toBe(true);
    expect(
      evaluateEdgeCondition(parseEdgeCondition('{{report.verdict}} == "APPROVE"'), outputs)
    ).toBe(false);
    expect(
      evaluateEdgeCondition(parseEdgeCondition('{{report.verdict}} != "APPROVE"'), outputs)
    ).toBe(true);
  });

  it('an unresolvable reference is simply false — a dead edge, not a crash', () => {
    expect(
      evaluateEdgeCondition(parseEdgeCondition('{{report.ghost}} contains "x"'), outputs)
    ).toBe(false);
    expect(evaluateEdgeCondition(parseEdgeCondition('{{missing.out}} == "x"'), outputs)).toBe(
      false
    );
  });
});
