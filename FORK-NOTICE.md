# Fork Notice

## Origin

This repository is a fork of **[nimbalyst/nimbalyst](https://github.com/nimbalyst/nimbalyst)**.

| | |
|---|---|
| Upstream | `https://github.com/nimbalyst/nimbalyst.git` (git remote `upstream`) |
| Fork | `https://github.com/lysiuchenko/nimbalyst.git` (git remote `origin`) |
| Fork point | commit `2e6237c8e8114eda32129f75df1b2a6b8aaf754c` (`v0.72.8`, 2026-08-07), tagged `upstream-base` |

The fork exists to add exactly one feature: **`flows`** — a visual pipeline builder
for the Claude Code CLI, built on `@xyflow/react` and delivered as an `EditorHost`
extension. The authoritative spec is `nimbalyst-flows-build-plan.md`.

## License

Upstream Nimbalyst is licensed under the **MIT License**. `LICENSE` at this repo
root is the unmodified upstream MIT license, Copyright (c) 2024-2026 Nimbalyst Inc.
It stays intact — do not edit or relicense it.

All new code added by this fork is likewise MIT, and carries the upstream copyright
notice as required by the MIT terms.

### License audit (2026-08-08)

Every workspace package that declares a license declares `MIT`:

| Package | `license` |
|---|---|
| `packages/cli` | MIT |
| `packages/collab-adapters` | MIT |
| `packages/collab-bundle` | MIT |
| `packages/collab-client` | MIT |
| `packages/collab-protocol` | MIT |
| `packages/electron` | MIT |
| `packages/extension-sdk` | MIT |
| `packages/runtime` | MIT |

`packages/android`, `packages/browser-extension`, `packages/ios`,
`packages/marketplace` and `packages/opencode-plugin` declare no `license` field
and are `private: true`; they inherit the repo-root MIT license. No package in
this repository ships an AGPL license file, and no source file declares AGPL
terms. The only in-tree occurrence of the string `AGPL` is the copyleft-detection
regex at `packages/electron/build/generate-third-party-licenses.js:30`, which
flags AGPL-licensed *third-party dependencies* during packaging — new flows
dependencies must keep that scanner clean.

## AGPL component — do not touch

The **Nimbalyst collaboration sync server** (the Cloudflare Worker behind
`wss://sync.nimbalyst.com`) is a **separate project that is not vendored in this
repository** — see `LICENSING.md` and `README.md`. It is treated as AGPL and is
off-limits to this fork. Upstream `CLAUDE.md` still lists `packages/collabv3/`
("Collaboration server (Cloudflare Workers)") in its monorepo map, but that
directory does not exist in this tree; if a future rebase ever brings it in, it
is off-limits on sight.

Because the server itself is out of tree, the practical rule for the flows
extension is about its *clients*. The flows extension **must not import, modify,
depend on, or transitively pull in** any of:

- `@nimbalyst/collab-protocol` (`packages/collab-protocol`) — sync wire format
- `@nimbalyst/collab-client` (`packages/collab-client`)
- `@nimbalyst/collab-bundle` (`packages/collab-bundle`)
- `@nimbalyst/collab-adapters` (`packages/collab-adapters`)
- `packages/runtime/src/sync/**` — sync engine and sync clients
- any `packages/electron/src/main/ipc/DocumentSyncHandlers.ts`,
  `ShareHandlers.ts`, `utils/collabSyncUrl.ts` surface
- anything else reaching `sync.nimbalyst.com`

Flow state is local-only: `.flow.json` files and `.flow-runs/<run-id>.json`. It
never travels over the collaboration sync channel.

## Do-not-modify list (core files)

New code lives **only** in the flows extension package:

```
packages/extensions/flows/**
```

Everything else in this repository is upstream core and must not be edited:

- `packages/electron/**` — desktop host (main + renderer)
- `packages/runtime/**` — shared runtime and editor
- `packages/extension-sdk/**` — extension SDK / `EditorHost` contract
- `packages/cli/**`, `packages/shared/**`
- `packages/collab-*/**` — see AGPL section above
- `packages/ios/**`, `packages/android/**`, `packages/browser-extension/**`,
  `packages/marketplace/**`, `packages/opencode-plugin/**`
- all other `packages/extensions/*` (upstream built-in extensions)
- root config: `package.json`, `package-lock.json`, `tsconfig*.json`,
  `vitest.config.ts`, `playwright.config.ts`, `tailwind.config.ts`,
  `postcss.config.js`, `.npmrc`, `.nvmrc`
- `LICENSE`, `LICENSING.md`, `SECURITY.md`, `CHANGELOG.md`, `README.md`,
  upstream `CLAUDE.md` and `AGENTS.md`
- `.github/**`, `.githooks/**`, `scripts/**`, `patches/**`

If a required core API is missing, the fix is an **adapter module inside
`packages/extensions/flows`** — never a core patch. If an adapter is impossible,
stop and report rather than working around it.

### Fork-owned files outside the extension package

These are additions by this fork, not edits to upstream files:

- `FORK-NOTICE.md` (this file)
- `docs/editorhost-notes.md` (extension contract notes, Goal 1.2)
- `docs/flows.md`, `docs/flows-security.md` (Goal 5)

## Core deviations

Core files are read-only **by default**. When the repo owner explicitly asks for
a core change, it is made and recorded here, so every
`git rebase upstream/main` has a checklist of what to re-apply or re-resolve.

| File | Change | Why |
| --- | --- | --- |
| `packages/electron/src/main/utils/store.ts` | `shouldShowCommunityPopup()` returns `false` unconditionally | This build never shows the community / Discord popup. Chosen as the single gate both surfaces flow through (`shouldShowDiscordInvitation` delegates to it), so the diff is one line. Requested 2026-08-08. |

### The one sanctioned edit to a core file

`package-lock.json` gains a workspace registration for
`packages/extensions/flows` (two additive entries — a `link: true` node and the
package's own devDependency block). This is the mechanical result of `npm install`
picking up the new `packages/extensions/*` workspace and cannot be avoided while
the extension lives in the monorepo. No dependency versions change and no
`peer: true` flags are stripped; verify both on every rebase.

## Rebasing on upstream

```bash
git fetch upstream
git rebase upstream/main
```

Conflicts should be limited to the files listed directly above, because all
feature code is isolated in `packages/extensions/flows`. Re-run the full test
suite after every rebase before resuming feature work.
