# Three goals: retries, `when:` edges, sub-agent output

**Date:** 2026-08-13
**Status:** design
**Scope:** `packages/extensions/flows` only. Implemented in this order; each
lands as its own commit with its own proof.

## 1 — `retries` on a node

`"retries": 2` = up to two *additional* attempts after a failure; three total.
The run detail must show what success cost — `attempts: 3` and each failed
attempt's error survive on the execution — so retries never launder
instability into a clean-looking record. Failure edges and the `failed` flag
fire only after the last attempt. A cancelled run stops retrying immediately.

Bounds: an integer 1–5. **Refused on `human-gate`** — a rejected gate is a
person's decision, and re-asking until they crack is not a retry policy.

Editor: a numeric field under Advanced, a `retries ×2` badge, and the run
detail line gains "took N attempts" where N > 1. No e2e: there is no honest
deterministic "transient" failure in the harness; the executor matrix carries
the proof.

## 2 — `when:` conditions on edges

```jsonc
{ "from": "report", "to": "publish", "when": "{{report.verdict}} contains \"APPROVE\"" }
```

Deliberately tiny grammar, parsed strictly:
`{{from.port}} (contains | == | !=) "literal"` — and nothing else. No chains,
no numeric comparison, no boolean operators; an expression language inside a
flow file is how flows stop being reviewable.

Rules:
- The reference **must name the edge's own `from` node** — a condition on an
  edge is about the step it leaves. Validator enforces it.
- Evaluation happens when `from` completes, against its published ports plus
  the implicit `error`. `on` still selects the outcome (`when` + `on:
  "failure"` composes: "failed AND the error mentions X").
- A false — or unresolvable — condition makes the edge **dead**, feeding the
  same kill/join machinery the fork work built. This is why `when` lands after
  `join: any` and not before: unmatched routes need somewhere to die and
  branches need a way to meet again.

Editor: the condition renders as the edge's label and round-trips through the
canvas. Authoring stays file-side this round; the canvas shows and preserves.

## 3 — sub-agent output

The last blind surface: fan-out children report status dots only, though the
executor holds every result. `ChildProgress.output` gains a **capped preview**
(400 chars) — bounded on purpose, because children are stored in the run
record and the full text already lives in the child's session. The sub-agent
card gets a clamped preview line; the run detail lists each child's preview
under its fan-out step.

## Proof

Executor matrices for 1 and 2 (retry success/exhaustion/abort; condition
true/false/unresolvable × on success/failure), validator rejection lists, and
CI e2e for 2 (verdict routes both ways, driven by a flow variable) and 3
(seeded children render previews). Full suite + CI green before each push.
