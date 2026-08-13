# Durable runs — offer to resume an interrupted run on open

**Date:** 2026-08-13
**Status:** design
**Scope:** `packages/extensions/flows` only. Goal C of the roadmap.

## The problem

The machinery already survives a crash: every node transition rewrites the
run record, `repairStale` settles abandoned `running` records to
`interrupted`, and the retry path resumes them with finished steps seeded.
What is missing is the *offer*. After an app restart the user sees a normal
canvas; the interruption — and the money already spent on its finished
steps — is invisible unless they open the run history and know what the
small retry button does.

## What ships

A banner, shown when the flow opens and its latest record is `interrupted`:

> Last run was interrupted — N finished steps will be kept. **[Resume]**
> [Dismiss]

- **Resume** is the existing retry path (`planResume`: reuse what is
  trustworthy, re-run the rest). No new run semantics.
- **Dismiss** hides the banner for this editor session; reopening the flow
  offers again — the record still says interrupted, so the offer stands.
- Only `interrupted`. A `failed` run announced itself when it failed and
  already has result strips + retry; `cancelled` was the user's own hand.
  Interruption is the one status nobody watched happen.

## Pieces

| File | Change |
| --- | --- |
| `src/editor/resumeOffer.ts` | `resumeOffer(records)` → `{ record, finished } \| null` |
| `src/editor/FlowEditor.tsx` | banner between toolbar and canvas; Resume = `retryRun`; Dismiss = per-mount state |
| `src/styles.css` | `.flow-resume-banner` |

## Proof

Unit: offer on latest-interrupted with correct finished count; null for
failed / cancelled / done / empty / latest-running. E2E (CI, deterministic):
seed an interrupted record whose first write-file step is `done`, open the
flow, banner shows; Resume → downstream runs, upstream artifact provably
NOT rewritten, new record carries `resumedFrom` + `reused`, banner gone.

## Out of scope

Auto-resume without asking (a gate or an agent bill must never restart
itself), cross-flow interruption inventory on the Flows home, and resuming
mid-node (a half-finished agent step re-runs whole).
