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

    const records = target.written.filter((entry) => entry.path.endsWith('run-7.json'));
    expect(records.map((entry) => entry.path)).toEqual([
      '/repo/.flow-runs/run-7.json',
      '/repo/.flow-runs/run-7.json',
    ]);
    expect(JSON.parse(records[0].content).status).toBe('running');
    expect(JSON.parse(records[1].content).status).toBe('done');
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

  it('makes the run directory ignore itself, so outputs are never committed', async () => {
    const written: Record<string, string> = {};
    const store = new RunStore(
      { write: async (path, content) => void (written[path] = content) },
      'flows/release.flow.json'
    );

    await store.save({
      runId: 'r1',
      flowName: 'release',
      status: 'done',
      startedAt: 0,
      nodes: {},
      outputs: {},
      usage: { inputTokens: 0, outputTokens: 0 },
    } as never);

    // Records carry step output, so they inherit whatever a flow touched.
    expect(written['flows/.flow-runs/.gitignore']).toContain('*');
  });

  it('writes the ignore file once, not on every save', async () => {
    const writes: string[] = [];
    const store = new RunStore({ write: async (path) => void writes.push(path) }, 'a.flow.json');
    const state = {
      runId: 'r1',
      flowName: 'a',
      status: 'running',
      startedAt: 0,
      nodes: {},
      outputs: {},
      usage: { inputTokens: 0, outputTokens: 0 },
    } as never;

    await store.save(state);
    await store.save(state);

    expect(writes.filter((path) => path.endsWith('.gitignore'))).toHaveLength(1);
  });
});
