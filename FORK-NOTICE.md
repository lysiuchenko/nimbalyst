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
- `docs/superpowers/specs/**` — design specs for flows features
- `packages/runtime/src/themes/builtin/globallogic/theme.json` and
  `packages/runtime/src/themes/builtin/globallogic-dark/theme.json` — the brand
  app themes, in the format the host's own theme loader already discovers
- `packages/electron/src/main/menu/themeMenuItems.ts` (+ its test) — the brand
  entries for the Theme submenu, kept out of `ApplicationMenu.ts` so the edit
  to that upstream file stays at one import and one spread

## Core deviations

Core files are read-only **by default**. When the repo owner explicitly asks for
a core change, it is made and recorded here, so every
`git rebase upstream/main` has a checklist of what to re-apply or re-resolve.

| File | Change | Why |
| --- | --- | --- |
| `packages/electron/src/main/utils/store.ts` | `shouldShowCommunityPopup()` returns `false` unconditionally | This build never shows the community / Discord popup. Chosen as the single gate both surfaces flow through (`shouldShowDiscordInvitation` delegates to it), so the diff is one line. Requested 2026-08-08. |
| `packages/electron/src/main/utils/store.ts` | `getOnboardingState()` reports `onboardingCompleted` / `unifiedOnboardingCompleted` as always true | This build never shows the startup Standard/Developer mode chooser. That state object is the single gate the renderer reads. Requested 2026-08-08. |
| `packages/extension-sdk/src/types/extension.ts`, `packages/runtime/src/extensions/ExtensionLoader.ts`, `packages/electron/src/main/services/ai/AIService.ts` (+ `aiServiceUtils.ts`) | `ExtensionAIService.sendPrompt` gains an optional `worktreeId`; the `extensions:ai-send-prompt` handler resolves it and binds the session it creates to that worktree | Without it an extension's every prompt shares one working tree, so concurrent flow nodes are unsafe and `node.worktree` could not be honored — the extension refused such nodes instead. The alternative was embedding the Agent SDK to get a `cwd`, which would duplicate the credential-stripping written after a real billing incident (`sdkOptionsBuilder.ts:355-370`). The resolution is shared with `sessions:create` via `resolveWorktreePathsForSession`, so both reject an unknown id or a hand-deleted directory identically. Requested 2026-08-09. |
| `packages/extension-sdk/src/types/extension.ts`, `packages/runtime/src/extensions/ExtensionLoader.ts`, `packages/electron/src/main/services/ai/AIService.ts` | `sendPrompt` gains an optional `mode` (`planning`/`agent`/`auto`), forwarded to `createSession` | The handler hardcoded `undefined` for a session's mode, so every extension-created session was left without one. Flow steps need to say they are agent sessions. Note `auto` is an *effective* mode the host derives from workspace trust and the session table's CHECK constraint rejects it — callers must pass `agent`. Requested 2026-08-09. |
| `packages/electron/src/main/menu/ApplicationMenu.ts` | The View > Theme submenu gains a separator and the two brand entries, appended via `buildBrandThemeMenuItems()` | The submenu hardcodes one ~30-line block per theme and only covers light / dark / crystal-dark / system, so file-based themes are discoverable via `theme:list` but selectable nowhere in the UI. The four existing blocks are untouched; the new entries live in a separate `menu/themeMenuItems.ts` module so the rebase surface is one import plus one spread. Requested 2026-08-08. |
| `packages/runtime/src/ai/server/providers/__tests__/OpenAICodexProvider.test.ts` | `uses SDK-provided model discovery when available` gets a 60s per-test timeout instead of the suite-wide 20s | The test is load-sensitive: it passes in isolation but times out when the full ~9.4k-test run saturates the machine, and it blocked three pushes on 2026-08-08 via the pre-push gate. Given a longer budget rather than skipped, so it still catches a real regression. Requested 2026-08-08. |

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
