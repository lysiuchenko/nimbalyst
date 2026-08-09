# EditorHost Notes (flows extension)

Fork-owned notes for Goal 1.2 of `nimbalyst-flows-build-plan.md`. Records the
exact registration path, API surface, and known gaps the `flows` extension will
build on. Reference extension studied: `packages/extensions/excalidraw`
(canvas editor, custom file type, source mode, AI tools) — the closest analogue
to a flow canvas.

Upstream reading: [EXTENSION_ARCHITECTURE.md](./EXTENSION_ARCHITECTURE.md),
[FILE_TYPE_HANDLING.md](./FILE_TYPE_HANDLING.md).

## 1. Where the extension lives

```
packages/extensions/flows/
├── manifest.json      # contributions (custom editor, file icon, new-file menu)
├── package.json       # @nimbalyst/flows-extension, "build": "vite build"
├── vite.config.ts     # createExtensionConfig() from the SDK
├── vitest.config.ts
└── src/index.tsx      # activate() + components export
```

`packages/extensions/*` is already a workspace glob in the root `package.json`
(`workspaces`), so a new directory there is picked up by `npm install` with no
core edit. `packages/electron/build/build-extensions.js` builds the
extension-sdk first, then runs `npm run build` for every extension directory
that has a build script, and validates that `manifest.main` / `manifest.styles`
point at real files.

## 2. Registration — the exact call chain

The flows editor is registered declaratively; there is no imperative
"registerEditor" API to call.

1. **Manifest declares the contribution.**
   `packages/extensions/flows/manifest.json`:

   ```jsonc
   {
     "id": "com.nimbalyst.flows",
     "name": "Flows",
     "version": "0.1.0",
     "main": "dist/index.js",
     "styles": "dist/index.css",
     "apiVersion": "1.0.0",
     "permissions": { "filesystem": true, "ai": true },
     "contributions": {
       "customEditors": [
         {
           "filePatterns": ["*.flow.json"],
           "displayName": "Flow Editor",
           "component": "FlowEditor",
           "supportsSourceMode": true,
           "supportsDiffMode": false
         }
       ],
       "fileIcons": { "*.flow.json": "account_tree" },
       "newFileMenu": [
         {
           "extension": ".flow.json",
           "displayName": "Flow",
           "icon": "account_tree",
           "defaultContent": "{\"version\":1,\"name\":\"untitled\",\"nodes\":[],\"edges\":[],\"variables\":{}}"
         }
       ]
     }
   }
   ```

2. **Entry module exports the component under the manifest's `component` name.**
   `packages/runtime/src/extensions/ExtensionLoader.ts:1755` does
   `components[contribution.component]` and logs
   `"declares custom editor component '<name>' but does not export it"` when the
   name does not match. So `src/index.tsx` must export:

   ```tsx
   export async function activate(context: ExtensionContext) { /* … */ }
   export async function deactivate() { /* … */ }
   export const components = { FlowEditor };
   export const aiTools = flowsAITools;   // optional
   ```

3. **The bridge converts patterns to suffix keys.**
   `packages/electron/src/renderer/extensions/ExtensionEditorBridge.ts:33-62`
   maps each `filePatterns` entry `"*.flow.json"` → `".flow.json"` (it strips a
   leading `*`), then calls:

   ```ts
   customEditorRegistry.register({
     extensions: ['.flow.json'],
     component,
     name: contribution.displayName,
     supportsAI: manifest.permissions?.ai || false,
     supportsSourceMode: contribution.supportsSourceMode || false,
     extensionId,
     componentName: contribution.component,
     collaboration: contribution.collaboration,
   });
   ```

   **This is the registration call the flows extension relies on** —
   `customEditorRegistry.register(...)` in
   `packages/electron/src/renderer/components/CustomEditors/registry.ts:42`.

4. **Lookup is longest-suffix.**
   `registry.ts:109` `findMatchForFile(filePath)` lowercases the basename and
   picks the **longest registered key that is a suffix** of it. Compound
   extensions of any depth are explicitly supported (the doc comment cites
   `.reddit.watch.json`).

### `*.flow.json` vs Monaco's `.json` — resolved

`.flow.json` (10 chars) is longer than `.json` (5), so `findMatchForFile`
returns the flows registration for `review-pipeline.flow.json` and Monaco keeps
every other `.json`. No core change and no pattern-priority field is needed.
Registry keys are unique per suffix: registering `.flow.json` twice logs
`"is already registered by … Overwriting."` — a real hazard only if a second
extension claims the same suffix.

## 3. EditorHost API surface the flows editor will use

`EditorHost` is defined in `packages/extension-sdk/src/types/editor.ts:324`; the
component receives it as `EditorHostProps { host: EditorHost }`.

| Member | Used by flows for |
| --- | --- |
| `filePath`, `fileName` | run-state path (`.flow-runs/`), tab label |
| `theme`, `onThemeChanged(cb)` | canvas + node colors follow app theme |
| `isActive`, `visible?`, `onVisibilityChanged?(cb)` | pause xyflow rAF work when hidden |
| `readOnly?`, `onReadOnlyChanged?(cb)` | share-viewer / embed rendering |
| `loadContent(): Promise<string>` | read `.flow.json` on mount |
| `saveContent(content)` | write canvas state back (validated first) |
| `onSaveRequested(cb)` | autosave + Cmd+S |
| `setDirty(isDirty)` | tab dirty indicator |
| `onFileChanged(cb)` | external/AI edits to the flow file |
| `supportsSourceMode`, `toggleSourceMode?()`, `onSourceModeChanged?(cb)` | raw JSON view via host Monaco |
| `setEditorContextItems(items \| null)` | push selected nodes to chat as chips |
| `registerEditorAPI(api \| null)` | expose an imperative flow API to AI tools |
| `registerMenuItems(items)` | "Run flow", "Compile to slash command" (Goal 5.1) |
| `storage` | per-extension prefs (last viewport, panel widths) |
| `fs?: EditorHostFileSystem` | `read()` / `write()` with SHA-256 CAS for `.flow-runs/*.json` |
| `getConfig?<T>(key, default)` | extension configuration contributions |
| `openHistory()` | document history for the flow file |
| `openExternal?(url)` | docs links (never navigate the renderer directly) |

**Not used:** `host.collaboration` and anything under it. See §6.

### Lifecycle: use `useEditorLifecycle`

`useEditorLifecycle(host, { applyContent, getCurrentContent, parse, serialize })`
(exported from `@nimbalyst/runtime`, typed in
`packages/extension-sdk/src/useEditorLifecycle.ts`) handles load, save, echo
detection on our own writes, external file changes, theme, source mode, and diff
state. Per upstream guidance, content state must **not** live in React state —
`applyContent` pushes into the canvas store, `getCurrentContent` pulls out of it.
That matches the "store-managed" pattern (Mindmap / DatamodelLM) rather than the
library-ref pattern.

## 4. Services reachable from an extension

`ExtensionContext.services` (`packages/extension-sdk/src/types/extension.ts:996`)
is the whole sanctioned surface:

| Service | Available when | Flows use |
| --- | --- | --- |
| `services.filesystem` | `permissions.filesystem` | read/write `.flow.json`, `.flow-runs/`, `.claude/commands/` |
| `services.ui` | always | toasts, dialogs, notifications (gate + failure alerts, Goal 4.2) |
| `services.ai` | `permissions.ai` | see below |
| `services.configuration` | `contributions.configuration` declared | flows settings |
| `services.collab` | always | **not used** (§6) |

`services.ai` (`extension.ts:1172`) is the only session-creating API in the SDK:

```ts
sendPrompt(options: {
  prompt: string;
  sessionName?: string;
  provider?: 'claude-code' | 'claude' | 'openai' | 'openai-codex';
  model?: string;
}): Promise<{ sessionId: string; response: string }>;
```

It creates a real session in session history and returns its id — this is the
primary candidate for Goal 3.3 "each executed node spawns a Nimbalyst session".
`chatCompletion` / `chatCompletionStream` are stateless (no session row) and
`listModels()` returns chat providers only. `callBackendTool(name, args, workspacePath)`
routes to an extension backend module.

## 5. Gap: no session / git / worktree / task service in the SDK

**There is no `services.sessions`, `services.git`, `services.worktrees`, or
`services.tasks`.** `sendPrompt` is session-*creating* but not session-*managing*:
it exposes no way to attach a worktree, read run status, or link a node to an
existing session.

Everything else the host can do is IPC, and extensions run in the renderer, so
they reach it through `window.electronAPI.invoke(channel, …)`. Upstream
extensions already do exactly this — e.g. `packages/extensions/git/src/components/ChangesTab.tsx:17`
and `CommitContextMenu.tsx:30` both grab `window.electronAPI` directly.

Channels that matter for Goals 3–4 (from `packages/electron/src/main`):

| Area | Channels |
| --- | --- |
| Worktrees | `worktree:create`, `worktree:get`, `worktree:get-by-path`, `worktree:list`, `worktree:get-status`, `worktree:get-changed-files`, `worktree:get-file-diff`, `worktree:commit`, `worktree:merge`, `worktree:rebase`, `worktree:archive`, `worktree:delete` |
| Session state | `ai-session-state:start`, `:end`, `:get-state`, `:get-running`, `:get-tracked`, `:is-active`, `:interrupt`, `:update-activity`, `:subscribe`, `:unsubscribe` |
| Session ↔ file links | `session-files:add-link`, `:get-by-session`, `:get-sessions-by-file`, `:match-tool-calls` |
| Git status | `git:is-repo`, `git:is-worktree`, `git:branches`, `git:get-file-status`, `git:get-all-file-statuses`, `git:get-uncommitted-files`, `git:get-worktree-modified-files` |

**Decision for this fork:** per hard rule 1, the flows extension never sprays
`window.electronAPI` calls through UI or executor code. All of it goes behind a
single adapter module inside the extension —
`packages/extensions/flows/src/host/nimbalystHostAdapter.ts` — with a typed
interface, so (a) core stays untouched, (b) the executor is testable against a
fake, and (c) if upstream later adds a real service, only the adapter changes.
`FlowRunner` (Goal 3.1) consumes that adapter; it never imports the Claude Agent
SDK or `electronAPI` directly.

If a needed capability turns out to have no IPC channel at all, that is a
stop-and-report per standing constraint 4 — not a core patch.

## 5b. What `sendPrompt` cannot do (found while building Goal 3.2)

`services.ai.sendPrompt` is the only session-creating API, but its options are
`{ prompt, sessionName?, provider?, model? }` and its result is
`{ sessionId, response }`. Three things Goals 3.2–3.3 ask for are therefore not
reachable through it:

| Needed | Status |
| --- | --- |
| Per-node token usage / cost | **Not available — app-wide, not a flows gap.** `sendPrompt` returns none, but `sessions:get` returns the session record and `AISession.tokenUsage` (`packages/runtime/src/ai/server/types.ts:383`) carries cumulative `inputTokens` / `outputTokens`. Since each node gets its own session, that *would* be the node's usage — but measured on 2026-08-09, `tokenUsage` comes back `null` for every session, including ones created through the app's own `ai:createSession` + `ai:sendMessage`. The adapter is wired and correct; the host simply records nothing here. Flows therefore report `—` rather than `0`. |
| Per-node tool allowlist (`node.tools`) | **Still missing.** The call takes no tool list. |
| Per-node worktree isolation (`node.worktree`) | **Solved by a one-parameter core change.** `sendPrompt` now takes an optional `worktreeId`; see below. |

### Worktree isolation — solved without a core change

`sendPrompt` is a dead end for this: it always creates its own session and takes
no worktree (`packages/electron/src/main/services/ai/AIService.ts:3955`
destructures only `{ prompt, sessionName, provider, model }`), and there is no
channel that submits a prompt to an existing session.

The way through is to stop using `sendPrompt` and assemble the same result from
the pieces the host already exposes. All four steps were **probed against a
running app**, so this is measured rather than inferred:

| Step | Channel | Result |
| --- | --- | --- |
| 1. create the worktree | `worktree:create(workspacePath, { name })` | real git worktree — id `01KZ…BQRA`, path `…_worktrees/flow-node-plan`, branch `worktree/flow-node-plan` |
| 2. create the node's session, bound to it | `sessions:create({ session: { …, worktreeId }, workspaceId })` | `{ success: true, id }` |
| 3. run the node's work in that worktree | flows backend module (below), Agent SDK with `cwd` = worktree path | mechanism proven by `flows.runShell`; the SDK call itself is not yet built |
| 4. write the transcript into the session | `session:save({ id, messages })` | session reads back with the worktree id attached |
| 5. read the cost back | `sessions:get(id)` → `session.tokenUsage` | already implemented |

`NimbalystSessionHost` (`src/host/nimbalystSessionHost.ts`) implements steps
1, 2, 4 and 5.

### Step 3 is deliberately not built — and why

Step 3 could be done by running the Claude Agent SDK inside the flows backend
module, which would also deliver per-node `tools` allowlists. **We decided not
to**, and the reason is worth keeping:

- `sdkOptionsBuilder.ts:355-370` strips `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`
  from `process.env`, the shell environment, and `~/.claude/settings.json`,
  because a user's unrelated `.env` was once picked up and billed their personal
  Anthropic account $100+. It also deliberately does **not** set the key to `''`,
  because the Claude binary treats its mere presence as an API-key auth signal
  that shadows a valid OAuth login.
- Binary resolution is its own module (`cliPathResolver.ts` →
  `resolveClaudeCodeExecutablePath({ allowSystemFallback })`).

Running our own agent means owning both. That is safety-critical, incident-driven
logic, and a copy inside this extension would not inherit the host's future fixes
— for the sole gain of passing a `cwd`. Not worth it.

**What we do instead:** `AgentClient` declares `capabilities`, and
`createAgentExecutor` fails any node whose `worktree` or `tools` the client
cannot honor. Silently running a node that asked for isolation is the genuinely
dangerous option — the author is told it succeeded and has neither the worktree
nor the tool restriction. `NimbalystAgentClient` still declares `tools: false`.

**The core change that unlocked worktrees** (requested 2026-08-09, one
parameter, no duplicated credential handling): `sendPrompt` takes an optional
`worktreeId`, and `extensions:ai-send-prompt` resolves it through the same
`resolveWorktreePathsForSession` helper `sessions:create` uses, then binds the
session it creates to that worktree. The host keeps owning credentials; the
extension gains isolation.

`NimbalystAgentClient` therefore reports `worktree: true` whenever it is given a
`NodeWorktreeCreator`, and a `worktree: true` node gets its checkout created
*before* the prompt is sent — an id that cannot be resolved fails the node
rather than letting it edit the main tree. Measured against the running app:

| Check | Result |
| --- | --- |
| unknown id | `Error: Worktree no-such-worktree not found in database`, thrown before any session is created |
| real run writing a file | landed in `…_worktrees/iso-proof-…/iso-proof.txt` (`ISOLATED`); absent from the main working tree |

## 5c. Shell nodes — solved by the flows backend module

Extension code runs in the renderer, which has no `child_process`. The
`terminal:*` channels are a PTY: they stream output but expose no per-command
exit code, so they cannot tell a passing command from a failing one.

The answer is a backend module — `contributions.backendModules` with
`runtime: 'utility-process'` and an `enablement` consent prompt, built by its own
`vite.backend.config.ts`. It lives entirely inside the flows package. Built and
verified: `src/backend/index.ts` exposes `flows.runShell`, and the *built*
`dist/backend.js` runs real commands, reports real exit codes (`exit 7` → 7),
and refuses non-allowlisted executables.

Two properties worth keeping when this is extended:

- **`spawn(..., { shell: false })`.** The command line never reaches a shell, so
  `&&`, `;`, `$(…)` and backticks are inert argument text rather than operators.
  A quote-aware tokenizer keeps `--grep "two words"` working without a shell.
- **The allowlist is re-checked in the backend.** The renderer's check is a fast
  failure; the process boundary is where it actually counts.

This is the same runtime the agent path needs (§5b step 3), so one module covers
shell nodes, per-node tool allowlists, and worktree-scoped agent runs.

## 6. Off-limits

The flows extension does **not** opt into collaboration:
`contributions.customEditors[].collaboration` is omitted, no `CollabCodec` is
registered, and `services.collab` is unused. Consequences: no Y.Doc, no
`useCollaborativeEditor`, `host.collaboration` stays `undefined`, and the editor
runs the local-only `loadContent()` / `saveContent()` path. This keeps the fork
clear of the AGPL sync server and its client packages — see `FORK-NOTICE.md`.

## 7. Build wiring

- `vite.config.ts` uses `createExtensionConfig({ entry: './src/index.tsx' })`
  from `@nimbalyst/extension-sdk/vite` (`packages/extension-sdk/src/vite.ts:131`).
  It sets production mode, ES lib output, `inlineDynamicImports: true`
  (extensions load from blob URLs, so relative imports cannot resolve), CSS
  emitted as `index.css`, and a manifest-validation plugin. `@vitejs/plugin-react`
  must be added by the extension itself with
  `react({ jsxRuntime: 'automatic', jsxImportSource: 'react' })`.
- **Discovery needs no core edit.** `getBuiltinExtensionsDirectory()`
  (`packages/electron/src/main/extensions/builtinExtensionsDirectory.ts:18`)
  resolves to `packages/extensions` in dev (`resources/extensions` when packaged)
  and the host scans that directory, so a new `packages/extensions/flows` with a
  built `dist/` is discovered on its own.
  `packages/electron/src/main/data/extensionRegistry.json` is only the generated
  marketplace catalogue and does not gate loading.
  Security consequence for Goal 5.2: `isBuiltinExtensionPath()` treats anything
  under that directory as "the same trust domain as the app itself" — backend
  modules are auto-granted and the consent prompt is skipped. Flows must enforce
  its own shell allowlist rather than leaning on a host prompt.
- Host-provided externals come from `ROLLUP_EXTERNALS`
  (`packages/extension-sdk/src/externals.ts:49`): `react`, `react-dom`,
  `react-dom/client`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `lexical`,
  `yjs`, plus patterns `/^@lexical\//`, `/^@nimbalyst\/runtime/`,
  `/^y-protocols(\/.*)?$/`, and `@nimbalyst/editor-context`.
  `@xyflow/react` is **not** host-provided — the extension bundles it (pinned).
- Tests: per-extension `vitest.config.ts` + `npm test` → `vitest run`, matching
  `packages/extensions/excalidraw`. The root `vitest` projects config picks up
  extension tests too.
- Toolchain: the repo requires node >= 24 and npm >= 11 with
  `engine-strict=true` in `.npmrc`.

## 8. Open questions carried into Goal 2

1. **`fileIcons` shape.** `docs/FILE_TYPE_HANDLING.md` documents an array of
   `{ pattern, icon, color }`; `packages/extensions/excalidraw/manifest.json`
   ships an object map (`{"*.excalidraw": "draw"}`). Follow the shipping
   extension, verify at runtime.
3. **Design tokens.** Node components must use the canonical `--nim-*` CSS
   variables and `@container` queries (see `.claude/rules/ui-patterns.md` and
   `docs/EXTENSION_THEMING.md`) rather than hardcoded colors.
