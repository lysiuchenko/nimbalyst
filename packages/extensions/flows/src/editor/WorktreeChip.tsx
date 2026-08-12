import { useState } from 'react';
import type { WorktreeRef } from '../runner/types';
import type { HostIpc } from '../host/nimbalystSessionHost';

/**
 * What a reviewer wants to know about a checkout, when they ask.
 *
 * Fetched on click, not on render: a run detail with eight branches must not
 * fire eight git status calls the moment it opens.
 */
interface ChipStatus {
  modifiedFileCount: number;
  commitsAhead: number;
  isMerged: boolean;
}

type ChipState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'loaded'; status: ChipStatus }
  | { phase: 'unavailable' };

/**
 * A branch on the run record, made findable.
 *
 * Fan-out builds one isolated branch per sub-agent and, until this existed,
 * lost them the moment the run finished. The chip names the branch; a click
 * asks the host's own worktree IPC what state it is in. A checkout deleted
 * since the run degrades to "status unavailable" — the record outlives the
 * checkout, and the chip must not pretend otherwise.
 */
export function WorktreeChip({ worktree }: { worktree: WorktreeRef }) {
  const [state, setState] = useState<ChipState>({ phase: 'idle' });

  const inspect = async () => {
    if (state.phase === 'loading' || state.phase === 'loaded') return;
    setState({ phase: 'loading' });

    const ipc = (window as unknown as { electronAPI?: HostIpc }).electronAPI;
    try {
      const result = (await ipc?.invoke('worktree:get-status', worktree.path)) as
        | { status?: ChipStatus; error?: string }
        | undefined;
      if (result?.status) {
        setState({ phase: 'loaded', status: result.status });
      } else {
        setState({ phase: 'unavailable' });
      }
    } catch {
      setState({ phase: 'unavailable' });
    }
  };

  return (
    <button
      type="button"
      className="flow-worktree-chip"
      data-worktree-branch={worktree.branch}
      data-phase={state.phase}
      title={`${worktree.path} — click for git status`}
      onClick={(event) => {
        event.stopPropagation();
        void inspect();
      }}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        fork_right
      </span>
      <span className="flow-worktree-branch">{worktree.branch}</span>
      {state.phase === 'loading' && <span className="flow-worktree-status">…</span>}
      {state.phase === 'unavailable' && (
        <span className="flow-worktree-status">status unavailable</span>
      )}
      {state.phase === 'loaded' && (
        <span className="flow-worktree-status">{describe(state.status)}</span>
      )}
    </button>
  );
}

function describe(status: ChipStatus): string {
  if (status.isMerged) return 'merged';
  const parts: string[] = [];
  if (status.commitsAhead > 0) {
    parts.push(`${status.commitsAhead} ${status.commitsAhead === 1 ? 'commit' : 'commits'} ahead`);
  }
  if (status.modifiedFileCount > 0) {
    parts.push(`${status.modifiedFileCount} uncommitted`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'clean';
}
