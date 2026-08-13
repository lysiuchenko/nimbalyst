# Dry run — rehearse the flow without spending anything

**Date:** 2026-08-13
**Status:** design
**Scope:** `packages/extensions/flows` only. Second item of the 100x plan.

## The problem

The only way to learn whether a flow's *logic* works — routing, conditions,
joins, references, gate placement — is to run it, paying agent minutes and
executing side effects. Authoring confidence needs a loop measured in seconds.

## What a dry run is

Press **Dry run**: the whole graph executes instantly with every external
effect stubbed, and the canvas lights up exactly as a real run would —
statuses, output strips, gate cards, skips.

| Step kind | Dry behaviour |
| --- | --- |
| agent / skill / slash-command | instant `[dry-run] <label>` output; no session |
| fan-out | real fan-out logic over the real list; each child instant |
| shell | **not executed** — `[dry-run] would run: <command>`, always success |
| write-file | **nothing written** — `[dry-run] would write <path> (N characters)` |
| human-gate | **real** — pausing for the decision is the rehearsal |

Three deliberate consequences, stated rather than hidden:

- **Shell steps always "succeed"** — a rehearsal cannot know exit codes, and
  success is the only neutral stance. Failure-path rehearsal comes from
  rejecting a gate.
- **`when:` conditions evaluate against the stub outputs**, so most will read
  false and their branches will visibly die. That is the truth about *those*
  outputs, and watching where the graph dies is precisely the rehearsal. (Per-
  node stub values, for steering a specific branch, are a follow-up — not
  smuggled into v1.)
- **Nothing persists.** No `.flow-runs` record, no artifact, no session. One
  lever delivers all three: the run's file writer is a no-op, and the
  write-file executor is swapped for the honest reporter — the real one would
  otherwise claim "wrote X" over a write that never happened.

## Pieces

| File | Change |
| --- | --- |
| `src/runner/dryRun.ts` | the stub agent + shell clients |
| `src/runner/flowRun.ts` | `options.dryRun` — no-op record channel is the caller's writer; swaps the write-file executor |
| `src/editor/useFlowRun.ts` | `dryRun(flow)` control; `isDry` state |
| `src/editor/FlowEditor.tsx` | toolbar **Dry run** button + "nothing was executed" indicator |

## Proof

Unit: stub shapes; `dryRun` write-file reports "would write" and the writer is
never called; the gate is still consulted; a `when` edge routes on the stub
output. E2E (CI, deterministic — the dry shell succeeds where CI's real shell
backend does not even exist): shell → gate → write-file, dry-run it, approve
the gate, assert the strips say "would run"/"would write", the file is **not**
on disk, and `.flow-runs/` holds no record.
