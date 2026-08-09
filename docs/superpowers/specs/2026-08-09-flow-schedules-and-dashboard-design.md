# Scheduled flow runs and the flow analytics dashboard

**Date:** 2026-08-09
**Status:** implemented — see the amendments marked in §4.3 and §8
**Scope:** `packages/extensions/flows` only, plus one prerequisite core fix (§8)

## 1. What we are building

Two features that share one data source:

1. **Schedules** — a flow runs on a repeating schedule without anyone pressing Run.
2. **Dashboard** — a panel showing, across every run in the workspace: token
   spend, agent time, and human time.

They belong in one spec because the dashboard is only worth building if runs
accumulate on their own, and a schedule is only trustworthy if you can see what
it has been doing.

## 2. What already exists

Measured before designing, not assumed:

| Fact | Where |
| --- | --- |
| An extension can schedule work from the renderer with a `setTimeout` chain started in `activate()`, persisting an absolute next-run time so the clock survives rescans and restarts | `packages/extensions/automations/src/scheduler/AutomationScheduler.ts` |
| Schedules are already modelled as `interval \| daily \| weekly` — no raw cron strings | `packages/extensions/automations/src/frontmatter/types.ts:51` |
| An extension can contribute a full-screen panel with its own gutter button | `packages/extension-sdk/src/types/panel.ts:39` |
| Headless mode **refuses** agent nodes | `packages/extensions/flows/src/headless/runHeadless.ts:29` |
| Run records already carry per-node `startedAt` / `finishedAt`, `status`, `children[]`, `sessionId` | `packages/extensions/flows/src/runner/types.ts:47` |
| Run records carry a `usage` field that is **always zero** because the host leaves `tokenUsage` null — on *every* session path, not just the extension's | verified 2026-08-09; see §8 |

## 3. Scope decision: when can a schedule fire?

Because headless mode cannot run agent nodes, a scheduled flow containing an
agent node can only run inside the running app. Three options were considered:

- **A — only while Nimbalyst is open.** Mirrors the automations extension. No
  core change. A 2am nightly run only happens if the machine is awake and the
  app is running.
- **B — also when the app is closed.** Requires either a headless agent runtime
  (declined previously: it would duplicate the credential-stripping written
  after a real billing incident, see `docs/editorhost-notes.md` §5b) or a
  launchd agent that launches Nimbalyst at 2am.
- **C — A now, with the door open to B.** Schedule *definition* lives in the
  flow file, so any future runner can read it; the in-app scheduler is a thin
  driver over that definition.

**This spec assumed C**, and C shipped first. **B shipped afterwards**, by the
launchd route rather than a headless agent runtime: `nimbalyst-flows schedule
install` writes a per-workspace LaunchAgent that runs `schedule run` on an
interval. It fires shell and gate flows with the app closed and *reports* agent
flows instead of attempting them, so the declined headless-agent runtime stays
declined. Verified end to end: launchd ran a due flow with no app process
alive.

## 4. Design — schedules

### 4.1 Where the schedule lives

Split, deliberately:

- **Definition → the `.flow.json` file.** Declarative, reviewable in a diff,
  travels with the flow to another machine.
- **State → `.flow-runs/<flow>.schedule.json`.** Local, machine-specific, never
  shared. (One file per flow, so two scheduled flows cannot overwrite each
  other's clock.)

This mirrors a rule the extension already holds: run state must not enter the
document. Sub-agent cards are rendered outside the xyflow store for exactly this
reason (`src/editor/SubAgentLayer.tsx`). Writing `lastRun` into `.flow.json`
would dirty the file on a timer and put machine state into a shared artifact.

### 4.2 Schedule format

New optional field on the flow, matching the automations vocabulary so the two
features do not disagree in front of the same user:

```jsonc
{
  "schedule": {
    "type": "daily",          // "interval" | "daily" | "weekly"
    "time": "02:00",          // daily and weekly
    "days": ["mon", "wed"],   // weekly only
    "intervalMinutes": 60,    // interval only
    "enabled": true,
    "onGate": "pause"         // "pause" | "skip"
  }
}
```

No cron expressions. `0 2 * * 1-5` is a barrier to the business-analyst half of
the audience for no gain at this scale.

### 4.3 What happens at a human gate

The sharpest question in the feature: a flow scheduled nightly that contains a
`human-gate` has nobody there to approve it.

- `onGate: "pause"` (default) — **amended during implementation.** The design
  said the run would pause and notify. Built that way it would hang: a
  scheduled run has no editor open, so the gate would wait forever while
  holding the flow's in-flight lock, blocking every later scheduled run of the
  same flow. The scheduler therefore *declines* the run and says why, naming
  the gates and how to proceed. Implemented at `src/schedule/gatePolicy.ts`.
- `onGate: "skip"` — the gate auto-approves. **Only** legal when the flow
  contains no `shell` node, because auto-approving a gate in front of a command
  is exactly the thing gates exist to prevent. The validator enforces this.

Scheduling a flow that contains gates raises an editor warning, not an error.

### 4.4 Catch-up

If a scheduled time passed while the app was closed:

- overdue by **less than 12 hours** → run once on activation.
- overdue by more → record `missed` and wait for the next slot. Firing a week of
  missed nightly runs at once on Monday morning is worse than skipping them.

Only ever one catch-up run, never a backlog.

### 4.5 Safety rules

- **One run per flow at a time.** If a run is in flight when the timer fires,
  record `skipped-overlapping`.
- **No permission bypass.** A scheduled run uses the same executors, the same
  shell allowlist, and the same trust level as a manual run.
- **A disabled or invalid flow never fires.** The scheduler validates before
  running, and records the validation error rather than throwing.

## 5. Design — dashboard

A full-screen panel (`contributions.panels`, `location: "fullscreen"`), gutter
icon `monitoring`, reading every `.flow-runs/*.json` in the workspace.

Note for implementation: `findFiles` uses the glob's literal prefix as its scan
root and skips hidden directories, so the pattern must be `.flow-runs/*.json` —
a leading `**/` finds nothing. This cost a debugging cycle once already.

### 5.1 Metrics

| Metric | How it is derived | Honest? |
| --- | --- | --- |
| Runs, and pass/fail rate | count of run records by `status` | measured |
| **Agent time** | Σ (`finishedAt − startedAt`) over agent, fan-out, skill and slash-command nodes | measured |
| **Human time** | Σ (`finishedAt − startedAt`) over `human-gate` nodes | measured — this is literally how long people blocked the pipeline |
| **Parallel compression** | Σ sub-agent time ÷ fan-out wall-clock | measured; a fan-out of 4 showing 3.6× is the story worth telling |
| Tokens and cost | Σ `usage` across nodes | **blocked** — see §8 |

### 5.2 The metric we will not fake

"Human hours saved" cannot be derived from a run record. The flow file may carry
an optional, explicitly user-owned baseline:

```jsonc
{ "manualBaselineMinutes": 90 }
```

Where present, the dashboard shows *"saved ≈ 90m − 4m human time = 86m"* and
labels it an estimate based on the author's own figure. Where absent, the metric
is not shown at all. No invented multipliers.

### 5.3 Degrading honestly

Until §8 is fixed, the token panel reads **"Token usage not recorded — see
docs"** rather than a confident `0`. A dashboard that reports zero cost for a
run that spent real money is worse than one that admits it does not know.

## 6. Components

Each unit is separately testable and small enough to hold in context:

| File | Purpose | Depends on |
| --- | --- | --- |
| `src/schedule/types.ts` | `FlowSchedule`, `ScheduleState` | — |
| `src/schedule/nextRun.ts` | pure: schedule + now → next fire time; catch-up decision | types |
| `src/schedule/scheduleState.ts` | read/write `.flow-runs/schedule-state.json` | host filesystem |
| `src/schedule/FlowScheduler.ts` | timer driver; discovery, in-flight lock, firing | the three above, `runFlow` |
| `src/dashboard/metrics.ts` | pure: run records → aggregated metrics | run types |
| `src/dashboard/DashboardPanel.tsx` | rendering only | metrics |
| `src/schema/*` | `schedule` + `manualBaselineMinutes` validation | — |

The scheduler never renders and the panel never schedules. `nextRun.ts` and
`metrics.ts` hold all the logic worth arguing about and neither touches I/O.

## 7. Testing

- **Pure, exhaustive:** `nextRun` across daily/weekly/interval, midnight
  rollover, DST transitions, and each catch-up boundary. `metrics` over
  fixtures including an in-flight run, a failed run, and a fan-out.
- **Integration:** scheduler fires on a fake clock; honours the in-flight lock;
  refuses an invalid flow; `onGate: "skip"` rejected when a shell node exists.
- **E2E:** panel renders from fixture run records; token section shows the
  unavailable state; a schedule set in the editor round-trips to the file.

Following the project's TDD rule, each of these is written before its code.

## 8. Prerequisite: token usage is null

Verified 2026-08-09 on a 10-node run: every run reports
`usage {inputTokens: 0, outputTokens: 0}`.

`NimbalystSessionHost.getTokenUsage` is correct — `sessions:get` takes a
positional string (`SessionHandlers.ts:472`) and it passes one. The session
returns with the right title and provider, but `tokenUsage` is **null** for
sessions created through `extensions:ai-send-prompt`.

**Settled during implementation: this is app-wide, not a flows gap.** Both
candidate fixes are moot. Measured by running the app's own
`ai:createSession` + `ai:sendMessage` alongside `extensions:ai-send-prompt` in
one session: both replied, both recorded `tokenUsage: null`. Nothing in the
extension can fix that, so the dashboard reports `—` rather than `0`, and the
ROI figure comes from an author-supplied `manualBaselineMinutes` instead
(§5.2), which shipped.

Also outstanding: a run records only top-level `sessionIds`; fan-out sub-agent
sessions are missing, so the dashboard cannot link to them.

## 9. Phasing

1. **Schedules** — §4 end to end. Delivers value alone.
2. **Dashboard, time metrics only** — §5 minus tokens. Delivers the
   human-vs-agent comparison, which is the headline ask.
3. **Tokens** — after §8 is fixed.

## 10. Out of scope

Running with the app closed (§3 option B); notifications beyond the host's
existing mechanism; scheduling from the CLI; per-node cost attribution;
exporting the dashboard.
