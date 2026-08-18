import { useEffect, useState } from 'react';
import type { ChildProgress } from '../runner/types';
import type { HostIpc } from '../host/nimbalystSessionHost';
import { getChangedFiles, getFileDiff, type ChangedFile } from '../host/worktreeDiff';

interface WorktreeDiffPanelProps {
  child: ChildProgress;
  isWinner: boolean;
  onPick: () => void;
  onClose: () => void;
}

function hostIpc(): HostIpc | undefined {
  return (window as unknown as { electronAPI?: HostIpc }).electronAPI;
}

/**
 * One sub-agent's checkout, made reviewable: the files it changed, each file's
 * diff on demand, and a non-destructive "pick winner". Read-only — it never
 * merges. Fetches on open and on expand, never on the canvas per status tick.
 *
 * Diff bodies are cached by path in `cache`, separately from `openPaths` (which
 * rows are currently expanded). Collapsing a row only removes it from
 * `openPaths` — the cached diff stays, so re-expanding never refetches.
 */
export function WorktreeDiffPanel({ child, isWinner, onPick, onClose }: WorktreeDiffPanelProps) {
  const worktree = child.worktree!;
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [cache, setCache] = useState<Record<string, string | 'empty'>>({});
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    const ipc = hostIpc();
    if (!ipc) { setFiles([]); return; }
    void getChangedFiles(ipc, worktree.path).then((f) => { if (live) setFiles(f); });
    return () => { live = false; };
  }, [worktree.path]);

  const toggle = async (path: string) => {
    if (openPaths.has(path)) {
      setOpenPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      return;
    }

    setOpenPaths((prev) => new Set(prev).add(path));
    if (cache[path] !== undefined) return; // cached — no refetch

    setLoadingPaths((prev) => new Set(prev).add(path));
    const ipc = hostIpc();
    const diff = ipc ? await getFileDiff(ipc, worktree.path, path) : null;
    setCache((prev) => ({ ...prev, [path]: diff?.diff ?? 'empty' }));
    setLoadingPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  };

  return (
    <div className="flow-worktree-diff" data-diff-branch={worktree.branch} data-winner={isWinner ? 'yes' : 'no'}>
      <div className="flow-worktree-diff-head">
        <span className="material-symbols-outlined" aria-hidden="true">fork_right</span>
        <strong>{child.label}</strong>
        <span className="flow-worktree-diff-path">{worktree.branch}</span>
        <button type="button" className="flow-worktree-diff-pick" data-diff-pick onClick={onPick}>
          {isWinner ? 'Winner' : 'Pick winner'}
        </button>
        <button type="button" className="flow-worktree-diff-close" data-diff-close aria-label="Close" onClick={onClose}>
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
      {files === null && <p className="flow-worktree-diff-loading">Loading changes…</p>}
      {files !== null && files.length === 0 && <p className="flow-worktree-diff-empty">No changes in this checkout.</p>}
      {files?.map((file) => {
        const isOpen = openPaths.has(file.path);
        const isLoading = loadingPaths.has(file.path);
        const cached = cache[file.path];
        return (
          <div key={file.path} className="flow-worktree-diff-file" data-diff-file={file.path}>
            <button
              type="button"
              className="flow-worktree-diff-toggle"
              data-diff-toggle={file.path}
              data-status={file.status}
              aria-expanded={isOpen}
              onClick={() => void toggle(file.path)}
            >
              <span className="flow-worktree-diff-file-status">{file.status[0].toUpperCase()}</span>
              {file.path}
            </button>
            {isOpen && isLoading && <p className="flow-worktree-diff-loading">Loading diff…</p>}
            {isOpen && !isLoading && cached === 'empty' && <p className="flow-worktree-diff-empty">Diff unavailable.</p>}
            {isOpen && !isLoading && typeof cached === 'string' && cached !== 'empty' && (
              <pre className="flow-worktree-diff-body">
                {cached.split('\n').map((line, i) => (
                  <span key={i} className={diffLineClass(line)}>{line + '\n'}</span>
                ))}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'flow-diff-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'flow-diff-del';
  if (line.startsWith('@@')) return 'flow-diff-hunk';
  return 'flow-diff-ctx';
}
