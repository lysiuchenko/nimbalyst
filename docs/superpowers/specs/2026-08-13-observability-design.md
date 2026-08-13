# Observability, part 1 — edge payloads and reliability chips

**Date:** 2026-08-13
**Status:** design
**Scope:** `packages/extensions/flows` only. Goal D of the roadmap, first slice.
(The replay scrubber is the second slice, deliberately separate.)

## The problems

Two questions the canvas cannot answer today:

1. **"What actually flowed through this wire?"** Node cards show what a step
   produced, but an edge — the thing the author drew — is mute. Debugging a
   bad hand-off means opening two cards and doing the join in your head.
2. **"Which step is flaky?"** The history table says run 7 failed; only
   reading every run tells you it is always the same step.

## What ships

- **Click an edge** → a panel names the hand-off (`plan → approve`, the
  `{{plan.plan_md}}` it carries) and shows the payload from the current run
  if one is live, else the latest record. A failure edge shows the error it
  routes. No data yet → the panel says so instead of hiding.
- **Reliability chips**: a node that failed at least once in the recorded
  window (last 20 runs) wears `ok/total` in its header, tinted; tooltip
  spells it out. Nodes with a clean record wear nothing — the chip is
  signal, not decoration.

## Mechanics

Pure helpers in `src/editor/observability.ts`:

- `edgePayload(edge, outputs)` — port edge reads `outputs[from][port]`,
  failure edge reads `outputs[from].error`, an unnamed edge falls back to
  the from-node's single output; null when nothing was recorded.
- `nodeReliability(records)` — per node: `done` counts as ok, `failed`
  counts against, everything else (skipped, queued, running) is not
  evidence either way. Reused executions count as done — they did succeed.

Wiring in `FlowEditor`: `onEdgeClick` (double-click already means
toggle-failure; a single click landing first is harmless) sets the selected
edge; the panel renders under the toolbar like the AI-edit row. Reliability
is a `useMemo` over `pastRuns`, published through a new
`NodeReliabilityContext` — run state never enters the xyflow store.

## Proof

Unit: both helpers, all branches. E2E: seeded-records describe asserts the
chip (`approve` failed 1 of 2 recorded outcomes; `plan` clean → no chip);
a live mini-run describe clicks the edge and reads the real payload, then a
failure edge's error.

## Out of scope

Replay scrubber (slice 2), payload history across runs (latest only), and
truncation controls (CSS clamps, full text stays in the DOM).
