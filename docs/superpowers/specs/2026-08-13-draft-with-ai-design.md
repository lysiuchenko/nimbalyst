# Draft & edit flows with AI — authoring at the speed of intent

**Date:** 2026-08-13
**Status:** design
**Scope:** `packages/extensions/flows` only.

## The loop, and why it cannot ship garbage

*Generate → validate → feed the errors back → repair → apply.* The model never
touches the canvas directly: its JSON goes through `validateFlow`, the same
gate every hand-written flow passes, and a failed draft comes back to it as a
list of precise errors (`nodes[2].run: shell node requires a non-empty run`)
for one repair attempt. Still invalid after that → the user sees the validator
errors and the canvas is untouched. The failure mode is a message, never a
broken document.

Two entry points, one orchestrator:

- **Draft** — the empty canvas gains "or describe it" beside the templates.
  A sentence in, a complete flow out, landing exactly as a template does.
- **Edit** — a toolbar action on a non-empty canvas: the *current* flow JSON
  plus an instruction ("make the review branch also check licenses") in, the
  complete revised flow out, applied as an **undoable** canvas edit.

## Mechanics

`src/editor/aiDraft.ts`, pure except for one injected `sendPrompt` port:

- `draftFlow(ai, description)` / `editFlow(ai, currentFlow, instruction)` —
  up to two model turns (draft + one repair), returning `{flow}` or
  `{errors}`.
- The generation prompt carries a compact schema cheat-sheet (node types with
  required fields, edges with `port`/`on`/`when`, `join`, `retries`,
  variables, `{{refs}}`), the no-secrets rule (`${env:NAME}`), and one small
  worked example. Replies must be JSON only; fenced JSON is tolerated.
- Sessions are agent-mode, per-turn notifications suppressed — drafting is
  machine-driven work like any flow step.

## Verification

Unit: prompt builders; fence-tolerant parsing; the orchestrator against a fake
model — first-shot valid, invalid-then-repaired (asserting the errors reached
the second prompt), twice-invalid returns the error list. E2E (CI, no
provider): the UI seam fails honestly — error shown, canvas untouched. Live:
one real draft through the built app, landing a validated flow on the canvas.

## Out of scope

Streaming the draft in, partial/subgraph edits (the model returns the whole
flow), and drafting schedules (settable after, in the panel that owns them).
