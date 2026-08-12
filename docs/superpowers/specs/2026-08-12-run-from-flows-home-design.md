# Run a flow from the Flows home

**Date:** 2026-08-12
**Status:** design
**Scope:** `packages/extensions/flows` only.

## The problem

The Flows home lists every flow, but acting on one still means opening it and
finding the Run button inside the editor. The audit called this out twice: "an
automation you can only trigger by opening its source file is not an
automation", and "the rows are there; the button is not."

## The design: the panel launches, the editor runs

Running involves gates that need a person, sub-agent cards, live statuses and a
cancel button — all of which the editor already renders. Duplicating that stack
in the panel would be a second run surface to keep honest. So the Run button on
a row does three things: records a **run intent** for that flow's path, opens
the flow, and stands the panel down. The editor consumes the intent when the
flow finishes loading and starts the run exactly as if Run had been clicked.

The bridge is a module-level one-slot store (`src/editor/runIntent.ts`) — panel
and editor live in the same extension bundle, so no IPC and no storage:

- `requestRun(flowPath)` — called by the panel before `openFile`.
- `consumeRun(flowPath): boolean` — called by the editor once loading ends;
  true at most once, and only for the matching path. An intent that is never
  consumed simply ages out when the next one replaces it — it must not fire a
  run hours later on an unrelated open.

An already-open editor is covered by the same path: `openFile` focuses the
existing tab, and the editor also checks the intent on panel-driven focus...
which it cannot observe. **Amendment:** rather than focus events, the intent
carries a timestamp and the editor polls nothing — the consume check runs in
the load effect *and* on a `flows:run-intent` window event the panel fires
after `openFile`, which an already-mounted editor hears.

## Which rows get the button

`ok`, `failing`, `never-run` — flows that exist and parse. Not `invalid` (the
run would only fail validation), not `archived` (no file), not `running` (one
run per flow at a time is the rule everywhere else). The button sits inside the
row, which is itself a click target, so it stops propagation.

## Tests

Unit: the intent store — consume once, wrong path refused, replacement, and the
staleness cutoff. Component: eligible rows show the button, `invalid` /
`archived` / `running` rows do not. E2E: from the panel, click Run on a
`write-file` flow's row — the editor opens, the run executes, the file lands on
disk, with no click on the editor's own Run.

## Out of scope

Running inside the panel, gate approval from the panel, cancelling from the
panel, and a live status column while a run is in flight.
