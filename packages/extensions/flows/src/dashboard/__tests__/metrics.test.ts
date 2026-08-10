// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summariseRuns } from '../metrics';
import type { RunRecord } from '../../runner/runStore';

const node = (over: Record<string, unknown>) => ({ status: 'done', type: 'agent', ...over });

const record = (over: Partial<RunRecord> = {}): RunRecord =>
  ({
    runId: 'r1',
    flowName: 'nightly',
    flowPath: '/nightly.flow.json',
    status: 'done',
    startedAt: 0,
    finishedAt: 10_000,
    nodes: {},
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    sessionIds: [],
    ...over,
  }) as RunRecord;

describe('summariseRuns', () => {
  it('counts runs by how they ended', () => {
    const summary = summariseRuns([
      record({ runId: 'a', status: 'done' }),
      record({ runId: 'b', status: 'failed' }),
      record({ runId: 'c', status: 'interrupted' }),
    ]);

    expect(summary.totals).toMatchObject({ runs: 3, done: 1, failed: 1, interrupted: 1 });
  });

  it('separates the time agents spent from the time people spent', () => {
    const summary = summariseRuns([
      record({
        nodes: {
          plan: node({ nodeId: 'plan', startedAt: 0, finishedAt: 4_000 }),
        } as unknown as RunRecord['nodes'],
      }),
    ]);

    expect(summary.agentMs).toBe(4_000);
    expect(summary.humanMs).toBe(0);
  });

  it('counts a gate as human time, because that is a person waiting', () => {
    const summary = summariseRuns([
      record({
        nodes: {
          g: node({ nodeId: 'g', type: 'human-gate', startedAt: 0, finishedAt: 6_000 }),
        } as unknown as RunRecord['nodes'],
      }),
    ]);

    expect(summary.humanMs).toBe(6_000);
    expect(summary.agentMs).toBe(0);
  });

  it('counts the sub-agents a fan-out spawned', () => {
    const summary = summariseRuns([
      record({
        nodes: {
          review: node({
            nodeId: 'review',
            type: 'fan-out',
            startedAt: 0,
            finishedAt: 10_000,
            childSessionIds: ['a', 'b', 'c', 'd'],
          }),
        } as unknown as RunRecord['nodes'],
      }),
    ]);

    expect(summary.subAgents).toBe(4);
  });

  it('admits it does not know the token spend rather than reporting zero', () => {
    expect(summariseRuns([record()]).tokens).toBeNull();
  });

  it('adds up real token usage when there is any', () => {
    const summary = summariseRuns([
      record({ usage: { inputTokens: 100, outputTokens: 20 } }),
      record({ runId: 'b', usage: { inputTokens: 5, outputTokens: 1 } }),
    ]);

    expect(summary.tokens).toBe(126);
  });

  it('breaks the numbers down per flow, so one bad flow is visible', () => {
    const summary = summariseRuns([
      record({ flowName: 'nightly', flowPath: '/a', status: 'done' }),
      record({ runId: 'b', flowName: 'release', flowPath: '/b', status: 'failed' }),
      record({ runId: 'c', flowName: 'release', flowPath: '/b', status: 'failed' }),
    ]);

    const release = summary.byFlow.find((flow) => flow.flowName === 'release');
    expect(release).toMatchObject({ runs: 2, failed: 2 });
  });

  it('has something to say about no runs at all', () => {
    const summary = summariseRuns([]);

    expect(summary.totals.runs).toBe(0);
    expect(summary.byFlow).toEqual([]);
  });

  it('estimates time saved from the flow author\'s own baseline', () => {
    const summary = summariseRuns([
      record({
        runId: 'a',
        manualBaselineMinutes: 90,
        nodes: {
          g: node({ nodeId: 'g', type: 'human-gate', startedAt: 0, finishedAt: 600_000 }),
        } as unknown as RunRecord['nodes'],
      }),
    ]);

    // 90 minutes by hand, minus the 10 a person actually spent at the gate.
    expect(summary.savedMs).toBe(80 * 60_000);
  });

  it('adds up the saving across every run that has a baseline', () => {
    const summary = summariseRuns([
      record({ runId: 'a', manualBaselineMinutes: 30 }),
      record({ runId: 'b', manualBaselineMinutes: 30 }),
    ]);

    expect(summary.savedMs).toBe(60 * 60_000);
  });

  it('has no estimate when nobody supplied a baseline', () => {
    // Rather than invent a multiplier, the figure is simply absent.
    expect(summariseRuns([record({ runId: 'a' })]).savedMs).toBeNull();
  });

  it('ignores runs without a baseline instead of counting them as zero', () => {
    const summary = summariseRuns([
      record({ runId: 'a', manualBaselineMinutes: 30 }),
      record({ runId: 'b' }),
    ]);

    expect(summary.savedMs).toBe(30 * 60_000);
    expect(summary.baselineRuns).toBe(1);
  });

  it('never claims a negative saving when the people took longer', () => {
    const summary = summariseRuns([
      record({
        runId: 'a',
        manualBaselineMinutes: 1,
        nodes: {
          g: node({ nodeId: 'g', type: 'human-gate', startedAt: 0, finishedAt: 600_000 }),
        } as unknown as RunRecord['nodes'],
      }),
    ]);

    expect(summary.savedMs).toBe(0);
  });

  // Timestamps that are not numbers reached the tiles as NaN, which then
  // poisoned every total it was added to.
  it('ignores a node whose timestamps are not numbers', () => {
    const summary = summariseRuns([
      record({
        nodes: {
          a: node({ nodeId: 'a', startedAt: '2026-08-10T00:00:00Z', finishedAt: 'later' }),
          b: node({ nodeId: 'b', startedAt: 0, finishedAt: 5_000 }),
        } as unknown as RunRecord['nodes'],
      }),
    ]);

    expect(summary.agentMs).toBe(5_000);
  });

  it('records when each flow last ran and how it ended', () => {
    const summary = summariseRuns([
      record({ runId: 'r1', startedAt: 1_000, finishedAt: 2_000, status: 'failed' }),
      record({ runId: 'r2', startedAt: 500, finishedAt: 900, status: 'done' }),
    ]);

    expect(summary.byFlow[0]).toMatchObject({ lastRunAt: 1_000, lastStatus: 'failed' });
  });
});
