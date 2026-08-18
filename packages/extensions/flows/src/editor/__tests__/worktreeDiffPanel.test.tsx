import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorktreeDiffPanel } from '../WorktreeDiffPanel';
import type { ChildProgress } from '../../runner/types';

let container: HTMLDivElement;
let root: Root;
const invoke = vi.fn();

beforeEach(() => {
  invoke.mockReset();
  (window as unknown as { electronAPI: unknown }).electronAPI = { invoke };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const child: ChildProgress = {
  label: 'review[2]',
  status: 'done',
  worktree: { id: 'w2', branch: 'worktree/review-2', path: '/wt/review-2' },
};

const flush = () => act(async () => { await Promise.resolve(); });

describe('WorktreeDiffPanel', () => {
  it('lists the changed files fetched on open', async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === 'worktree:get-changed-files'
        ? { success: true, files: [{ path: 'src/a.ts', status: 'modified', staged: false }] }
        : { success: false });
    await act(async () => {
      root.render(<WorktreeDiffPanel child={child} isWinner={false} onPick={() => {}} onClose={() => {}} />);
    });
    await flush();
    expect(invoke).toHaveBeenCalledWith('worktree:get-changed-files', '/wt/review-2');
    expect(container.querySelector('[data-diff-file="src/a.ts"]')).not.toBeNull();
  });

  it('fetches a file diff only when its row is expanded, and caches it', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'worktree:get-changed-files')
        return { success: true, files: [{ path: 'src/a.ts', status: 'modified', staged: false }] };
      return { success: true, diff: { filePath: 'src/a.ts', diff: '@@ -1 +1 @@\n-old\n+new', status: 'modified' } };
    });
    await act(async () => {
      root.render(<WorktreeDiffPanel child={child} isWinner={false} onPick={() => {}} onClose={() => {}} />);
    });
    await flush();
    expect(invoke).not.toHaveBeenCalledWith('worktree:get-file-diff', '/wt/review-2', 'src/a.ts');

    const toggle = container.querySelector<HTMLButtonElement>('[data-diff-toggle="src/a.ts"]')!;
    await act(async () => { toggle.click(); });
    await flush();
    expect(invoke).toHaveBeenCalledWith('worktree:get-file-diff', '/wt/review-2', 'src/a.ts');
    expect(container.textContent).toContain('+new');

    const before = invoke.mock.calls.length;
    await act(async () => { toggle.click(); });   // collapse
    await act(async () => { toggle.click(); });   // re-expand: cached, no refetch
    await flush();
    expect(invoke.mock.calls.length).toBe(before);
  });

  it('pick winner calls onPick and never invokes a merge channel', async () => {
    invoke.mockResolvedValue({ success: true, files: [] });
    const onPick = vi.fn();
    await act(async () => {
      root.render(<WorktreeDiffPanel child={child} isWinner={false} onPick={onPick} onClose={() => {}} />);
    });
    await flush();
    const pick = container.querySelector<HTMLButtonElement>('[data-diff-pick]')!;
    await act(async () => { pick.click(); });
    expect(onPick).toHaveBeenCalledTimes(1);
    const channels = invoke.mock.calls.map((c) => String(c[0]));
    expect(channels.every((ch) => !/merge|reset|checkout|commit/.test(ch))).toBe(true);
  });
});
