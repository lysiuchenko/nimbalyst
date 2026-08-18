import type { HostIpc } from './nimbalystSessionHost';

/** One entry from `worktree:get-changed-files`. */
export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  staged: boolean;
}

/** The `diff` payload from `worktree:get-file-diff` (host `FileDiffResult`, trimmed to what the panel renders). */
export interface WorktreeFileDiff {
  filePath: string;
  diff: string;
  status: 'added' | 'modified' | 'deleted';
}

/**
 * Files a sub-agent changed in its checkout. Read-only.
 *
 * A checkout deleted since the run, a host error, or a false `success` all
 * degrade to `[]` — a diff fetch must never break the run view.
 */
export async function getChangedFiles(ipc: HostIpc, worktreePath: string): Promise<ChangedFile[]> {
  try {
    const res = (await ipc.invoke('worktree:get-changed-files', worktreePath)) as
      | { success?: boolean; files?: ChangedFile[] }
      | undefined;
    return res?.success && Array.isArray(res.files) ? res.files : [];
  } catch {
    return [];
  }
}

/** One file's unified diff from the sub-agent's checkout, or `null` if unavailable. Read-only. */
export async function getFileDiff(
  ipc: HostIpc,
  worktreePath: string,
  filePath: string,
): Promise<WorktreeFileDiff | null> {
  try {
    const res = (await ipc.invoke('worktree:get-file-diff', worktreePath, filePath)) as
      | { success?: boolean; diff?: WorktreeFileDiff }
      | undefined;
    return res?.success && res.diff ? res.diff : null;
  } catch {
    return null;
  }
}
