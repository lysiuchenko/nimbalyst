// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../validate';

const flow = (edges: unknown[]) => ({
  version: 1,
  name: 'routes on failure',
  nodes: [
    { id: 'test', type: 'shell', run: 'npm test', output: 'log' },
    { id: 'fix', type: 'agent', prompt: 'fix {{test.error}}' },
    { id: 'ship', type: 'agent', prompt: 'ship it' },
  ],
  edges,
});

function errorsFor(edges: unknown[]): string[] {
  const result = validateFlow(flow(edges));
  return result.valid ? [] : result.errors.map((error) => `${error.path}: ${error.message}`);
}

describe('conditional edges', () => {
  it('accepts on: failure and on: success', () => {
    expect(
      errorsFor([
        { from: 'test', to: 'fix', on: 'failure' },
        { from: 'test', to: 'ship', on: 'success' },
      ])
    ).toEqual([]);
  });

  it('an absent on still means success, so every existing flow is unchanged', () => {
    const result = validateFlow(flow([{ from: 'test', to: 'ship' }]));

    expect(result.valid).toBe(true);
    expect(result.valid && result.flow.edges[0].on).toBeUndefined();
  });

  it('rejects any other value', () => {
    expect(errorsFor([{ from: 'test', to: 'fix', on: 'sometimes' }])).toContainEqual(
      expect.stringContaining('edges[0].on')
    );
  });

  // A failed node published no output, so naming one is a contradiction the
  // author should hear about, not something to silently ignore.
  it('rejects a port on a failure edge', () => {
    expect(errorsFor([{ from: 'test', to: 'fix', on: 'failure', port: 'log' }])).toContainEqual(
      expect.stringContaining('edges[0].port')
    );
  });

  it('keeps the kind when it parses the edge', () => {
    const result = validateFlow(flow([{ from: 'test', to: 'fix', on: 'failure' }]));

    expect(result.valid).toBe(true);
    expect(result.valid && result.flow.edges[0]).toEqual({
      from: 'test',
      to: 'fix',
      on: 'failure',
    });
  });

  it('a failure edge still counts for cycle detection', () => {
    expect(
      errorsFor([
        { from: 'test', to: 'fix', on: 'failure' },
        { from: 'fix', to: 'test' },
      ])
    ).toContainEqual(expect.stringContaining('cycle'));
  });
});

describe('join mode', () => {
  it('accepts join: any and keeps it on the node', () => {
    const result = validateFlow(
      flow([
        { from: 'test', to: 'fix', on: 'failure' },
        { from: 'test', to: 'ship' },
      ])
    );
    expect(result.valid).toBe(true);

    const withJoin = validateFlow({
      version: 1,
      name: 'joins',
      nodes: [
        { id: 'a', type: 'shell', run: 'ls' },
        { id: 'b', type: 'shell', run: 'ls' },
        { id: 'meet', type: 'agent', prompt: 'p', join: 'any' },
      ],
      edges: [
        { from: 'a', to: 'meet' },
        { from: 'b', to: 'meet' },
      ],
    });
    expect(withJoin.valid).toBe(true);
    expect(withJoin.valid && withJoin.flow.nodes[2]).toMatchObject({ join: 'any' });
  });

  it('absence means all, so every existing flow is unchanged', () => {
    const result = validateFlow(flow([{ from: 'test', to: 'ship' }]));

    expect(result.valid).toBe(true);
    expect(result.valid && result.flow.nodes[0].join).toBeUndefined();
  });

  it('rejects any other join value', () => {
    const result = validateFlow({
      version: 1,
      name: 'joins',
      nodes: [{ id: 'a', type: 'agent', prompt: 'p', join: 'most' }],
      edges: [],
    });

    expect(result.valid).toBe(false);
    expect(
      !result.valid && result.errors.map((error) => error.path)
    ).toContain('nodes[0].join');
  });
});
