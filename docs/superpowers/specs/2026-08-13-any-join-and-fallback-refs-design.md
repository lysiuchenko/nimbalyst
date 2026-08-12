# Branches that rejoin — `join: "any"` and fallback references

**Date:** 2026-08-13
**Status:** design
**Scope:** `packages/extensions/flows` only.

## The problem, hit while building a real flow

Conditional edges made forks possible; nothing makes branches meet again. The
natural bug-fix shape —

```
fix → test ──success──→ review
        └──failure──→ repair ──→ review
```

— cannot exist today. Every node is an AND-join: `review` waits for **both**
incoming edges, exactly one branch of a conditional fork is always dead, so the
join is skipped on every run. The bugfix demo had to be designed *around* this
(verification repairs inside a single agent leg). One workaround is judgment;
every author rediscovering the wall is a product defect. Conditional edges are
half a feature until this lands.

## Piece 1 — `"join": "any"` on a node

```jsonc
{ "id": "review", "type": "fan-out", "join": "any", ... }
```

- **Default `all`** (absent): today's AND-join, byte-for-byte unchanged
  semantics for every existing flow.
- **`any`**: the node becomes ready the moment its **first** live incoming edge
  fires. It runs **once** — later-completing parents do not re-run it. It is
  skipped only when **every** incoming edge is dead.

Runtime accounting in the executor, per child: alongside the pending count,
track the number of incoming edges not yet dead. A dead edge (condition
mismatch, or a skipped parent) decrements it; at zero with the node still
queued, skip. For `any`, a matching parent completion dispatches immediately if
still queued; for `all`, the existing pending-reaches-zero rule stands.

Validation: `join` must be `all` or `any`; `any` with fewer than two incoming
edges is legal but pointless, so it draws a validator *error* only for unknown
values — the editor's per-node issues can nudge about the pointless case later.

## Piece 2 — fallback references: `{{test.out ?? repair.out}}`

A rejoined node's input comes from *whichever* branch ran — but an unresolved
`{{ref}}` throws at resolve time, so `review` could not mention either parent's
output without dying on the branch that did not run.

`??` chains resolve left to right; the first arm whose value exists wins. A
literal arm is allowed as the final fallback: `{{a.x ?? "nothing to report"}}`.

- **Preflight**: a chain passes if *any* arm could resolve (per the static
  scope); a chain none of whose arms can ever resolve stays an error.
- **Runtime**: first arm present in the outputs map wins; if none is present
  and there is no literal, the existing unresolved-reference error fires with
  the whole chain named.
- The editor's reference checker treats an arm as satisfied by the same
  ancestor rule as today; `{{gate.error}}`-style implicit ports participate.

## Canvas

A node with `join: "any"` wears a small `any` badge beside its status, and the
Advanced section gets the toggle. No new colour; joins are structure, not type.

## Tests

Schema: accepted values, rejection, default absence. Executor: the four-way
matrix (fork taken left/right × join any/all), once-only dispatch when both
parents complete live (non-conditional diamond with `any`), skip only when all
edges dead, seeded-resume interaction (a seeded parent releases an `any` join).
Interpolation: chain resolution order, literal fallback, all-arms-dead error,
preflight acceptance. E2E, CI-covered: the exact test→repair→rejoin shape that
motivated this, run both ways — success path reviews the test output, failure
path reviews the repair output, same review node.

## Out of scope

`join: "k-of-n"`, expression conditions (`when:`), and loops. **Amended:** the
bugfix demo keeps its single self-repairing verification agent — with real
agents that shape is *better* (the repairer holds the failing context), and the
rejoin belongs where branches produce different artifacts. The e2e proves the
shape directly instead.
