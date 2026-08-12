// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { interpolate, listReferences, referenceArms, UnresolvedReferenceError } from '../interpolate';

const scope = {
  variables: { input: 'src/app.ts', reviewer: 'alice' },
  outputs: { plan: { plan_md: '# Plan\n1. do it' }, build: { log: 'ok' } },
};

describe('interpolate', () => {
  it('resolves a flow variable', () => {
    expect(interpolate('Review {{input}}', scope)).toBe('Review src/app.ts');
  });

  it('resolves an upstream node port', () => {
    expect(interpolate('Implement {{plan.plan_md}}', scope)).toBe('Implement # Plan\n1. do it');
  });

  it('resolves several references in one string', () => {
    expect(interpolate('{{reviewer}} reviews {{input}} using {{build.log}}', scope)).toBe(
      'alice reviews src/app.ts using ok'
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(interpolate('{{  plan.plan_md  }}', scope)).toBe('# Plan\n1. do it');
  });

  it('leaves text without references untouched', () => {
    expect(interpolate('no refs { here } at all', scope)).toBe('no refs { here } at all');
  });

  it('reports an unknown variable by name', () => {
    expect(() => interpolate('{{missing}}', scope)).toThrow(UnresolvedReferenceError);
    expect(() => interpolate('{{missing}}', scope)).toThrow(
      'unknown reference {{missing}}: no variable or node output by that name'
    );
  });

  it('reports an unknown node', () => {
    expect(() => interpolate('{{ghost.out}}', scope)).toThrow(
      'unknown reference {{ghost.out}}: no node "ghost" has produced output'
    );
  });

  it('reports a port the node did not publish', () => {
    expect(() => interpolate('{{plan.diff}}', scope)).toThrow(
      'unknown reference {{plan.diff}}: node "plan" published no output named "diff"'
    );
  });
});

describe('listReferences', () => {
  it('lists every reference in declaration order', () => {
    expect(listReferences('{{a}} then {{b.c}} then {{a}}')).toEqual(['a', 'b.c', 'a']);
  });

  it('returns nothing for plain text', () => {
    expect(listReferences('plain')).toEqual([]);
  });
});

describe('fallback chains', () => {
  const scope = {
    variables: { name: 'flows' },
    outputs: { test: { out: 'tests green' } },
  };

  it('takes the first arm that resolves', () => {
    expect(interpolate('{{test.out ?? repair.out}}', scope)).toBe('tests green');
  });

  it('falls through a dead arm to a live one', () => {
    expect(interpolate('{{repair.out ?? test.out}}', scope)).toBe('tests green');
  });

  it('accepts a literal as the last resort', () => {
    expect(interpolate('{{repair.out ?? "nothing to report"}}', scope)).toBe('nothing to report');
  });

  it('variables participate in chains too', () => {
    expect(interpolate('{{missing ?? name}}', scope)).toBe('flows');
  });

  it('still throws when every arm is dead, naming the whole chain', () => {
    expect(() => interpolate('{{a.x ?? b.y}}', scope)).toThrow('a.x ?? b.y');
  });

  it('leaves spaced prose braces alone, as before chains existed', () => {
    expect(interpolate('a {{ handlebars snippet }} b', scope)).toBe(
      'a {{ handlebars snippet }} b'
    );
  });

  it('lists a chain once, and its arms are recoverable', () => {
    expect(listReferences('x {{a.b ?? c.d}} y {{name}}')).toEqual(['a.b ?? c.d', 'name']);
    expect(referenceArms('a.b ?? c.d')).toEqual({ references: ['a.b', 'c.d'], literal: undefined });
    expect(referenceArms('a.b ?? "fine"')).toEqual({ references: ['a.b'], literal: 'fine' });
    expect(referenceArms('name')).toEqual({ references: ['name'], literal: undefined });
  });
});
