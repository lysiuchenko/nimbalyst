// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { replayStatuses, replayDuration } from '../replay';
import type { RunRecord } from '../../runner/runStore';

const record = {
  runId: 'r',
  flowName: 'f',
  flowPath: '/w/f.flow.json',
  status: 'done',
  startedAt: 1_000,
  finishedAt: 61_000,
  nodes: {
    plan: { nodeId: 'plan', type: 'agent', status: 'done', startedAt: 1_000, finishedAt: 21_000 },
    gate: {
      nodeId: 'gate',
      type: 'human-gate',
      status: 'failed',
      startedAt: 21_000,
      finishedAt: 41_000,
    },
    late: { nodeId: 'late', type: 'shell', status: 'skipped' },
    hung: { nodeId: 'hung', type: 'agent', status: 'running', startedAt: 41_000 },
  },
  outputs: {},
  usage: { inputTokens: 0, outputTokens: 0 },
  sessionIds: [],
} as unknown as RunRecord;

describe('replayStatuses', () => {
  it('walks a node through queued silence, running, and its final status', () => {
    expect(replayStatuses(record, 0).gate).toBeUndefined();
    expect(replayStatuses(record, 10_000).plan).toBe('running');
    expect(replayStatuses(record, 20_000).plan).toBe('done');
    expect(replayStatuses(record, 30_000).gate).toBe('running');
    expect(replayStatuses(record, 40_000).gate).toBe('failed');
  });

  it('a step with no timings appears only at the end, with its recorded status', () => {
    expect(replayStatuses(record, 30_000).late).toBeUndefined();
    expect(replayStatuses(record, 60_000).late).toBe('skipped');
  });

  it('a step that never finished stays running to the end', () => {
    expect(replayStatuses(record, 59_000).hung).toBe('running');
    expect(replayStatuses(record, 60_000).hung).toBe('running');
  });
});

describe('replayDuration', () => {
  it('is the run length, and zero when the record never finished', () => {
    expect(replayDuration(record)).toBe(60_000);
    expect(replayDuration({ ...record, finishedAt: undefined } as RunRecord)).toBe(0);
  });
});

import { replayState, replayTimelineDuration } from '../replay';
import type { RunTimeline } from '../../runner/runTimeline';

const timeline: RunTimeline = {
  runId: 'r', flowPath: '/w/f.flow.json',
  frames: [
    { at: 1_000, nodeId: 'plan', status: 'running' },
    { at: 1_000, nodeId: 'plan', status: 'running', output: 'draft…' },
    { at: 21_000, nodeId: 'plan', status: 'done', output: 'final plan' },
    { at: 21_000, nodeId: 'fan', status: 'running', children: [
      { label: 'c1', status: 'running' }, { label: 'c2', status: 'queued' },
    ] },
    { at: 41_000, nodeId: 'fan', status: 'done', children: [
      { label: 'c1', status: 'done' }, { label: 'c2', status: 'done' },
    ] },
  ],
};

describe('replayState', () => {
  it('is empty before the first frame', () => {
    const s = replayState(timeline, -1);
    expect(s.statuses).toEqual({});
    expect(s.results).toEqual({});
    expect(s.children).toEqual({});
  });

  it('carries a running node\'s partial output and fan-out children mid-run', () => {
    const s = replayState(timeline, 20_000); // firstAt 1_000 + 20_000 = 21_000
    expect(s.statuses.plan).toBe('done');
    expect(s.results.plan.output).toBe('final plan');
    expect(s.statuses.fan).toBe('running');
    expect(s.children.fan.map((c) => c.status)).toEqual(['running', 'queued']);
  });

  it('carries final output/children past the last frame', () => {
    const s = replayState(timeline, 999_000);
    expect(s.results.plan.output).toBe('final plan');
    expect(s.children.fan.map((c) => c.status)).toEqual(['done', 'done']);
    expect(s.statuses.fan).toBe('done');
  });

  it('omits a node with no frame yet at atMs', () => {
    const s = replayState(timeline, 5_000); // 6_000 — only plan has fired
    expect(s.results.fan).toBeUndefined();
    expect(s.statuses.fan).toBeUndefined();
  });
});

describe('replayTimelineDuration', () => {
  it('spans first to last frame', () => {
    expect(replayTimelineDuration(timeline)).toBe(40_000);
  });
  it('is 0 for an empty timeline', () => {
    expect(replayTimelineDuration({ runId: 'r', flowPath: 'f', frames: [] })).toBe(0);
  });
});
