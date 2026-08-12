// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { loadFlowFiles } from '../loadFlowFiles';

function filesystem(entries: Record<string, string>) {
  return {
    findFiles: async () => Object.keys(entries).filter((path) => path.endsWith('.flow.json')),
    readFile: async (path: string) => {
      const found = entries[path];
      if (found === undefined) throw new Error(`no such file: ${path}`);
      return found;
    },
  };
}

const valid = JSON.stringify({
  version: 1,
  name: 'Nightly release notes',
  nodes: [{ id: 'a', type: 'shell', run: 'ls' }],
  edges: [],
  schedule: { type: 'daily', time: '02:00', enabled: true },
});

describe('loadFlowFiles', () => {
  test('reads the declared name and schedule', async () => {
    const [flow] = await loadFlowFiles(filesystem({ 'release.flow.json': valid }), 100);

    expect(flow.flowName).toBe('Nightly release notes');
    expect(flow.schedule).toMatchObject({ type: 'daily', time: '02:00' });
    expect(flow.valid).toBe(true);
    expect(flow.problems).toEqual([]);
    expect(flow.nextRunAt).not.toBeNull();
  });

  test('still lists a flow that will not parse, under its filename', async () => {
    const [flow] = await loadFlowFiles(filesystem({ 'deep/broken.flow.json': '{ oops' }));

    expect(flow).toMatchObject({
      flowPath: 'deep/broken.flow.json',
      flowName: 'broken',
      schedule: null,
      valid: false,
    });
    expect(flow.problems).toHaveLength(1);
  });

  test('uses a persisted interval deadline instead of pushing it forward on every load', async () => {
    const dueAt = 4_000;
    const interval = JSON.stringify({
      version: 1,
      name: 'Frequent',
      nodes: [{ id: 'a', type: 'shell', run: 'ls' }],
      edges: [],
      schedule: { type: 'interval', intervalMinutes: 30, enabled: true },
    });
    const [flow] = await loadFlowFiles(
      filesystem({
        'frequent.flow.json': interval,
        '.flow-runs/frequent.flow.json.schedule.json': JSON.stringify({
          dueAt,
        }),
      }),
      1_000
    );

    expect(flow.nextRunAt).toBe(dueAt);
  });

  test('extracts a fallback name from a Windows path', async () => {
    const [flow] = await loadFlowFiles(
      filesystem({ 'C:\\repo\\deep\\broken.flow.json': '{ oops' })
    );

    expect(flow.flowName).toBe('broken');
  });

  test('throws when the workspace cannot be scanned so the panel can recover', async () => {
    const files = {
      findFiles: async () => {
        throw new Error('no host');
      },
      readFile: async () => '',
    };

    await expect(loadFlowFiles(files)).rejects.toThrow('no host');
  });
});
