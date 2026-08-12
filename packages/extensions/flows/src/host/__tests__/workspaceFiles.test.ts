// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceFiles } from '../workspaceFiles';

describe('createWorkspaceFiles', () => {
  it('scans through IPC with the currently rendered workspace path', async () => {
    const base = {
      findFiles: vi.fn(async () => ['wrong.flow.json']),
      readFile: vi.fn(async () => 'contents'),
    };
    const ipc = { invoke: vi.fn(async () => ['/new/right.flow.json']) };
    const files = createWorkspaceFiles(base, '/new', ipc);

    await expect(files.findFiles('*.flow.json')).resolves.toEqual(['/new/right.flow.json']);
    expect(ipc.invoke).toHaveBeenCalledWith('extensions:find-files', '/new', '*.flow.json');
    expect(base.findFiles).not.toHaveBeenCalled();
  });

  it('rejects malformed IPC results at the host boundary', async () => {
    const base = { findFiles: vi.fn(), readFile: vi.fn() };
    const files = createWorkspaceFiles(base, '/repo', {
      invoke: vi.fn(async () => ['good.flow.json', 42]),
    });

    await expect(files.findFiles('*.flow.json')).rejects.toThrow(
      'extensions:find-files returned an invalid file list'
    );
  });

  it('uses the activation filesystem outside Electron', async () => {
    const base = {
      findFiles: vi.fn(async () => ['portable.flow.json']),
      readFile: vi.fn(async () => 'contents'),
    };
    const files = createWorkspaceFiles(base, '/repo');

    await expect(files.findFiles('*.flow.json')).resolves.toEqual(['portable.flow.json']);
    await expect(files.readFile('/repo/portable.flow.json')).resolves.toBe('contents');
  });

  it('refuses to create an ambiguously scoped filesystem', () => {
    const base = { findFiles: vi.fn(), readFile: vi.fn() };

    expect(() => createWorkspaceFiles(base, '   ')).toThrow('workspace path is required');
  });
});
