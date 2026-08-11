# Resume a failed run — stop paying for the steps that already worked

**Date:** 2026-08-12
**Status:** design
**Scope:** `packages/extensions/flows` only. No schema change to `.flow.json`.

## The problem

When a run fails at step 8 of 10, the only offer is to run all 10 again. Agent
steps cost minutes and money, gates cost a person's attention, and `write-file`
steps have already done their work — all of it is re-paid to retry one broken
step. The cost scales with flow quality: the bigger the pipeline, the more a
single flaky step punishes it.

Everything needed already exists in the run record: per-node status, per-node
output, and the interpolation map (`record.outputs`). What is missing is the
rule for when a recorded result is still trustworthy.

## The rule

A node's recorded result is **reused** iff:

1. the record shows it `done`,
2. its **definition hash** matches — the node's JSON minus `position` and
   `label` (cosmetic edits must not invalidate work), and
3. every direct parent is itself reused (in topological order, so the rule
   cascades: any re-run node re-runs everything downstream of it, because its
   output may differ).

Everything else re-runs. A record written before hashes existed has no hash, so
nothing from it is reused — honest, and self-corrects on the next run.

Reused executions keep their `output`, `sessionId` and `warning`, gain
`reused: true`, and **drop timestamps and usage** — the work cost this run
nothing, and carrying the old timings forward would double-count agent time on
the dashboard. The new record carries `resumedFrom: <old runId>`.

Gates: an approved gate whose upstream is unchanged stays approved — the person
already approved exactly this content. A gate that failed (rejected) re-asks.

## Pieces

| File | Change |
| --- | --- |
| `src/runner/resume.ts` | new — `nodeDefinitionHash`, pure `planResume(flow, record)` |
| `src/runner/dagExecutor.ts` | write `definitionHash` on every execution; accept a `seed` that pre-completes reused nodes before the loop starts |
| `src/runner/flowRun.ts` | `options.resumeFrom?: RunRecord` → plan → seed |
| `src/runner/runStore.ts` | `resumedFrom` on the record |
| `src/editor/useFlowRun.ts`, `FlowEditor.tsx` | a "Retry failed steps" button when the latest record is `failed`/`interrupted`/`cancelled` |
| `tests/flowEditor.spec.ts` | the on-disk proof below |

## Tests

Pure and exhaustive on `planResume`: untouched flow reuses all done nodes;
edited node re-runs; edit cascades to descendants but not siblings; failed,
skipped and missing nodes re-run; a record without hashes reuses nothing;
`position`/`label` edits reuse everything. Integration on the executor: stub
executors, count invocations, assert only the failed node re-ran and seeded
outputs interpolate downstream.

E2E, the proof that reuse is real and not re-execution: run 1 — `write-file`
succeeds, then a gate is rejected, run fails. **Delete the written file from
disk.** Resume, approve the gate. The run finishes and the file is *still
absent* — the write-file step was reused, not re-run. A re-execution would have
recreated it.

## Out of scope

`--resume` on the headless CLI; automatic retry policies (`retries: 2` on a
node); resuming across a flow rename.
