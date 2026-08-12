# Flows dashboard hardening design

## Scope

Make the Flows home dashboard trustworthy across workspace changes, damaged data,
mixed path formats, and active or interrupted runs. Improve the at-a-glance UX
without changing core Nimbalyst code or exposing SDK access outside the existing
`FlowRunner` boundary.

## Files and interfaces

- `src/host/workspaceFiles.ts`
  - Add `createWorkspaceFiles(filesystem, workspacePath, ipc)`.
  - Route file discovery through `extensions:find-files` with the panel's explicit
    workspace path when Electron IPC is available. Retain the host filesystem as a
    non-Electron fallback and validate IPC responses at the boundary.
- `src/dashboard/flowPath.ts`
  - Add separator-independent workspace-relative display paths and canonical keys.
  - Treat Windows drive paths case-insensitively while preserving display casing.
- `src/dashboard/loadAllRuns.ts`
  - Return valid records plus invalid-record diagnostics.
  - Reject workspace scan failures so the dashboard can offer Retry; isolate a bad
    individual record so it cannot blank the whole dashboard.
- `src/dashboard/loadFlowFiles.ts`
  - Preserve invalid flows as rows with validation problems.
  - Resolve each enabled schedule's actual next due time from its persisted state.
  - Reject workspace scan failures while containing per-file read/parse failures.
- `src/dashboard/metrics.ts` and `src/dashboard/flowList.ts`
  - Aggregate on canonical paths before calculating metrics.
  - Represent invalid, failed, interrupted, running, cancelled, successful,
    never-run, and archived states without false-green fallbacks.
  - Calculate average agent time and put urgent/scheduled work before ordinary rows.
- `src/dashboard/asDuration.ts` and `src/dashboard/asNextRun.ts`
  - Fix rounded-minute rollover and provide concise, deterministic next-run copy.
- `src/dashboard/FlowsDashboard.tsx` and `styles.css`
  - Add explicit loading, initial-error, stale-data warning, invalid-data warning,
    manual refresh, background refresh, last-updated feedback, visible status text,
    next-run timing, and responsive container-query layouts.
- `tests/flowsData.spec.ts`
  - Exercise mixed paths, damaged flow/run files, status semantics, refresh, and
    dashboard recovery in the built Electron application.

## Behavioral contracts

1. Every scan is explicitly scoped to the currently rendered `workspacePath`.
2. Canonically equivalent absolute, relative, slash, and backslash paths produce
   one row and one metric total.
3. Invalid data is visible and actionable; infrastructure failures are errors with
   Retry, while a damaged individual file is skipped or marked without data loss.
4. Only a completed successful run is green. Failed, interrupted, running, and
   cancelled records retain distinct, text-labelled states.
5. Enabled schedules show the persisted next due time and rank ahead of comparable
   manual flows. Agent time is shown as a per-run average, not a misleading total.
6. The dashboard refreshes on demand, on focus, and periodically while visible;
   background failures preserve the last good snapshot and say that it is stale.
7. Compact layouts use container queries and remain keyboard and screen-reader
   operable. Status and errors are never communicated by color alone.

## Test matrix

- Unit: workspace IPC receives the exact active root; malformed IPC data rejects;
  non-Electron fallback still works.
- Unit: POSIX and Windows paths normalize correctly, prefix lookalikes stay outside,
  and Windows case variants share a key.
- Unit: absolute plus relative histories merge without overwriting counts or time.
- Unit: malformed run records are diagnosed, scan failures reject, and stale active
  records do not become successful.
- Unit: invalid flow JSON produces an invalid row and enabled schedule state yields
  the correct next due time.
- Unit: every run state maps to the intended row state; invalid overrides history;
  scheduled rows sort before equivalent manual rows.
- Unit: duration rounding never emits `60m`; next-run labels cover overdue, minutes,
  hours, and later dates.
- E2E: dashboard renders accurate merged metrics and visible health labels, exposes
  damaged files, refreshes after on-disk changes, and recovers from initial errors.

## Verification gate

Run focused dashboard tests first, then the full flows unit suite, package typecheck,
production extension build, and the focused built-Electron Playwright suite. Inspect
the resulting dashboard screenshot at desktop and compact widths before handoff.
