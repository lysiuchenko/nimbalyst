// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { edgePayload, nodeReliability } from '../observability';
import type { RunRecord } from '../../runner/runStore';

describe('edgePayload', () => {
  const outputs = {
    plan: { plan_md: '# the plan', notes: 'aside' },
    gate: { error: 'rejected by the reviewer' },
    solo: { only: 'one value' },
  };

  it('a port edge reads the named output', () => {
    expect(edgePayload({ from: 'plan', to: 'x', port: 'plan_md' }, outputs)).toEqual({
      label: 'plan.plan_md',
      value: '# the plan',
    });
  });

  it('a failure edge reads the error it routes', () => {
    expect(edgePayload({ from: 'gate', to: 'x', on: 'failure' }, outputs)).toEqual({
      label: 'gate.error',
      value: 'rejected by the reviewer',
    });
  });

  it('an unnamed edge falls back to the single output of its from-node', () => {
    expect(edgePayload({ from: 'solo', to: 'x' }, outputs)).toEqual({
      label: 'solo.only',
      value: 'one value',
    });
    // Ambiguous — two outputs and no port names neither.
    expect(edgePayload({ from: 'plan', to: 'x' }, outputs)).toBeNull();
  });

  it('says nothing when nothing was recorded', () => {
    expect(edgePayload({ from: 'plan', to: 'x', port: 'plan_md' }, undefined)).toBeNull();
    expect(edgePayload({ from: 'ghost', to: 'x', port: 'p' }, outputs)).toBeNull();
  });
});

describe('nodeReliability', () => {
  const record = (nodes: RunRecord['nodes']): RunRecord =>
    ({
      runId: 'r',
      flowName: 'f',
      flowPath: '/w/f.flow.json',
      status: 'done',
      startedAt: 0,
      nodes,
      outputs: {},
      usage: { inputTokens: 0, outputTokens: 0 },
      sessionIds: [],
    }) as RunRecord;

  it('counts done as ok and failed as against, per node across records', () => {
    const map = nodeReliability([
      record({
        a: { nodeId: 'a', type: 'shell', status: 'done' },
        b: { nodeId: 'b', type: 'agent', status: 'failed' },
      }),
      record({
        a: { nodeId: 'a', type: 'shell', status: 'done' },
        b: { nodeId: 'b', type: 'agent', status: 'done' },
      }),
    ]);
    expect(map.a).toEqual({ ok: 2, total: 2 });
    expect(map.b).toEqual({ ok: 1, total: 2 });
  });

  it('skipped, queued and running are not evidence either way', () => {
    const map = nodeReliability([
      record({
        a: { nodeId: 'a', type: 'shell', status: 'skipped' },
        b: { nodeId: 'b', type: 'agent', status: 'running' },
        c: { nodeId: 'c', type: 'agent', status: 'queued' },
      }),
    ]);
    expect(map).toEqual({});
  });

  it('a reused execution counts as done — it did succeed', () => {
    const map = nodeReliability([
      record({ a: { nodeId: 'a', type: 'shell', status: 'done', reused: true } }),
    ]);
    expect(map.a).toEqual({ ok: 1, total: 1 });
  });
});
