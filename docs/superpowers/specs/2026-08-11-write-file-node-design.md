# The `write-file` node — a flow that ends with something in your hand

**Date:** 2026-08-11
**Status:** design
**Scope:** `packages/extensions/flows` only. No core change.

## The problem

A flow runs, and its output goes nowhere. The six node types — `agent`,
`fan-out`, `slash-command`, `skill`, `shell`, `human-gate` — all *produce* text,
and none of them **puts it anywhere**. The result lives in
`.flow-runs/run-<id>.json`, a file the audit already describes as "build output"
and which the run directory now gitignores.

So the honest summary of a flow today is: it does real work and then throws the
work away. "Draft the release notes" ends in a green tick and a JSON blob.

This is the sharpest remaining answer to *"hard to use"*: there is no way to make
a flow produce `RELEASE_NOTES.md`.

## What it becomes

```jsonc
{
  "id": "save",
  "type": "write-file",
  "path": "RELEASE_NOTES.md",
  "content": "{{draft.notes}}"
}
```

The flow ends and the file is in the repository, in the editor, in `git status`.

## Design

### The node

```ts
export interface WriteFileNode extends FlowNodeCommon {
  type: 'write-file';
  /** Workspace-relative. Absolute paths and escapes are rejected. */
  path: string;
  /** Usually a `{{reference}}`; an empty string writes an empty file. */
  content: string;
}
```

Both fields go through the same `{{…}}` resolution every other node's text
fields use, so the path can be computed too (`notes/{{date.today}}.md`).

Overwrite only. Appending needs a *read* channel, and `RunFileWriter` is
write-only; adding one is a separate piece of work rather than a flag smuggled
in here.

### Where the write happens

Through `RunFileWriter` — the interface the run record already uses, backed by
`services.filesystem.writeFile`. No new host surface, no backend module, and no
new permission: a flow that can record a run can already write a file.

### Path safety is the whole risk

This is the first node type that writes to arbitrary paths, so the guard is the
feature. A pure `safeWorkspacePath()` (no I/O, exhaustively testable) rejects:

| Rejected | Why |
| --- | --- |
| `/etc/passwd`, `C:\Windows\…` | absolute — leaves the workspace outright |
| `../../secrets` | escapes upward |
| `a/../../b` | escapes after normalisation, not just at the front |
| `.git/config` | corrupting the repository is not an "artifact" |
| `` (empty) | nothing to write to |

Mirrors the rule shell nodes already live under — "cannot escape the workspace"
(`docs/flows-security.md` §3) — but enforced in the renderer, because unlike a
shell command this never reaches the backend module.

`.flow-runs/` is deliberately *not* blocked: writing a fixture there is
reasonable, and the run record's own name is unguessable.

### Failure is loud

A refused path fails the node rather than skipping it, for the same reason
`assertCapableFor` fails a node that cannot get its worktree: a flow that
reports success while having written nothing is worse than one that stops.

## Files

| File | Change |
| --- | --- |
| `src/runner/safeWorkspacePath.ts` | new — pure guard |
| `src/runner/executors.ts` | new `createWriteFileExecutor` |
| `src/runner/flowRun.ts` | wire it, reusing `dependencies.writer` |
| `src/schema/types.ts`, `validate.ts` | the node type and its validation |
| `src/editor/nodes/nodeTypes.tsx` | canvas chrome: icon, fields, one-line summary |
| `src/editor/templates.ts` | the release-notes template ends by saving the file |
| `src/styles.css` | one colour for the new type (appended at EOF — the file is being edited concurrently) |

## Tests

Pure and exhaustive on `safeWorkspacePath`: each rejection above, plus the
paths that must keep working (`a/b.md`, `./a.md`, `.flow-runs/x.json`).
Executor: writes resolved content, resolves references in the path, fails on a
refused path, reports the path as its output. Schema: `path` and `content`
required. E2E: run a flow whose last node writes a file, then assert the file
exists on disk with the expected contents — the run record is not evidence.

## Out of scope

Append mode, templating beyond existing `{{…}}` resolution, binary content,
creating directories outside the workspace, and opening the written file in a
tab automatically.
