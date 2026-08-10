# Flows — a five-minute introduction for the team

Flows turn a repeatable piece of work into a diagram you can run: a DAG of steps
handed to an agent, the shell, or a person. They live in `*.flow.json`, open on a
canvas, and can run on a schedule or from a terminal.

Full reference: [flows.md](./flows.md). Security model: [flows-security.md](./flows-security.md).

## 1. Build a pipeline on a canvas, not in JSON

**Start:** *New → Flow*, or open any `*.flow.json`. An empty one offers starter
templates — plan → implement → review, investigate → fix → verify, two reviews in
parallel, release notes from the git log — all wired and valid on arrival.

Six step types: `agent`, `fan-out`, `skill`, `slash-command`, `shell`,
`human-gate`. A closed step reads as a sentence — *"Waits for a person: Does this
plan look right?"* — so the canvas can be read by someone who did not write it.
Open one with the chevron to edit; model, tools and isolation sit behind
**Advanced** because most steps never need them.

Skills and slash commands are **picked from what your repo actually has**, not
typed. Variables, undo/redo and duplicate are on the toolbar.

## 2. Run many agents at once, each in its own checkout

A `fan-out` step spreads one prompt across a list — files, tickets, packages —
resolved *at run time*, so the width is whatever the upstream step produced.

Tick **"Give each sub-agent its own worktree"** and every sub-agent gets a
separate git checkout and branch. Four reviewers can edit four files
simultaneously without touching each other's work or your main tree, and each
branch is reviewable as its own diff.

While it runs, each sub-agent appears as its own card on the canvas with a live
connector, and clicking a card opens the session that did the work.

## 3. Let it run without you

Set a schedule from the toolbar — daily, certain days, or every N minutes. No
cron strings.

- **App open:** everything runs, agent steps included.
- **App closed:** `nimbalyst-flows schedule install --every 30` registers the
  scheduler with your OS (launchd, systemd timers, or Task Scheduler). Steps that
  need an agent are *reported*, not attempted — `schedule list` marks them
  *(needs the app)* before they come due, so you learn now rather than at 2am.

`--print` shows exactly which files and commands an install would use, without
touching anything.

## 4. See where the time actually goes

The **Flows** button in the gutter opens a dashboard over every run in the
workspace:

- **Agent time** — what the machines did.
- **Human time** — how long people spent at approval gates. Measured, not guessed.
- **Sub-agents** — how much was done in parallel.
- **Time saved** — only if a flow states `manualBaselineMinutes` ("minutes this
  takes by hand", in the Variables panel). It is labelled an estimate and uses
  *your* number; without one, the figure is not shown at all.

Token spend reads `—` rather than `0`: the host records no usage on any session
path, and claiming a run was free would be worse than admitting we don't know.

## 5. Run one from a terminal

```
nimbalyst-flows run <flow> [--var name=value]   run it here
nimbalyst-flows validate <flow>                 check it without running
nimbalyst-flows compile <flow>                  emit a /slash-command
```

Shell and gate flows run headlessly. Agent flows are refused with a pointer to
`compile`, which emits a Claude Code slash command your own CLI login runs — the
supported path for agent work outside the app.

Gates **fail** in a terminal unless you pass `--approve-gates`, so a checkpoint
never silently becomes a no-op in CI.

## What to know before you rely on it

- **A step's `tools:` list is enforced; a `worktree:` request is honoured.** If
  either cannot be delivered the step **fails** rather than running with more
  access than asked for.
- **Shell steps are allowlisted** (`npm npx node git echo ls pwd cat`), run with
  no shell, and cannot escape the workspace.
- **Flow files must carry no secrets** — the validator rejects credential-shaped
  strings. Use `${env:NAME}`.
- **`.flow-runs/` holds step outputs.** It is gitignored by default; treat it
  like build output.
- Scheduling with the app closed is verified on macOS and Linux. The Windows
  path is unit-tested but has not been watched to fire.
