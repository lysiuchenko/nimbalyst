// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadAllRuns } from '../loadAllRuns';

const files = (paths: string[], contents: Record<string, string>) => ({
  findFiles: vi.fn(async () => paths),
  readFile: vi.fn(async (path: string) => contents[path] ?? ''),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
});

describe('loadAllRuns', () => {
  it('reads every run, newest first', async () => {
    const records = await loadAllRuns(
      files(['.flow-runs/a.json', '.flow-runs/b.json'], {
        '.flow-runs/a.json': JSON.stringify({ runId: 'a', startedAt: 1 }),
        '.flow-runs/b.json': JSON.stringify({ runId: 'b', startedAt: 2 }),
      }) as never
    );

    expect(records.map((record) => record.runId)).toEqual(['b', 'a']);
  });

  it('ignores schedule state, which lives in the same directory', async () => {
    const records = await loadAllRuns(
      files(['.flow-runs/a.flow.json.schedule.json', '.flow-runs/a.json'], {
        '.flow-runs/a.flow.json.schedule.json': JSON.stringify({ dueAt: 1 }),
        '.flow-runs/a.json': JSON.stringify({ runId: 'a', startedAt: 1 }),
      }) as never
    );

    expect(records.map((record) => record.runId)).toEqual(['a']);
  });

  it('survives a half-written record rather than showing nothing', async () => {
    const records = await loadAllRuns(
      files(['.flow-runs/bad.json', '.flow-runs/a.json'], {
        '.flow-runs/bad.json': '{ not json',
        '.flow-runs/a.json': JSON.stringify({ runId: 'a', startedAt: 1 }),
      }) as never
    );

    expect(records).toHaveLength(1);
  });
});
