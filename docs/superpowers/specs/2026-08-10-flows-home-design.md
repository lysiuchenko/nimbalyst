# The Flows home

**Date:** 2026-08-10
**Status:** design
**Scope:** `packages/extensions/flows` only — no core change (`host.openFile`
already exists at `extension-sdk/src/types/panel.ts:298`)

## The problem, measured

`FlowsDashboard.tsx` is 122 lines containing zero `button`, `onClick` or
`schedule`. The only screen in the app branded **Flows** is a read-only report
that lists a flow **only once it has already run** — `summariseRuns` builds
`byFlow` from run records (`metrics.ts:70`). On a fresh workspace it renders one
sentence in the top-left of a full-screen black rectangle.

See `docs/flows-app-level-gaps.md` for the full audit and screenshots.

## What it becomes

The panel answers three questions a person actually arrives with:

1. **What flows do I have?** — every `*.flow.json` in the workspace, whether or
   not it has ever run.
2. **Is each one healthy?** — last outcome, when, how long it usually takes.
3. **What happens next?** — the next scheduled run, or "manual".

And it lets them act: a row opens the flow.

## Design

### Rows, not just aggregates

Two sources merged, left-joined on path:

- **Flow files** — `findFiles('*.flow.json')`, the same glob the scheduler
  already trusts (`startScheduler.ts:30`), parsed for `name` and `schedule`.
- **Run metrics** — the existing `summariseRuns`, extended with the two fields a
  row needs and nothing else: `lastRunAt` and `lastStatus`.

A flow with no runs is still a row, marked "Not run yet". That is the case the
current screen cannot represent at all, and it is the case every new user is in.

A run record whose flow file no longer exists keeps its row too, marked
**Archived** — deleting or renaming a flow should not silently erase what it
did. This is the honest half of the rename problem in the audit; reattaching a
renamed flow to its history is a separate piece of work.

### The merge is pure

`src/dashboard/flowList.ts` — `buildFlowRows(files, metrics, now)` → `FlowRow[]`.
No I/O, so every ordering and edge case is a unit test. Sorted: scheduled and
failing first, then most recently run, then never-run, then archived.

### Rows are interactive

`host.openFile(row.flowPath)` on click and on Enter/Space. Archived rows are not
clickable — there is no file to open.

### The empty state teaches

Instead of one grey sentence: a short "what a flow is", and the fact that
**New File → Flow** is where one comes from — the manifest already contributes
that entry and nothing in the product says so.

### Numbers stop lying

`durationOf` (`metrics.ts:36`) guards `undefined` but not `NaN`, and
`Math.max(0, NaN)` is `NaN`, which reaches the tiles as **`NaNm`** — screenshot
in the audit. Both `durationOf` and `asDuration` get a finite-number guard so a
hand-edited or half-written record degrades to `—` rather than shouting `NaN`.

## Files

| File | Change |
| --- | --- |
| `src/dashboard/flowList.ts` | new — pure merge + sort |
| `src/dashboard/loadFlowFiles.ts` | new — scan and parse `*.flow.json` |
| `src/dashboard/metrics.ts` | `lastRunAt` / `lastStatus`; NaN guard |
| `src/dashboard/asDuration.ts` | NaN guard |
| `src/dashboard/FlowsDashboard.tsx` | render rows, empty state, click |
| `src/styles.css` | row, status and schedule styling |

## Tests

Pure and exhaustive on `buildFlowRows`: a flow that never ran, a run whose flow
is gone, ordering across all four groups, a scheduled flow, a flow whose file
will not parse. `asDuration`/`durationOf` on `NaN`, `Infinity`, negative.
Component: rows render, a click calls `openFile`, the empty state appears with
no flows. E2E: the panel lists a flow that has never run, and clicking it opens
the editor.

## Out of scope

Running a flow from the panel, editing a schedule from the panel, reattaching a
renamed flow to its history, and the run trace view. Each is its own piece.
