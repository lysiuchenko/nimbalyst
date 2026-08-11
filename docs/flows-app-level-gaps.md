# What is missing at the app level

> **Status, 2026-08-10.** Items **1.1**, **2.1**, **2.2** and **2.3** have since
> shipped — see the "Fixed" notes inline and
> `docs/superpowers/specs/2026-08-10-flows-home-design.md`. The rest stands.

Written after driving the **built** app (not the dev server) with Playwright and
photographing every flows surface a new user can reach. Each finding below cites
either a screenshot I took or a file and line. Nothing here is inferred from
reading code alone.

## The diagnosis in one sentence

Flows is a **file type**, not a **feature of the app**: everything it can do
requires you to already have a `.flow.json` open in a tab, and the one screen in
the whole product that says "Flows" on it is a read-only report.

That is the whole "raw" feeling. It is not polish. Polish would be rounded
corners; this is that the product has no front door.

---

## Tier 1 — the missing screen

### 1.1 There is no Flows home

`src/dashboard/FlowsDashboard.tsx` is 122 lines and contains **zero**
occurrences of `button`, `onClick`, or `schedule`. Verified:

```
$ grep -c "" src/dashboard/FlowsDashboard.tsx
122
$ grep -n "schedule\|Schedule\|nextRun\|button\|onClick" src/dashboard/FlowsDashboard.tsx
(no output)
```

So the fullscreen panel branded **Flows** — the only place in the app with that
name on it — can do nothing but display numbers. You cannot run a flow from it,
open one, drill into a run, or see what is scheduled. It also lists only flows
that have **already run**: `summariseRuns` builds `byFlow` from run records
(`metrics.ts:70`), so a flow you wrote this morning and have not run does not
exist as far as this screen is concerned.

On an empty workspace it is a black void with one sentence in the top-left
corner. That is the first thing a teammate clicking "Flows" will ever see.

**What a Flows home needs to be:** every flow in the workspace as a row — last
run, outcome, next scheduled run, average duration — each row runnable and
openable, plus a "new flow from template" affordance. The templates already
exist (`FLOW_TEMPLATES`, `templates.ts:30`) but are reachable *only from inside
an already-created flow file* (`FlowEditor.tsx:1046`), which is exactly
backwards.

> **Fixed.** The panel now lists every `*.flow.json`, whether or not it has run,
> with its schedule, last outcome and how long ago; rows open their flow; and
> the empty state says where a flow comes from. Running a flow *from* the panel
> is still open, as is surfacing the templates outside the editor.

### 1.2 A flow can only be run from its own open tab

The manifest contributes `customEditors`, `fileIcons`, `newFileMenu`,
`backendModules`, `panels` — and **no `commands` and no `keybindings`**
(`manifest.json`). Consequence: there is no command-palette entry, no keyboard
shortcut, no run-from-the-file-tree, no menu item. The host supports command
contributions (`extension-sdk/src/types/extension.ts:342`); flows simply does
not claim them.

An automation you can only trigger by opening its source file is not an
automation.

---

## Tier 2 — the dead ends that destroy trust

### 2.1 A schema mistake is a brick wall, one error at a time

I hand-wrote a three-node flow, with the source open in front of me, and hit
this:

> **This flow could not be opened.**
> `nodes[0].run: shell node requires a non-empty run`

I fixed it and immediately hit the next one:

> **This flow could not be opened.**
> `nodes[2].message: human-gate node requires a non-empty message`

Two things are wrong here, and the second is self-inflicted:

1. **The editor throws away errors the validator deliberately collected.**
   `validateFlow` documents its own intent at `validate.ts:60-61` — *"Every
   problem is reported, not just the first, so the editor can show a complete
   list rather than making the user fix errors one save at a time."* Then
   `FlowEditor.tsx:175-177` does:

   ```ts
   const [first] = parsed.errors;
   throw new Error(first.path ? `${first.path}: ${first.message}` : first.message);
   ```

   The one consumer that the design note was written for takes `errors[0]` and
   discards the rest. Whack-a-mole is the direct result.

2. **There is no way out of the error screen.** No canvas, no text editor, no
   "fix this for me". The manifest declares `"supportsSourceMode": true`, but on
   a parse failure `FlowEditor.tsx:478-488` returns its own error `<div>` and
   the source-mode escape hatch never gets a chance. The file is in front of
   you and you cannot touch it.

The stated audience includes business analysts. `nodes[2].message` is not a
sentence for them, and there is no repair path for anyone.

> **Fixed.** Every problem is listed at once, each with the path to fix, and an
> **Edit as text** button drops into source mode. The wording of an individual
> message is still the validator's, so the business-analyst half of that point
> stands.

### 2.2 Rename a flow and its history vanishes

Run records are matched to a flow by **exact string equality on the path**:

- editor: `.filter((record) => record.flowPath === flowPath)` (`runHistory.ts:52`)
- dashboard: `byFlow.get(record.flowPath)` (`metrics.ts:70`, `:108`)

So renaming or moving a `.flow.json` silently zeroes its history in the editor
and splits it into two unrelated rows on the dashboard. Nothing warns you and
nothing offers to reattach.

I hit the same failure mode live from the other direction — the editor showing
**"This flow has not run yet"** while `.flow-runs/` was visibly populated in the
file tree beside it and the dashboard counted the runs. Two surfaces of the same
data disagreeing on screen at the same moment is the fastest way to lose a
viewer's confidence.

> **Half fixed.** The panel now joins on a workspace-relative path, so a flow
> run from the editor (absolute) and from the headless CLI (relative) is one row
> rather than two — a split that was reachable without renaming anything.
> Reattaching a genuinely *renamed* flow to its history is still open; its runs
> now show as an **Archived** row instead of vanishing.

### 2.3 The dashboard prints `NaNm`

A run record whose timestamps are not numbers renders **`NaNm`** in all three
headline metrics. `durationOf` (`metrics.ts:36-39`) guards `undefined` but
nothing else, and `Math.max(0, NaN)` is `NaN`, which propagates to the tiles
unchecked. I have the screenshot.

`.flow-runs/` is plain JSON in the repo, and the team doc invites people to look
at it, so hand-edited, half-written, or older-format records are reachable in
normal use. A dashboard that says `NaN` about your own work is worse than one
that says nothing.

> **Fixed.** `asDuration` and `durationOf` both guard on `Number.isFinite`, so a
> record like that degrades to `—` and no longer poisons the totals it is added
> to. The test asserts the exact string that shipped: `expected 'NaNm' to be
> '—'`.

---

## Tier 3 — capability that is genuinely absent

These are not defects; they are things the product cannot do at all.

### 3.1 A flow produces no artifact

The six node types are `agent`, `fan-out`, `slash-command`, `skill`, `shell`,
`human-gate` (`schema/types.ts:11-18`). None of them **puts a result anywhere**.
A flow runs, and its output lives in a JSON run record under `.flow-runs/`.
There is no "write this to `RELEASE_NOTES.md`", no "open a PR", no "post it".
The ROI story ends in a file nobody opens. One `write-file` node type would
close it.

> **Fixed.** A `write-file` node writes into the workspace, resolving `{{…}}`
> references in both its path and its content, guarded by `safeWorkspacePath`
> (absolute paths, `..` escapes, post-normalisation escapes and `.git` all
> refused — `docs/flows-security.md` §3b). The release-notes template now ends
> by saving `RELEASE_NOTES.md`, after the approval gate. Opening a PR and
> posting elsewhere remain open.

### 3.2 Fan-out builds worktrees nobody can review

Per-sub-agent worktree isolation shipped, and it works — each sub-agent gets its
own branch. But `worktree` appears in the editor UI only as a checkbox
(`nodes/nodeTypes.tsx:331-336`). After a fan-out of four, you have four branches
containing the actual work and **no surface in the app that shows them, diffs
them, merges them, or cleans them up**. The most impressive thing the runner
does is currently invisible the moment it finishes.

### 3.3 Every flow is unconditional

A DAG with no `if`. There is no conditional edge, no retry, no "if the tests
fail, do this instead". Every real pipeline needs branching within its first
week of use, and today the answer is to write a `shell` node and hope.

### 3.4 A run has no trace view

A run is one row in a table that expands to a list of node statuses. There is no
timeline, no per-node output side by side, no way to compare this run to the
last one. For a product whose pitch is "see what the agents did", the seeing is
the weakest part.

---

## What is actually fine

Stated so the list above is not read as "everything is bad":

- The canvas itself renders correctly, nodes carry a readable one-line summary
  of what they will do, and sub-agent cards animate in during a fan-out.
- Creating a flow **does** work from the New File menu — the manifest
  contributes it (`manifest.json`, `newFileMenu`), and I was wrong when I first
  assumed it did not.
- Gates and failures already reach the user through the host's own
  notifications, not just the canvas (`useFlowRun.ts:73-76`).
- Scheduling, worktree isolation, the security model, and the headless CLI are
  real and tested.

The engine is in better shape than the product around it. That is precisely why
it reads as raw: there is a lot of working machinery and almost no surface.

---

## Recommendation

**1.1** shipped: the panel is a Flows home that lists every flow with its
schedule and last outcome, and each row opens its flow. **2.1**, **2.2** and
**2.3** shipped alongside it. A visual pass shipped too, which was not on this
list: each step type now carries a colour on the canvas, in the add-step
toolbar and in the minimap, so a twelve-step flow is scannable rather than six
identical grey cards.

What is left, in order:

1. **1.2 — command contributions**, so a flow can be launched from the palette
   or the file tree rather than only from its own open tab. The other half of
   turning flows from a file type into a feature of the app.
2. **Run a flow from the Flows home.** The rows are there; the button is not.
3. **3.1 — an artifact node**, because it is what makes a demo end with
   something in your hand rather than a green tick.
4. **3.2 — a worktree review surface.** Fan-out's isolated branches are still
   invisible the moment a run finishes.
