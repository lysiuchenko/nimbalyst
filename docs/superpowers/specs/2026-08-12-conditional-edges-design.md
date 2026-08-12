# Conditional edges — "if this step fails, do that instead"

**Date:** 2026-08-12
**Status:** design
**Scope:** `packages/extensions/flows` only.

## The problem

A flow is a DAG with no `if`. Real pipelines need "if the tests fail, fix
them", "if the reviewer rejects, apply the feedback" — and today the only
answer is a shell node and hope. This is the last big expressiveness gap from
the app-level audit (§3.3).

## The design

One optional field on an edge:

```jsonc
{ "from": "test", "to": "fix",   "on": "failure" }
{ "from": "test", "to": "ship" }                    // absent = "success", today's meaning
```

### Runtime semantics (AND-join preserved)

- A node completes with an **outcome**: `done` or `failed`. Each outgoing edge
  either *matches* the outcome (`success`+done, `failure`+failed) or is *dead*.
- A matching edge releases its child as today. A dead edge makes the child
  unreachable: it is skipped, and — since a skipped node can neither succeed
  nor fail — every edge out of it is dead too, cascading.
- A failure with at least one outgoing `failure` edge is **handled**: it does
  not, by itself, fail the run. The node still records `failed` (honest); the
  run can end `done`. An unhandled failure — including a failure handler that
  itself fails with no handler — fails the run as today.
- A failed node publishes its error message as the implicit port `error`, so a
  handler can read `{{test.error}}`. Preflight treats `error` as a port every
  node has.

A rejected human gate is a failure, so `on: "failure"` off a gate means
"if rejected" — approval routing with no new node type.

### Rules

- `on` must be `success` or `failure`; anything else is a validation error.
- `port` on a failure edge is contradictory — the failed node published no
  output — and is rejected outright rather than silently ignored.
- Cycle detection is unchanged: conditional edges are still edges of the DAG.
- **Resume interaction:** none needed. A failed node is never reused, so its
  failure-edge children re-run with it — the cascade rule already covers it.

### Canvas

Failure edges render dashed in the danger colour with an "on failure" label.
Double-clicking an edge toggles its kind and dirties the document. The kind
round-trips through `flowToGraph`/`graphToFlow` via the canvas edge's `data`.

### Compiled slash commands

A node reachable only through failure edges compiles with the prefix
"**Only if the step above failed:**" — the CLI running the compiled prompt has
no runtime, so the condition becomes an instruction.

## Tests

Schema: accepted, rejected values, failure+port rejected, round-trip.
Executor: handler fires on failure; handler skipped on success; handled failure
ends the run `done`; unhandled and handler-failure end it `failed`;
`{{x.error}}` interpolates; skip cascades through dead edges at a join.
Round-trip: `on` survives the canvas. Compile: the prefix. E2E, on disk: a
rejected gate routes to a `write-file` apology — apology file exists,
success-path file does not, run reads Done.

## Out of scope

`on: "always"` (cleanup steps), retry counts on nodes, expression conditions
(`when: {{x.out}} == "y"`), and more than one edge per node pair.
