# Calm the canvas — run progress, toolbar order, minimap

**Date:** 2026-08-14
**Status:** design
**Scope:** `packages/extensions/flows` only. UX batch 1.

## Three fixes

1. **Run progress header.** Nothing answers "how far along is this run?"
   at a glance. A strip while running: `step 3 of 7 · summarize · 42s ·
   Cancel`; clicking the running step name pans the canvas to it. Derived
   by a pure `runProgress(statuses)` over the same status map the cards
   read — run state still never enters the xyflow store.
2. **Toolbar regrouped.** One flat wrapping row mixes authoring, document
   settings and execution. Order becomes: add-nodes cluster · document
   cluster (Runs / Schedule / Variables) · save status · run cluster (Dry
   run / Edit with AI / Retry / Run) · a `…` overflow holding App theme
   and the minimap toggle. Dividers between clusters; no behavior change.
3. **Minimap tamed.** It overlays interactive canvas and eats clicks on
   nodes beneath it (seen intercepting the run-from button at small
   windows). It shrinks, and the overflow menu can hide it entirely.

## Proof

Unit: `runProgress` counting — terminal vs running vs unstarted, null when
idle. E2E (existing gate describe, where a run reliably pauses): progress
strip visible with `N of M` while waiting at the gate; overflow menu opens;
minimap toggle removes the minimap.

## Out of scope

Gate panel redesign, hover-reveal card actions, edge inspector, shortcuts
(batches 2–3).
