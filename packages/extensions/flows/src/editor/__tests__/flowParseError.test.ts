// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { FlowParseError, flowErrorsOf, parseFlowOrThrow } from '../flowParseError';

const twoProblems = JSON.stringify({
  version: 1,
  name: 'broken',
  nodes: [
    { id: 'a', type: 'shell' },
    { id: 'b', type: 'human-gate' },
  ],
  edges: [],
});

describe('parseFlowOrThrow', () => {
  test('returns the flow when it is valid', () => {
    const flow = parseFlowOrThrow(
      JSON.stringify({ version: 1, name: 'ok', nodes: [], edges: [] })
    );

    expect(flow.name).toBe('ok');
  });

  test('reports every problem, not only the first', () => {
    // The validator collects them all on purpose; the editor used to take
    // errors[0] and throw the rest away, so fixing a flow was whack-a-mole.
    let caught: unknown;
    try {
      parseFlowOrThrow(twoProblems);
    } catch (error) {
      caught = error;
    }

    const errors = flowErrorsOf(caught);
    expect(errors).toHaveLength(2);
    expect(errors?.map((error) => error.path)).toEqual(['nodes[0].run', 'nodes[1].message']);
  });

  test('still reads sensibly for anything that only shows the message', () => {
    expect(() => parseFlowOrThrow(twoProblems)).toThrow(/2 problems/);
  });

  test('treats an empty file as a new, empty flow', () => {
    expect(parseFlowOrThrow('   ').nodes).toEqual([]);
  });
});

describe('flowErrorsOf', () => {
  test('has nothing to offer for an ordinary error', () => {
    expect(flowErrorsOf(new Error('disk went away'))).toBeNull();
    expect(flowErrorsOf(null)).toBeNull();
  });

  test('recognises its own', () => {
    const error = new FlowParseError([{ path: 'name', message: 'required' }]);

    expect(flowErrorsOf(error)).toHaveLength(1);
  });
});
