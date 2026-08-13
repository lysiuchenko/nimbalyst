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
