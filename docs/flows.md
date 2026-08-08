# Flows

A flow is a DAG of steps you build on a canvas and run — each step is one unit of
work handed to an agent, the shell, or a person. Flows live in `*.flow.json`,
open in the Flow Editor, and can also run headlessly.

- Schema and validator: `packages/extensions/flows/src/schema/`
- Security model: [flows-security.md](./flows-security.md)
- Host integration notes: [editorhost-notes.md](./editorhost-notes.md)

## Getting started

Create a flow from **New → Flow**, or write a `*.flow.json` by hand. The editor
claims that suffix — Monaco keeps every other `.json`, because the host matches
the longest registered suffix.

On the canvas: the toolbar adds a node per type, drag between the round handles
to connect, Backspace deletes, and every node's fields are editable in place.
**Run** executes what is on the canvas; gates pause for approval; the panel
underneath reports each node's status, tokens, cost and session.

## Starting a flow

An empty `*.flow.json` opens on a gallery of starter templates rather than a
blank grid — plan → implement → review, investigate → fix → verify, two reviews
in parallel, release notes from the git log, or a single agent to grow from.

Every template is wired and valid on arrival: it only references inputs that are
genuinely upstream, it carries its own variables, every node is positioned, and
any template that runs a command puts a human gate before it. Those are enforced
by tests, not convention — a template can never be the reason a command ran
unreviewed.

## Choosing, not typing

Skill and slash-command nodes pick from what your workspace actually has. The
list is searchable — matching on name *and* description, so a half-remembered
skill is still findable — and each option shows where it came from
(`project` / `user` / `plugin`). Agent nodes pick a model from the ones you have
enabled and toggle tools rather than typing an array; no tools selected means
*host default*, which is not the same as "no tools".

Two discovery sources are merged, project first:

- the host's own scan (`slash-command:list`), which covers user and plugin entries;
- a direct scan of this workspace's `.claude/skills`, `.agents/skills` and
  `.claude/commands`. The host only scans those when
  `workspaceClaudeCompatibilityEnabled` is on and it defaults to off, so without
  this a repo's own skills would be missing from the picker.

Every picker keeps a **custom** toggle: a flow may be authored before the skill
it targets exists, or shared across machines.

## Working on the canvas

- **Duplicate** a node from its header. The copy keeps the prompt and settings
  but gets a new id and drops the output port — two nodes publishing the same
  port name would be ambiguous.
- **Drag from a handle onto empty canvas** to create the next node already
  connected.
- **Undo / redo** with Cmd+Z and Cmd+Shift+Z, or the toolbar buttons. This is
  canvas history — the host's document history covers what was saved, this
  covers what is on screen, which is where a mis-drag or accidental delete hurts.
- **Runs** in the toolbar lists this flow's past runs from `.flow-runs/` with
  status, duration, tokens and cost.
- **Variables** are edited from the toolbar, not source mode. Renaming one
  rewrites every `{{…}}` that used it; renaming without that would break prompts
  silently and only fail at run time.

## Schema reference

```jsonc
{
  "version": 1,                       // always 1
  "name": "review-pipeline",
  "nodes": [ /* see below */ ],
  "edges": [{ "from": "plan", "to": "implement", "port": "plan_md" }],
  "variables": { "target": "the login endpoint" }
}
```

Every node carries:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique. Referenced by edges and by `{{id.port}}`. |
| `type` | yes | One of the five below. |
| `label` | no | Display name; falls back to `id`. |
| `output` | no | Names this node's result so downstream nodes can read it. |
| `position` | no | Canvas coordinates. Absent in hand-authored files; the editor lays those out and writes them back. |

### Node types

| Type | Required field | Also accepts | Does |
| --- | --- | --- | --- |
| `agent` | `prompt` | `model`, `tools`, `worktree` | Runs the prompt as a Nimbalyst session. |
| `slash-command` | `command` (must start with `/`) | `args` | Sends `/command args` to the agent. |
| `skill` | `skill` | `input` | Asks the agent to use a named skill. |
| `shell` | `run` | `cwd` | Runs one allowlisted command. Named `run`, not `command`, so `command` always means a slash command. |
| `fan-out` | `prompt`, `over` | `concurrency`, `model`, `tools` | Runs the prompt once per item as concurrent sub-agents. Each sub-agent sees its item as `{{item}}`. |
| `human-gate` | `message` | — | Holds the branch until a person approves. Rejecting fails the node. |

### Edges and ports

An edge carries control from one node to another. Add `port` to also carry data:
the `port` must equal the `output` the source node declares.

```jsonc
{ "id": "plan", "type": "agent", "prompt": "Plan it", "output": "plan_md" }
{ "from": "plan", "to": "implement", "port": "plan_md" }
```

Downstream, `{{plan.plan_md}}` in any text field resolves to that output.
`{{name}}` resolves from `variables`. An unresolvable reference fails the run
**before any node executes**, so a typo cannot surface after tokens are spent.

## What the validator rejects

Wrong `version`; empty `name`; duplicate or empty node ids; unknown node types;
a missing per-type required field; a slash command without `/`; dangling edges;
self-edges; a `port` the source doesn't declare; cycles (reported as the path
that closes them, e.g. `a -> b -> c -> a`); and credential-shaped strings
(see [flows-security.md](./flows-security.md)).

Errors accumulate — you get every problem at once, not one per save. The editor
refuses to save or run a flow that would not reopen.

## Fanning out over a list

A `fan-out` node spreads one prompt across many sub-agents:

```jsonc
{
  "id": "review", "type": "fan-out",
  "prompt": "Review {{item}} for bugs",
  "over": "{{files.list}}",   // one item per line, usually an upstream output
  "concurrency": 4,           // sub-agents in flight at once
  "output": "reviews"         // every result, joined under a heading per item
}
```

How many sub-agents run is decided **at run time** by whatever `over` resolves
to, so a flow can fan out over files, tickets or packages it could not have
known about when it was written. `{{item}}` is a real input inside a fan-out and
nowhere else.

While it runs the node lists every sub-agent by name with its own state —
queued, running, done, failed — so five sub-agents at a concurrency of three
visibly show three in flight and two waiting. A failure names only the
sub-agents that failed and how many of how many, and the node fails so
downstream work is skipped.

## How a run behaves

- A node starts as soon as **its own** dependencies finish, not in lockstep
  levels, so a short branch never waits on a long one. Concurrency defaults to 4.
- A failed node marks everything downstream `skipped`; unrelated branches run to
  completion. The run ends `failed`.
- Every run writes `.flow-runs/<run-id>.json` — status, per-node output, session
  ids, timings, usage, and the run total — rewritten on every transition, so an
  interrupted run still leaves a usable record.

## Headless

```bash
nimbalyst-flows validate review.flow.json
nimbalyst-flows run checks.flow.json --var target=src/ --approve-gates
nimbalyst-flows compile review.flow.json          # -> .claude/commands/flow-review.md
```

Exit codes: `0` success, `1` the flow failed, `2` bad usage or an invalid flow.

Two deliberate limits: gates fail unless `--approve-gates` is passed, and
**agent nodes do not run headlessly** — use `compile`, which emits a slash
command your own authenticated Claude Code CLI runs. Both are explained in
[flows-security.md](./flows-security.md).

## Adding a node type

1. Add the variant to `NodeType` and the node union in `src/schema/types.ts`.
2. Add its required/optional fields to `NODE_SHAPES` in `src/schema/validate.ts`,
   and its text fields to `TEXT_FIELDS` in `src/runner/dagExecutor.ts` so `{{…}}`
   references get resolved in them.
3. Add its canvas chrome to `CHROME` in `src/editor/nodes/nodeTypes.tsx` — icon,
   primary field, whether that field is multi-line.
4. Write its executor in `src/runner/executors.ts` against a **port**, not a
   concrete client, so it stays testable with a fake.
5. Teach `instructionFor` in `src/headless/compileCommand.ts` how to phrase it.
6. Tests for each: schema, executor, and a compiler case.

## Known limits

| Limit | Why |
| --- | --- |
| `worktree: true` fails instead of isolating | `sendPrompt` takes no worktree; flows refuse rather than silently run in the main tree. |
| `tools: [...]` fails instead of restricting | Same call takes no tool allowlist. |
| Clicking a node does not open its session | No SDK method, IPC channel, or deep-link route can open a session from an extension. The run panel shows session ids as selectable text instead. |
| Agent nodes are app-only | The extension runs no agent of its own; see `editorhost-notes.md` §5b. |

Each has a documented route to fix it in `editorhost-notes.md`; all of them need
a small host change rather than an extension workaround.

## Tests

| Suite | Command | Covers |
| --- | --- | --- |
| Unit + integration | `npx vitest run packages/extensions/flows` | Schema, validator, credential scanning, DAG executor, interpolation, executors, run store, host adapters, backend module, headless CLI. Runs in the repo's root vitest projects too. |
| E2E | `cd packages/extensions/flows && npm run test:e2e` | The built app: opening `*.flow.json` on the canvas, editing through to the file, refusing an invalid save, running a flow through its gates, and the run panel. |

The E2E specs launch the built Electron app themselves, so they need
`cd packages/electron && npm run build` first — but no dev server and no human,
which is what lets them run unattended. They are serial by design: concurrent
Electron instances fight over the single-instance lock and the database.
