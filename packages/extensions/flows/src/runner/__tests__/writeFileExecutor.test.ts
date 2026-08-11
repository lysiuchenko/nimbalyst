// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { createWriteFileExecutor } from '../executors';
import type { FlowNode } from '../../schema/types';
import type { RunFileWriter } from '../runStore';

function recordingWriter() {
  const written: Array<{ path: string; content: string }> = [];
  const writer: RunFileWriter = {
    write: async (path, content) => {
      written.push({ path, content });
    },
  };
  return { writer, written };
}

const node = { id: 'save', type: 'write-file', path: 'out.md', content: 'x' } as FlowNode;

function run(
  writer: RunFileWriter,
  resolved: Record<string, string>,
  over: Partial<FlowNode> = {}
) {
  return createWriteFileExecutor(writer)({
    node: { ...node, ...over } as FlowNode,
    resolved,
    variables: {},
    signal: new AbortController().signal,
  });
}

describe('createWriteFileExecutor', () => {
  test('writes the resolved content to the resolved path', async () => {
    const { writer, written } = recordingWriter();

    await run(writer, { path: 'RELEASE_NOTES.md', content: '# 1.2.0\n\n- a thing' });

    expect(written).toEqual([{ path: 'RELEASE_NOTES.md', content: '# 1.2.0\n\n- a thing' }]);
  });

  test('reports the path it wrote, so the run record says where the work went', async () => {
    const { writer } = recordingWriter();

    const result = await run(writer, { path: 'notes/a.md', content: 'hello' });

    expect(result.output).toContain('notes/a.md');
  });

  test('normalises the path before writing it', async () => {
    const { writer, written } = recordingWriter();

    await run(writer, { path: './notes/../notes/a.md', content: 'x' });

    expect(written[0].path).toBe('notes/a.md');
  });

  test('an empty string is a legitimate file, not a failure', async () => {
    const { writer, written } = recordingWriter();

    await run(writer, { path: 'empty.md', content: '' });

    expect(written).toEqual([{ path: 'empty.md', content: '' }]);
  });

  test('refuses to escape the workspace, and writes nothing', async () => {
    const { writer, written } = recordingWriter();

    await expect(run(writer, { path: '../outside.md', content: 'x' })).rejects.toThrow(
      'cannot leave the workspace'
    );
    expect(written).toEqual([]);
  });

  test('refuses to write into .git', async () => {
    const { writer, written } = recordingWriter();

    await expect(run(writer, { path: '.git/config', content: 'x' })).rejects.toThrow('.git');
    expect(written).toEqual([]);
  });

  // A failed write must fail the node: reporting success while nothing reached
  // disk is the outcome this whole node type exists to avoid.
  test('surfaces a filesystem failure rather than swallowing it', async () => {
    const writer: RunFileWriter = {
      write: async () => {
        throw new Error('EACCES: permission denied');
      },
    };

    await expect(run(writer, { path: 'a.md', content: 'x' })).rejects.toThrow('EACCES');
  });
});
