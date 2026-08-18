# Live fan-out worktree diffs + pick-winner gate

**Date:** 2026-08-18
**Status:** design
**Scope:** `packages/extensions/flows` only. No core files — the diff comes from host IPC channels the extension is already allowed to call.

## Problem — parallel work is invisible

A `fan-out` node spawns N sub-agents through `createFanOutExecutor` (`src/runner/executors.ts:122`), a worker pool sized by `node.concurrency ?? 4`. When the node asks for isolation (`worktree: true`), each concurrent child gets its own checkout — `NimbalystAgentClient.run` calls `worktrees.createWorktree(nodeId)` per sub-agent — and the result is reported as `ChildProgress`:

```ts
interface ChildProgress {
  label: string; status: 'queued'|'running'|'done'|'failed';
  sessionId?: string; error?: string;
  worktree?: WorktreeRef;   // { id; branch; path }
  output?: string;          // capped 400-char preview
}
```

`SubAgentLayer.tsx` renders these children live on the fan-out card — label, status, output preview. But **nothing shows what each child actually changed**. Five agents edit five worktrees in parallel and the operator sees five status dots. The wow — "five agents worked at once; here's each one's diff, pick the winner" — has no surface.

## Approach — fetch each child's worktree diff on completion; pick-winner, don't auto-merge

Two host IPC channels already expose worktree diffs and are reachable from the extension today via the generic `HostIpc.invoke(channel, ...args)` bridge (`src/host/nimbalystSessionHost.ts:8`). Precedent: `WorktreeChip.tsx:41` already calls `ipc.invoke('worktree:get-status', path)`. No `preload` change, no core change.

- `worktree:get-changed-files` → `{ success; files: Array<{ path; status:'added'|'modified'|'deleted'; staged }> }`
- `worktree:get-file-diff` → `{ success; diff?: FileDiffResult }` where `FileDiffResult = { filePath; diff; oldContent; newContent; status }`; base branch is resolved server-side.

### 1. Typed diff wrappers (`src/host/worktreeDiff.ts`, new)

Thin, tested wrappers over the untyped bridge so the UI never touches raw channel strings:

```ts
interface ChangedFile { path: string; status: 'added'|'modified'|'deleted'; staged: boolean }
interface WorktreeFileDiff { filePath: string; diff: string; status: 'added'|'modified'|'deleted' }

function getChangedFiles(ipc: HostIpc, worktreePath: string): Promise<ChangedFile[]>;      // [] on {success:false}
function getFileDiff(ipc: HostIpc, worktreePath: string, filePath: string): Promise<WorktreeFileDiff | null>;
```

Both are read-only. `{success:false}` and thrown IPC errors resolve to `[]` / `null` — a diff fetch never breaks the run view.

### 2. Live diff panel in `SubAgentLayer.tsx`

Per child with a `worktree`:

- **Diff timing: on child completion** (status `done`/`failed`), not streaming — matches the decided design and avoids hammering IPC mid-run.
- Show a **changed-file count badge** on the child row once complete (`getChangedFiles(path)`).
- Expanding the child lists its `ChangedFile`s; expanding a file fetches `getFileDiff(path, file)` and renders the unified `diff` string (reuse whatever diff renderer the history table / core diff view uses; a `<pre>` with add/del line classes is acceptable for v1).
- Fetches are lazy (on expand) and cached per `(worktreePath, filePath)` so re-expanding is free. Fetching one child's diff must not re-render sibling children — keep each child row's fetch state local.

### 3. Pick-winner gate (manual, non-destructive)

When a `worktree:true` fan-out node completes, surface a **pick-winner** affordance in `SubAgentLayer`: each child shown with its changed-file summary and expandable diff; the operator picks one child as the node's chosen result.

- "Pick" is **non-destructive**: it records the winning child (its `worktree.branch` / `output`) as the fan-out node's surfaced result and offers "open this worktree" (host already owns worktree opening). It does **not** run `git merge`.
- Rationale (safety): merging a worktree into the base branch is effectively irreversible and is a host git operation. Auto-merging N-way from a flow is exactly the kind of irreversible outward action that should not fire without an explicit, separate decision. v1 hands the chosen branch back to the operator, who merges through the existing worktree UI. Auto-merge, if ever wanted, is a future spec that would need a host merge channel (a core-adjacent ask, logged then).
- Reuse the gate-decision shape (`decide(decision, comment?)`, the `PendingGate` pattern) so the pick flows through the same run-control surface rather than a bespoke modal.

## Verification

1. **Diff wrappers** (`worktreeDiff.test.ts`, `// @vitest-environment node`). Mock `HostIpc.invoke`; assert `getChangedFiles` calls `'worktree:get-changed-files'` with the path and maps `files`; `getFileDiff` calls `'worktree:get-file-diff'` with `(path, filePath)` and maps `FileDiffResult`. `{success:false}` → `[]`/`null`; a thrown invoke → `[]`/`null` (no propagation).
2. **SubAgentLayer mount** (`createRoot` + `act`). A completed child with a `worktree`: renders the changed-file count; expanding a file triggers exactly one `getFileDiff` and renders the diff text; re-expanding does not re-fetch (cache). A child *without* a worktree shows no diff affordance.
3. **Render isolation** (mount). Two completed children; fetching child A's diff does not re-render child B's row.
4. **Pick-winner** (mount). Clicking pick on child B calls `decide` with B's worktree/branch; no merge IPC is invoked (assert `invoke` never called with a merge/`git` channel).

## Out of scope

Streaming diffs while a child is still running (v1 = on completion). Auto git-merge of the winning worktree (host operation; explicit future ask). Diffs for non-worktree children (nothing to diff). Changing fan-out concurrency or scheduling.

## Fork notes

No core files touched; no `FORK-NOTICE.md` row. Uses existing host IPC channels (`worktree:get-changed-files`, `worktree:get-file-diff`) the same way `WorktreeChip` uses `worktree:get-status`. If a future auto-merge is requested, that host git-merge op is the point at which a core deviation (and a `FORK-NOTICE.md` row) would be raised for explicit approval.
