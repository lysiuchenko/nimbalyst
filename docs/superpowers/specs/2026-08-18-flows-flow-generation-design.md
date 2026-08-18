# Reliable "watch it build" flow generation

**Date:** 2026-08-18
**Status:** design
**Scope:** `packages/extensions/flows` only. No core files. All model calls stay behind the existing `DraftModel`/host `ai` service — never the SDK directly.

## Problem — what exists, what's missing

A prompt-to-flow generator already ships in `src/editor/aiDraft.ts`:

- `draftFlow(model, description)` and `editFlow(model, current, instruction)` return `{ flow } | { errors }`.
- A hand-written `SCHEMA_GUIDE` string + one `EXAMPLE` teach the model the shape; `extractJson` strips code fences; `generate()` runs the emitted JSON through `validateFlow` and, on failure, does **exactly one** repair turn feeding the validator's `ValidationError[]` back, then gives up.
- Wired in `FlowEditor.tsx` (`flow-draft` textarea, `flow-draft-go`; edit path ~`:1268`) via `getHostServices().ai` (an `ExtensionAIService` that satisfies `DraftModel`).

Three gaps keep it from being the demo it should be:

1. **It's a black box.** Type a sentence → the whole graph appears at once, or an error dump appears. No sense of the pipeline being *built*. The wow — "watch the DAG assemble itself from one sentence" — is absent.
2. **One repair turn is fragile.** Non-trivial asks routinely need two or three corrections (a missing `over` on a fan-out, an edge to a non-existent node). After one failed repair the user gets raw `ValidationError[]`.
3. **The schema guide drifts.** `SCHEMA_GUIDE` is prose maintained by hand next to `NODE_TYPES`/`FlowNode` in `src/schema/types.ts`. Add a node type and the guide silently lies. There is no hard palette constraint beyond what the prose happens to say — reliability rests on prose the model may ignore.

## Approach — ground the palette in code, repair in a loop, reveal on canvas

Keep the `DraftModel` seam and the `validateFlow` gate. Change three things: derive the teaching prompt from the real registry, loop the repair, and stage the reveal.

### 1. Palette-derived schema guide (`src/editor/aiDraft.ts`)

Replace the hand-written `SCHEMA_GUIDE` string with a builder that reads the single source of truth:

```ts
function buildSchemaGuide(): string;   // enumerates NODE_TYPES + each type's required/optional fields
```

- Enumerate `NODE_TYPES` (`'agent'|'fan-out'|'slash-command'|'skill'|'shell'|'human-gate'|'write-file'`) and, per type, its required fields (e.g. `fan-out` requires `prompt` + `over`; `write-file` requires `path` + `content`) drawn from the `FlowNode` union in `src/schema/types.ts`. A new node type appears in the guide automatically.
- Include 1-2 **real** curated examples as few-shot from `src/library/catalog.ts` `LIBRARY_FLOWS` (e.g. `pr-review`) via `serializeFlow`, instead of the single inline `EXAMPLE`. Real, validated flows are stronger anchors than a toy.
- State the hard rule in the prompt: emit only types in the palette; every edge `from`/`to` must reference a declared node `id`.

### 2. Bounded multi-turn repair (`src/editor/aiDraft.ts`)

Generalize `generate()` from one repair turn to a loop:

```ts
const MAX_REPAIR_TURNS = 3;
// turn 0: draft; turns 1..N: feed validateFlow errors back verbatim until valid or budget spent.
```

- Each turn re-runs `extractJson` → `validateFlow`; on `{valid:false}` feed the `ValidationError[]` (path + message) back and retry.
- **Hard palette check before accepting:** reject any node whose `type` ∉ `NODE_TYPES` even if `validateFlow` somehow passed it, and route it through the repair loop with an explicit error. Belt-and-suspenders against a model inventing a node type.
- **Credential gate:** the emitted flow must pass the existing `CREDENTIAL_PATTERNS` scan in `validate.ts`. A generated flow that embeds a secret is rejected (never rendered), consistent with the `.flow.json` no-secrets rule — surfaced as an error, not silently stripped.
- Return the same `{ flow } | { errors }` contract; on exhaustion, return the *last* validator errors (unchanged API for callers).

### 3. Staged canvas reveal (`FlowEditor.tsx`)

The wow. Once a valid `Flow` is produced:

- Run the existing auto-layout (`flowToGraph` / the layout used on template apply) to position nodes.
- Reveal incrementally in **topological order** (roots first, following edges): add nodes to the xyflow graph in short steps so the pipeline visibly assembles rather than snapping in whole. Reuse `createNode`/`flowToGraph`; no new layout engine.
- Show a "generating…" state (`flow-draft` busy) while the repair loop runs, then the reveal. The graph remains fully editable after (unchanged from today — it's a normal `FlowGraph`).

Presentation only for the reveal animation; the generate/repair/validate logic is where the behavior — and the tests — live.

## Verification

1. **Schema-guide derivation** (`aiDraft.test.ts`, `// @vitest-environment node`). Assert `buildSchemaGuide()` names every member of `NODE_TYPES` and each type's required fields. This is the drift guard: adding a type to `NODE_TYPES` without updating the field map fails the test. (Not a presentation assertion — it guards a real invariant a reader can't see.)
2. **Repair loop** (`aiDraft.test.ts`, node env, `DraftModel` stubbed). A stub that returns invalid JSON twice then valid → `draftFlow` returns `{flow}` and called the model 3 times, feeding errors each time. A stub that never validates → `{errors}` after `MAX_REPAIR_TURNS`, no throw.
3. **Palette rejection** (node env). Stub emits a node with `type:'wizardry'` → rejected and repaired (or `{errors}` if unrepaired); never returned as a valid flow.
4. **Credential rejection** (node env). Stub emits a flow containing a credential-shaped literal → `{errors}` from the `CREDENTIAL_PATTERNS` scan; not rendered.
5. **Mount** (light, `createRoot` + `act`). Feeding a valid generated `Flow` into the editor produces an editable graph with the expected node count. The reveal *animation* itself is presentation — no per-frame test.

## Out of scope

Streaming token-by-token generation. Providers other than `claude-code` (the `DraftModel` is claude-code-only, matching the current call). Reworking `editFlow` beyond giving it the same multi-turn repair. A visual "diff of what changed" between draft revisions.

## Fork notes

No core files touched; no `FORK-NOTICE.md` row. Generation goes through `getHostServices().ai` (the `DraftModel` seam), never the Agent SDK directly, per hard rule 3.
