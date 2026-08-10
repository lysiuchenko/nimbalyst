// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { loadFlowFiles } from '../loadFlowFiles';

function filesystem(entries: Record<string, string>) {
  return {
    findFiles: async () => Object.keys(entries),
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
    const [flow] = await loadFlowFiles(filesystem({ 'release.flow.json': valid }));

    expect(flow.flowName).toBe('Nightly release notes');
    expect(flow.schedule).toMatchObject({ type: 'daily', time: '02:00' });
  });

  test('still lists a flow that will not parse, under its filename', async () => {
    const [flow] = await loadFlowFiles(filesystem({ 'deep/broken.flow.json': '{ oops' }));

    expect(flow).toEqual({
      flowPath: 'deep/broken.flow.json',
      flowName: 'broken',
      schedule: null,
    });
  });

  test('is empty rather than throwing when the workspace cannot be scanned', async () => {
    const files = {
      findFiles: async () => {
        throw new Error('no host');
      },
      readFile: async () => '',
    };

    await expect(loadFlowFiles(files)).resolves.toEqual([]);
  });
});
