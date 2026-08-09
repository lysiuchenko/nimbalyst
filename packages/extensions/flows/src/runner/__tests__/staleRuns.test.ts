// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isStale, repairStale, STALE_AFTER_MS } from '../staleRuns';
import type { RunRecord } from '../runStore';

const record = (over: Partial<RunRecord> = {}): RunRecord =>
  ({
    runId: 'run-1',
    flowName: 'f',
    flowPath: '/f.flow.json',
    status: 'running',
    startedAt: 1_000,
    updatedAt: 1_000,
    nodes: {},
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    sessionIds: [],
    ...over,
  }) as RunRecord;

const now = 1_000 + STALE_AFTER_MS + 1;

describe('isStale', () => {
  it('treats a running record nobody has written to in a while as abandoned', () => {
    expect(isStale(record(), null, now)).toBe(true);
  });

  it('leaves the run this editor is driving alone, however long it takes', () => {
    expect(isStale(record({ runId: 'run-7' }), 'run-7', now)).toBe(false);
  });

  it('leaves a recently written run alone, since it may still be working', () => {
    expect(isStale(record({ updatedAt: now - 1_000 }), null, now)).toBe(false);
  });

  it('never touches a run that already settled', () => {
    expect(isStale(record({ status: 'done' }), null, now)).toBe(false);
    expect(isStale(record({ status: 'failed' }), null, now)).toBe(false);
  });

  it('falls back to the start time for records written before heartbeats existed', () => {
    const legacy = record();
    delete (legacy as Partial<RunRecord>).updatedAt;

    expect(isStale(legacy, null, now)).toBe(true);
  });
});

describe('repairStale', () => {
  it('rewrites an abandoned run so it stops claiming to be running', async () => {
    const written: Record<string, string> = {};
    const records = [record({ runId: 'a' }), record({ runId: 'b', status: 'done' })];

    const repaired = await repairStale(
      records,
      null,
      { write: async (path, content) => void (written[path] = content) },
      (runId) => `.flow-runs/${runId}.json`,
      now
    );

    expect(repaired.map((r) => r.status)).toEqual(['interrupted', 'done']);
    expect(Object.keys(written)).toEqual(['.flow-runs/a.json']);
    expect(JSON.parse(written['.flow-runs/a.json']).status).toBe('interrupted');
  });

  it('reports the records unchanged when a write fails, rather than losing the history', async () => {
    const repaired = await repairStale(
      [record({ runId: 'a' })],
      null,
      {
        write: async () => {
          throw new Error('read-only workspace');
        },
      },
      (runId) => `${runId}.json`,
      now
    );

    expect(repaired[0].status).toBe('interrupted');
  });

  it('writes nothing when there is nothing to repair', async () => {
    const written: string[] = [];

    await repairStale(
      [record({ status: 'done' })],
      null,
      { write: async (path) => void written.push(path) },
      (runId) => `${runId}.json`,
      now
    );

    expect(written).toEqual([]);
  });
});
