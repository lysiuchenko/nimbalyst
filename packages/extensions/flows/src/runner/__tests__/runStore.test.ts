// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RunStore, type RunFileWriter } from '../runStore';
import type { RunState } from '../types';

function writer(): RunFileWriter & { written: { path: string; content: string }[] } {
  const written: { path: string; content: string }[] = [];
  return {
    written,
    write: async (path, content) => {
      written.push({ path, content });
    },
  };
}

const state: RunState = {
  runId: 'run-7',
  flowName: 'review-pipeline',
  status: 'done',
  startedAt: 1000,
  finishedAt: 4000,
  nodes: {
    plan: {
      nodeId: 'plan',
      status: 'done',
      output: '# Plan',
      sessionId: 'session-a',
      usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
      startedAt: 1000,
      finishedAt: 2000,
    },
    gate: { nodeId: 'gate', status: 'skipped' },
  },
  outputs: { plan: { plan_md: '# Plan' } },
  usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
};

describe('RunStore', () => {
  it('writes the run beside the flow under .flow-runs, named for the run', async () => {
    const target = writer();

    await new RunStore(target, '/repo/pipelines/review.flow.json').save(state);

    expect(target.written[0].path).toBe('/repo/pipelines/.flow-runs/run-7.json');
  });

  it('records the flow the run came from', async () => {
    const target = writer();

    await new RunStore(target, '/repo/pipelines/review.flow.json').save(state);
    const saved = JSON.parse(target.written[0].content);

    expect(saved).toMatchObject({
      runId: 'run-7',
      flowName: 'review-pipeline',
      flowPath: '/repo/pipelines/review.flow.json',
      status: 'done',
    });
  });

  it('records every node with its session, cost and timings', async () => {
    const target = writer();

    await new RunStore(target, '/repo/review.flow.json').save(state);
    const saved = JSON.parse(target.written[0].content);

    expect(saved.nodes.plan).toEqual({
      nodeId: 'plan',
      status: 'done',
      output: '# Plan',
      sessionId: 'session-a',
      usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
      startedAt: 1000,
      finishedAt: 2000,
    });
    expect(saved.nodes.gate).toEqual({ nodeId: 'gate', status: 'skipped' });
  });

  it('records the run total so the cost panel does not have to re-add it', async () => {
    const target = writer();

    await new RunStore(target, '/repo/review.flow.json').save(state);

    expect(JSON.parse(target.written[0].content).usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.01,
    });
  });

  it('lists the sessions the run created, so the UI can jump to them', async () => {
    const target = writer();

    await new RunStore(target, '/repo/review.flow.json').save(state);

    expect(JSON.parse(target.written[0].content).sessionIds).toEqual(['session-a']);
  });

  it('rewrites the same file as the run progresses', async () => {
    const target = writer();
    const store = new RunStore(target, '/repo/review.flow.json');

    await store.save({ ...state, status: 'running', finishedAt: undefined });
    await store.save(state);

    expect(target.written.map((entry) => entry.path)).toEqual([
      '/repo/.flow-runs/run-7.json',
      '/repo/.flow-runs/run-7.json',
    ]);
    expect(JSON.parse(target.written[0].content).status).toBe('running');
    expect(JSON.parse(target.written[1].content).status).toBe('done');
  });

  it('writes readable JSON ending in a newline', async () => {
    const target = writer();

    await new RunStore(target, '/repo/review.flow.json').save(state);

    expect(target.written[0].content).toMatch(/^\{\n {2}"runId"/);
    expect(target.written[0].content.endsWith('\n')).toBe(true);
  });

  it('handles a flow at the workspace root', async () => {
    const target = writer();

    await new RunStore(target, 'review.flow.json').save(state);

    expect(target.written[0].path).toBe('.flow-runs/run-7.json');
  });
});
