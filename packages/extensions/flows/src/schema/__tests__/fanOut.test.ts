// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../validate';

function flowWith(node: Record<string, unknown>) {
  return {
    version: 1,
    name: 'fan',
    nodes: [{ id: 'list', type: 'shell', run: 'ls', output: 'files' }, node],
    edges: [{ from: 'list', to: 'fan', port: 'files' }],
    variables: {},
  };
}

const valid = {
  id: 'fan',
  type: 'fan-out',
  prompt: 'Review {{item}}',
  over: '{{list.files}}',
  output: 'reviews',
};

describe('fan-out node', () => {
  it('is a valid node type', () => {
    expect(validateFlow(flowWith(valid)).valid).toBe(true);
  });

  it('requires a prompt, since that is what each sub-agent runs', () => {
    const result = validateFlow(flowWith({ ...valid, prompt: '' }));

    expect(!result.valid && result.errors[0].path).toBe('nodes[1].prompt');
  });

  it('requires something to fan out over', () => {
    const { over: _dropped, ...withoutOver } = valid;
    const result = validateFlow(flowWith(withoutOver));

    expect(!result.valid && result.errors[0].path).toBe('nodes[1].over');
  });

  it('accepts an explicit concurrency limit', () => {
    expect(validateFlow(flowWith({ ...valid, concurrency: 3 })).valid).toBe(true);
  });

  it('rejects a concurrency that is not a positive whole number', () => {
    for (const concurrency of [0, -1, 2.5, 'lots']) {
      const result = validateFlow(flowWith({ ...valid, concurrency }));
      expect(!result.valid && result.errors[0].path).toBe('nodes[1].concurrency');
    }
  });

  it('keeps the fan-out fields through a round trip', () => {
    const result = validateFlow(flowWith({ ...valid, concurrency: 4 }));

    expect(result.valid && result.flow.nodes[1]).toMatchObject({
      prompt: 'Review {{item}}',
      over: '{{list.files}}',
      concurrency: 4,
    });
  });
});
