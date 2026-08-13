# Flow library — proven flows, one click from the Flows home

**Date:** 2026-08-14
**Status:** design
**Scope:** `packages/extensions/flows` only. Goal E of the roadmap.

## The problem

The empty-canvas templates seed a new flow; the *proven* flows — the PR
review, the bug-fix cycle — live only in whichever workspace they were
authored in. A new workspace starts from scratch or from copy-paste.

## What ships

A **Library** section on the Flows home: curated, complete flows compiled
into the extension (no network, no supply-chain surface), each card naming
what the flow does and what it needs (`skill: review-report`, the Codex
CLI). **Add to workspace** writes `<id>.flow.json` — suffixed `-2`, `-3`
when the name is taken — and opens it in the editor.

Entries: PR review (fan-out + security pass + gated publish), Bug fix full
cycle (triage → fix → verify → review → gate), Release notes, Codex
handshake (per-step provider demo), Docs watcher (file-change trigger
demo). Every entry must pass `validateFlow` — enforced by a unit test that
loops the catalog, so an invalid library flow cannot compile into a
release.

## Pieces

| File | Change |
| --- | --- |
| `src/library/catalog.ts` | `LIBRARY_FLOWS` + `uniqueFlowFileName` |
| `src/dashboard/FlowsDashboard.tsx` | Library toggle in the header; cards; add-and-open |
| `src/styles.css` | `.flows-library*` |

## Proof

Unit: every catalog entry validates; ids unique; filename collision walks
`-2`, `-3`. E2E: a workspace already holding `pr-review.flow.json` adds the
library's PR review → editor opens on `pr-review-2.flow.json`, file on
disk, both listed on the home.

## Out of scope

Remote/community libraries, exporting a workspace flow into the library,
and per-entry preview rendering (the card describes; the editor shows).
