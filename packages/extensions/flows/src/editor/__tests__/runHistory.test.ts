// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadRunHistory, loadRunTimeline } from '../runHistory';
import type { RunTimeline } from '../../runner/runTimeline';
import type { WorkspaceFiles } from '../../host/workspaceScan';

function record(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    runId: 'run-1',
    flowName: 'pipeline',
    flowPath: '/repo/pipeline.flow.json',
    status: 'done',
    startedAt: 1000,
    finishedAt: 2000,
    nodes: {},
    outputs: {},
    usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
    sessionIds: [],
    ...overrides,
  });
}

function files(contents: Record<string, string>) {
  return {
    findFiles: vi.fn(async () => Object.keys(contents)),
    readFile: vi.fn(async (path: string) => {
      const found = contents[path];
      if (found === undefined) throw new Error('missing');
      return found;
    }),
  };
}

describe('loadRunHistory', () => {
  it('globs with a literal .flow-runs prefix, because the host skips hidden dirs while walking', async () => {
    const fs = files({});

    await loadRunHistory(fs, '/repo/review.flow.json', '/repo');

    expect(fs.findFiles).toHaveBeenCalledWith('.flow-runs/*.json');
  });

  it('keeps the flow\'s own subdirectory in the glob', async () => {
    const fs = files({});

    await loadRunHistory(fs, '/repo/pipelines/review.flow.json', '/repo');

    expect(fs.findFiles).toHaveBeenCalledWith('pipelines/.flow-runs/*.json');
  });

  it('reads the runs it finds', async () => {
    const fs = files({ '/repo/.flow-runs/run-1.json': record() });

    const runs = await loadRunHistory(fs, '/repo/pipeline.flow.json');

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId: 'run-1', status: 'done' });
  });

  it('puts the most recent run first', async () => {
    const fs = files({
      '/repo/.flow-runs/a.json': record({ runId: 'older', startedAt: 1000 }),
      '/repo/.flow-runs/b.json': record({ runId: 'newer', startedAt: 5000 }),
    });

    const runs = await loadRunHistory(fs, '/repo/pipeline.flow.json');

    expect(runs.map((r) => r.runId)).toEqual(['newer', 'older']);
  });

  it('only shows runs of this flow, not of a sibling in the same folder', async () => {
    const fs = files({
      '/repo/.flow-runs/a.json': record({ runId: 'mine', flowPath: '/repo/pipeline.flow.json' }),
      '/repo/.flow-runs/b.json': record({ runId: 'theirs', flowPath: '/repo/other.flow.json' }),
    });

    const runs = await loadRunHistory(fs, '/repo/pipeline.flow.json');

    expect(runs.map((r) => r.runId)).toEqual(['mine']);
  });

  it('skips a record that is not readable JSON rather than failing the panel', async () => {
    const fs = files({
      '/repo/.flow-runs/broken.json': 'not json',
      '/repo/.flow-runs/good.json': record(),
    });

    const runs = await loadRunHistory(fs, '/repo/pipeline.flow.json');

    expect(runs.map((r) => r.runId)).toEqual(['run-1']);
  });

  it('returns nothing when the flow has never been run', async () => {
    const fs = {
      findFiles: vi.fn(async () => {
        throw new Error('no such directory');
      }),
      readFile: vi.fn(async () => ''),
    };

    await expect(loadRunHistory(fs, '/repo/pipeline.flow.json')).resolves.toEqual([]);
  });

  it('keeps only the most recent runs, so an old flow does not render hundreds', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `/repo/.flow-runs/${i}.json`,
        record({ runId: `run-${i}`, startedAt: i }),
      ])
    );

    const runs = await loadRunHistory(files(many), '/repo/pipeline.flow.json');

    expect(runs).toHaveLength(20);
    expect(runs[0].runId).toBe('run-39');
  });
});

const timeline: RunTimeline = { runId: 'run1', flowPath: '/w/f.flow.json', frames: [{ at: 0, nodeId: 'a', status: 'done' }] };

function filesReturning(map: Record<string, string>): WorkspaceFiles {
  return {
    findFiles: async () => Object.keys(map),
    readFile: async (path: string) => {
      if (path in map) return map[path];
      throw new Error(`ENOENT ${path}`);
    },
  } as unknown as WorkspaceFiles;
}

describe('loadRunTimeline', () => {
  it('reads and parses <runId>.timeline.json next to the record', async () => {
    const files = filesReturning({ '/w/.flow-runs/run1.timeline.json': JSON.stringify(timeline) });
    const loaded = await loadRunTimeline(files, '/w/f.flow.json', 'run1');
    expect(loaded?.runId).toBe('run1');
    expect(loaded?.frames).toHaveLength(1);
  });

  it('returns null when the timeline file is missing', async () => {
    const files = filesReturning({});
    expect(await loadRunTimeline(files, '/w/f.flow.json', 'run1')).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    const files = filesReturning({ '/w/.flow-runs/run1.timeline.json': '{ not json' });
    expect(await loadRunTimeline(files, '/w/f.flow.json', 'run1')).toBeNull();
  });
});
