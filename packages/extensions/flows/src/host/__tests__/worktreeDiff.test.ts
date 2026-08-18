// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getChangedFiles, getFileDiff } from '../worktreeDiff';

describe('getChangedFiles', () => {
  it('invokes worktree:get-changed-files with the path and returns the files', async () => {
    const files = [{ path: 'src/a.ts', status: 'modified', staged: false }];
    const ipc = { invoke: vi.fn(async () => ({ success: true, files })) };
    const result = await getChangedFiles(ipc, '/wt/review-2');
    expect(ipc.invoke).toHaveBeenCalledWith('worktree:get-changed-files', '/wt/review-2');
    expect(result).toEqual(files);
  });

  it('returns [] on {success:false}', async () => {
    const ipc = { invoke: vi.fn(async () => ({ success: false })) };
    expect(await getChangedFiles(ipc, '/wt/x')).toEqual([]);
  });

  it('returns [] when invoke throws', async () => {
    const ipc = { invoke: vi.fn(async () => { throw new Error('no worktree'); }) };
    expect(await getChangedFiles(ipc, '/wt/x')).toEqual([]);
  });
});

describe('getFileDiff', () => {
  it('invokes worktree:get-file-diff with path and filePath and returns the diff', async () => {
    const diff = { filePath: 'src/a.ts', diff: '@@ -1 +1 @@\n-old\n+new', status: 'modified' };
    const ipc = { invoke: vi.fn(async () => ({ success: true, diff })) };
    const result = await getFileDiff(ipc, '/wt/review-2', 'src/a.ts');
    expect(ipc.invoke).toHaveBeenCalledWith('worktree:get-file-diff', '/wt/review-2', 'src/a.ts');
    expect(result).toEqual(diff);
  });

  it('returns null on {success:false} and when invoke throws', async () => {
    const off = { invoke: vi.fn(async () => ({ success: false })) };
    expect(await getFileDiff(off, '/wt/x', 'a.ts')).toBeNull();
    const boom = { invoke: vi.fn(async () => { throw new Error('gone'); }) };
    expect(await getFileDiff(boom, '/wt/x', 'a.ts')).toBeNull();
  });
});
