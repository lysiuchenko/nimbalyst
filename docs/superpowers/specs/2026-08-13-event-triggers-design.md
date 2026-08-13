# Event triggers — a flow that runs when the workspace changes

**Date:** 2026-08-13
**Status:** design
**Scope:** `packages/extensions/flows` only. Goal B of the roadmap.

## The problem

Schedules answer "every night at 2"; they cannot answer "whenever the docs
change, rebuild the summary". The workspace already broadcasts
`file-changed-on-disk` to the renderer — the flows extension just never
listens.

## What ships

A flow-level `trigger`, sibling of `schedule`:

```json
"trigger": { "type": "file-change", "glob": "notes/**/*.md",
             "debounceSeconds": 10, "onGate": "pause", "enabled": true }
```

When a changed file matches the glob, the flow runs — after a per-flow
debounce, because saves arrive in bursts and one run per keystroke would be
an outage, not a feature.

## Rules that keep it safe

- **A triggered run is unattended**, exactly like a scheduled one: same gate
  policy (`pause` declines the run and says why; `skip` auto-approves and
  the validator keeps refusing `skip` where a shell command hides behind the
  gate). `scheduledGatePolicy` generalises to `unattendedGatePolicy(flow,
  onGate)`; the scheduler keeps its wrapper.
- **Self-noise cannot loop.** Changes under `.flow-runs/`, to `*.schedule.json`
  and to `*.flow.json` never trigger (a flow edit refreshes the trigger list
  instead). An event that fires while the flow's own triggered run is in
  flight is dropped, not queued.
- **One run per quiet period.** The debounce timer resets on every matching
  event; only silence fires.

## Pieces

| File | Change |
| --- | --- |
| `src/trigger/types.ts` | `FlowTrigger` |
| `src/trigger/matcher.ts` | tiny glob (`**`, `*`, `?`) → RegExp; suffix-matched, since events carry absolute paths and `ExtensionContext` has no workspace root |
| `src/trigger/TriggerEngine.ts` | debounce, self-noise filter, in-flight drop, list refresh on flow edits; injectable deps like `FlowScheduler` |
| `src/trigger/startTriggers.ts` | wiring: scan `*.flow.json`, subscribe, run via the scheduler's `runFlow` shape |
| `src/host/rendererEvents.ts` | adapter over `window.electronAPI.on('file-changed-on-disk')` — the same call `PanelHostImpl.onWorkspaceEvent` makes; no core change |
| `src/schema/validate.ts` | `trigger` validation mirroring `schedule` |
| `src/schedule/gatePolicy.ts` | `unattendedGatePolicy(flow, onGate)` |
| `src/editor/FlowEditor.tsx` | trigger controls beside the schedule ones |

## Proof

Unit: matcher (`**` spans directories, `*` stays in a segment, `?`, escaped
dots, suffix matching); engine (burst → one run, in-flight drop, self-noise
ignored, flow-edit refresh); validator (shape, debounce range, `skip`+shell
refusal). E2E (CI): a flow triggering on `notes/*.md` with a write-file
node; the test writes an unrelated file then a matching one; the flow runs
once — artifact on disk, exactly one run record.

## Out of scope

Git-event triggers (commit/branch — worth doing once someone asks for one
concrete case), triggering flows in unopened workspaces (no renderer, no
services), and queueing runs behind an in-flight one.
