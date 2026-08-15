# Diff at approval — see a run's effects before it starts

**Date:** 2026-08-15
**Status:** design
**Scope:** `packages/extensions/flows` only. No core files.

## The problem

Pressing **Run** goes straight from the canvas to execution — `startRun`
(`FlowEditor.tsx:564-572`) prepares the flow and immediately calls
`run.start`, with nothing in between. Before real files are written, real
shell commands run, and real agent sessions spend minutes, the author sees no
summary of what the run will actually touch. A flow that looks harmless on the
canvas can carry a `write-file` to a path built from a variable, a `shell`
command outside the allowlist, or an agent with a broad `tools` grant running
in the main working tree. The author should approve with sight of that.

## What the gate is

When the author presses **Run**, if the flow contains any side-effectful node,
a blocking modal lists what the run will do — grouped by effect, resolved as
far as is honestly possible — with **Approve → run** and **Cancel → back to
editor**. A flow with no side effects (only `human-gate` / read-only) runs
straight through, no gate. Approval is self-approval: no reject-with-comment,
there is no second party to send it to.

Honesty is the whole point, so three things are stated, never faked:

- **Runtime-only references stay symbolic.** A `{{node.port}}` value does not
  exist until the producing node runs, so a `write-file` path or `shell`
  command built from one is shown as its raw template, tagged "resolved at run
  time". Only flow `variables` and literals resolve to concrete text ahead of
  the run.
- **The shell allowlist flag is advisory.** The real guard is the backend,
  which re-tokenizes the argv and enforces `shell: false` with cwd
  confinement; the gate's in-editor `SHELL_ALLOWLIST` check is a UX signal, not
  the enforcement boundary. A command whose leading token is itself a
  `{{ref}}` is shown as "resolved at run time" rather than a false allow/deny.
- **`tools` is a real cap only for claude-code, and its absence is not
  "none".** For a `claude-code` agent node, a `tools` list is passed to
  `sendPrompt` and honored by the host (`host/nimbalystAgentClient.ts:75`;
  logged core change in `FORK-NOTICE.md:135`); codex / copilot-cli cannot
  declare `tools` at all (validation refuses it, `validate.ts:321-333`). An
  agent node with **no** `tools` list is not sandboxed — it inherits the
  project's trust level. The gate shows `tools: [...]` where declared and
  `tools: project default` where not; it never implies a restriction that does
  not hold.

## The effect list — `runner/flowEffects.ts`

A pure function, the testable heart. `flowEffects(flow, { shellAllowlist }) →
FlowEffectSummary`. The allowlist is a parameter, not an import — it is
duplicated across four entry points and the real guard lives in the backend,
so the gate reflects whatever list the caller runs under (the editor passes its
own `SHELL_ALLOWLIST`).

```ts
interface Resolved { text: string; resolved: boolean; } // resolved:false → text is the raw template

interface FileEffect  { nodeId: string; label: string; path: Resolved; }
interface ShellEffect { nodeId: string; label: string; command: Resolved; leadingToken: string | null; inAllowlist: boolean | null; }
interface AgentEffect {
  nodeId: string; label: string;
  kind: 'agent' | 'fan-out' | 'slash-command' | 'skill';
  provider: StepProvider;   // defaulted to 'claude-code'
  tools?: string[];         // undefined = project default, not "none"
  worktree: boolean;        // false → runs in the main working tree
  over?: Resolved;          // fan-out only; item count is runtime-only
}
interface FlowEffectSummary {
  files: FileEffect[]; shell: ShellEffect[]; agents: AgentEffect[];
  problems: { nodeId: string; message: string }[]; // straight from issuesByNode
  empty: boolean;                                   // true → caller skips the gate
}
```

`resolveTemplate(t, variables)`: `interpolate(t, { variables, outputs: {} })`
inside a `try`; success → `{ text, resolved: true }`; `UnresolvedReferenceError`
→ `{ text: t, resolved: false }`. This reuses the real interpolator — no second
resolver to drift from run behavior. With `outputs` empty, every
`{{node.port}}` is inherently symbolic, which is the truth pre-run.

`leadingToken`: first token of the resolved command; a command starting with a
`{{ref}}` yields `null` → `inAllowlist: null`.

Node → group: `write-file`→files; `shell`→shell;
`agent`/`fan-out`/`slash-command`/`skill`→agents; `human-gate`→ignored.
`empty` is true when files, shell, and agents are all empty.

`flowEffects` must never throw — it runs on the Run path. `resolveTemplate`
catches `UnresolvedReferenceError`; anything else propagates as a real bug
(the flow has already passed `prepareSave` validation before reaching here).

## The gate — `editor/FlowRunGate.tsx` + wiring

`FlowRunGate` is presentational, no logic:

```ts
{ summary: FlowEffectSummary; onApprove: () => void; onCancel: () => void; onPreview: () => void; }
```

A blocking modal reusing the existing `flow-gate` CSS shape: grouped **Files**,
**Shell** (outside-allowlist token flagged; unresolved leading token → "resolved
at run time"), **Agents** (kind, provider, `tools` or `project default`, `main
working tree` / `isolated`), and **Reference problems** (from `issuesByNode`,
when present). Buttons: **Approve → run** (primary), **Cancel**. A secondary
**Preview resolved commands** button fires the existing `run.dryRun` for a
rehearsal without closing the gate. `data-testid="flow-run-gate"`.

Wiring interposes in `startRun`:

```ts
const [pendingRun, setPendingRun] = useState<Flow | null>(null); // run state, not the xyflow store

const startRun = useCallback(() => {
  const prepared = prepareSave(baseRef.current, readGraph());
  if (!prepared.ok) { setSaveErrors(prepared.summary.replace('was not saved', 'cannot be run')); return; }
  setSaveErrors(null);
  const summary = flowEffects(prepared.flow, { shellAllowlist: SHELL_ALLOWLIST });
  if (summary.empty) { void run.start(prepared.flow); return; } // read-only flow → straight through
  setPendingRun(prepared.flow);
}, [readGraph, run]);
```

The gate renders when `pendingRun !== null`. Approve → `run.start(pendingRun)`
then clear; Cancel → clear; Preview → `run.dryRun(pendingRun)`. The summary is
recomputed pure on render from `pendingRun`, so there is no extra state to
drift and the doc is never dirtied. `problems` are shown but do not block
Approve — hard-invalid flows never reach the gate (validation stops them at
`prepareSave`); these are softer static-reference warnings, and the author is
the approver. The existing Dry-run toolbar button (`FlowEditor.tsx:800-820`)
is untouched — the gate's Preview reuses the same `run.dryRun`.

## Proof

Unit — `runner/__tests__/flowEffects.test.ts`, `// @vitest-environment node`,
pure: write-file literal path → resolved; `{{node.port}}` path → symbolic
(`resolved:false`, raw template); `{{var}}` path + `flow.variables` → concrete;
shell `npm test` → `leadingToken:'npm'`, `inAllowlist:true`; shell `curl …` →
`inAllowlist:false`; shell `{{cmd}} …` → `leadingToken:null`,
`inAllowlist:null`; agent with `tools` → listed; agent without → `undefined`;
agent `worktree:false` → main tree; fan-out `over:{{x.items}}` → symbolic;
human-gate-only flow → `empty:true`; a bad reference → surfaced in `problems`.

E2E — extend `tests/flowsData.spec.ts`, kept deterministic (CI has no real
shell or agent backend, so the approve-executes case uses `write-file`, which
runs through the ordinary file writer):

- **Gate lists effects.** A flow with a `shell` node → pressing Run shows
  `flow-run-gate` carrying the command text (asserted on the gate, not
  executed).
- **Approve executes.** A `write-file` flow with a literal path and content →
  Run shows the file in the gate → Approve → the file **is** on disk and a
  `.flow-runs/` record exists.
- **Cancel executes nothing.** Same flow → Run → Cancel → the file is **not**
  on disk, no record.
- **Empty flow skips the gate.** A human-gate-only flow → Run goes straight to
  the pause card, no `flow-run-gate`.

No jsdom component test for the presentational markup (repo bans
presentation-only and jsdom-CSS tests).

## Pieces

| File | Change |
| --- | --- |
| `src/runner/flowEffects.ts` | new — pure `flowEffects(flow, { shellAllowlist })` extractor |
| `src/editor/FlowRunGate.tsx` | new — presentational blocking modal |
| `src/editor/FlowEditor.tsx` | `startRun` interception + `pendingRun` state + gate render |
| `src/styles.css` | a few `.flow-run-gate-*` rules over the existing `flow-gate` shape |
| `src/runner/__tests__/flowEffects.test.ts` | new — pure extractor tests |
| `tests/flowsData.spec.ts` | extend — gate blocks/approves/cancels; empty flow skips |
