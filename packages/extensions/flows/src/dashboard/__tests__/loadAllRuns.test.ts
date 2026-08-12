// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadAllRuns } from '../loadAllRuns';

const files = (paths: string[], contents: Record<string, string>) => ({
  findFiles: vi.fn(async () => paths),
  readFile: vi.fn(async (path: string) => contents[path] ?? ''),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
});

const record = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    runId: 'a',
    flowName: 'nightly',
    flowPath: 'nightly.flow.json',
    status: 'done',
    startedAt: 1,
    nodes: {},
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    sessionIds: [],
    ...over,
  });

describe('loadAllRuns', () => {
  it('reads every run, newest first', async () => {
    const result = await loadAllRuns(
      files(['.flow-runs/a.json', '.flow-runs/b.json'], {
        '.flow-runs/a.json': record(),
        '.flow-runs/b.json': record({ runId: 'b', startedAt: 2 }),
      }) as never
    );

    expect(result.records.map((entry) => entry.runId)).toEqual(['b', 'a']);
    expect(result.problems).toEqual([]);
  });

  it('ignores schedule state, which lives in the same directory', async () => {
    const result = await loadAllRuns(
      files(['.flow-runs/a.flow.json.schedule.json', '.flow-runs/a.json'], {
        '.flow-runs/a.flow.json.schedule.json': JSON.stringify({ dueAt: 1 }),
        '.flow-runs/a.json': record(),
      }) as never
    );

    expect(result.records.map((entry) => entry.runId)).toEqual(['a']);
  });

  it('survives a half-written record rather than showing nothing', async () => {
    const result = await loadAllRuns(
      files(['.flow-runs/bad.json', '.flow-runs/a.json'], {
        '.flow-runs/bad.json': '{ not json',
        '.flow-runs/a.json': record(),
      }) as never
    );

    expect(result.records).toHaveLength(1);
    expect(result.problems).toEqual([{ path: '.flow-runs/bad.json' }]);
  });

  it('rejects a record with no traceable flow path instead of crashing later', async () => {
    const result = await loadAllRuns(
      files(['.flow-runs/bad.json'], {
        '.flow-runs/bad.json': record({ flowPath: undefined }),
      }) as never
    );

    expect(result.records).toEqual([]);
    expect(result.problems).toHaveLength(1);
  });

  it('marks an abandoned running record interrupted for dashboard readers', async () => {
    const now = 10 * 60_000;
    const result = await loadAllRuns(
      files(['.flow-runs/a.json'], {
        '.flow-runs/a.json': record({
          status: 'running',
          startedAt: 1,
          updatedAt: 1,
        }),
      }) as never,
      now
    );

    expect(result.records[0].status).toBe('interrupted');
  });

  it('keeps a recently updated run visibly running', async () => {
    const now = 10 * 60_000;
    const result = await loadAllRuns(
      files(['.flow-runs/a.json'], {
        '.flow-runs/a.json': record({
          status: 'running',
          startedAt: 1,
          updatedAt: now - 1_000,
        }),
      }) as never,
      now
    );

    expect(result.records[0].status).toBe('running');
  });

  it('surfaces a workspace scan failure so the dashboard can offer Retry', async () => {
    const broken = {
      findFiles: async () => {
        throw new Error('workspace unavailable');
      },
      readFile: async () => '',
    };

    await expect(loadAllRuns(broken)).rejects.toThrow('workspace unavailable');
  });
});
