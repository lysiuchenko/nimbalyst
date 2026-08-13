# Run from here — the REPL loop for flows

**Date:** 2026-08-13
**Status:** design
**Scope:** `packages/extensions/flows` only. First item of the 100x plan.

## The problem

Tweak the prompt on step 5 of 7 and the only offer is to re-run all 7 —
re-paying agents for steps 1–4 whose outputs were fine. Resume covers *failed*
runs; nothing covers *iteration*, which is where authors actually live.

## The rule

**Run from `X`** re-runs `X` and everything downstream of it. Everything else
is seeded from the latest run's record — its `done` executions become
pre-completed successes, outputs included, exactly as resume seeds them
(reused-marked, timings dropped, so the dashboard never double-counts).

Two deliberate differences from resume's reuse rule:

- **No definition-hash check on the seeded side.** Resume must distrust edits;
  run-from-here is the *user drawing the boundary* — "trust everything above
  this line, re-run below it". Their edit to step 5 is exactly why they are
  here.
- **A node that did not finish last run is simply not seeded.** It does not
  run either (it is not downstream of `X`); joins depending on it die through
  the normal dead-edge machinery and show as skipped. Honest: the record could
  not vouch for it, and the user asked to run from `X`, not from there.

Routing still routes: seeded parents release their edges through the same
completion machinery, conditions re-evaluate against the seeded outputs, and
if the path to `X` was dead in the seeded run it is dead now — the canvas
shows the skip rather than forcing a node its own routing rejects.

The new record carries `resumedFrom`, same as resume.

## Pieces

| File | Change |
| --- | --- |
| `src/runner/resume.ts` | `planRunFrom(flow, record, startId)` — descendants of `startId` run; the rest seed if `done` |
| `src/runner/flowRun.ts` | `options.startAt` — with `resumeFrom`, selects `planRunFrom` |
| `src/editor/useFlowRun.ts` | `start(flow, resumeFrom?, startAt?)` |
| `src/editor/nodes/nodeTypes.tsx` | a run-from button on the node header, enabled when a past record exists |
| `src/editor/FlowEditor.tsx` | wires the button to the latest record |

## Proof

Pure: descendant computation (start runs, downstream runs, siblings seed,
unfinished siblings do not, edited upstream still seeds — asserted explicitly).
E2E, CI-covered and on disk: run a two-step write-file flow fully, delete the
first artifact, run-from the second step — the first file is **not** recreated
(seeded, not re-executed), the second is, and the record says `reused`.
