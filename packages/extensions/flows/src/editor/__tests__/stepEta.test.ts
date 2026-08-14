// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { stepEtas } from '../stepEta';
import type { RunRecord } from '../../runner/runStore';

const record = (nodes: RunRecord['nodes']): RunRecord =>
  ({ runId: 'r', flowName: 'f', flowPath: '/w/f.flow.json', status: 'done', startedAt: 0,
     nodes, outputs: {}, usage: { inputTokens: 0, outputTokens: 0 }, sessionIds: [] }) as RunRecord;

describe('stepEtas', () => {
  it('takes the median of finished durations per step', () => {
    const etas = stepEtas([
      record({ a: { nodeId: 'a', type: 'agent', status: 'done', startedAt: 0, finishedAt: 60_000 } }),
      record({ a: { nodeId: 'a', type: 'agent', status: 'done', startedAt: 0, finishedAt: 100_000 } }),
      record({ a: { nodeId: 'a', type: 'agent', status: 'done', startedAt: 0, finishedAt: 620_000 } }),
    ]);
    expect(etas.a).toBe(100_000);
  });

  it('failed or timing-less executions are not evidence of duration', () => {
    const etas = stepEtas([
      record({ a: { nodeId: 'a', type: 'agent', status: 'failed', startedAt: 0, finishedAt: 5_000 } }),
      record({ b: { nodeId: 'b', type: 'shell', status: 'done' } }),
    ]);
    expect(etas).toEqual({});
  });

  it('a reused execution has no fresh timing and stays out of the median', () => {
    const etas = stepEtas([
      record({ a: { nodeId: 'a', type: 'agent', status: 'done', reused: true } }),
    ]);
    expect(etas).toEqual({});
  });
});
