import type { FlowSchedule } from '../schedule/types';
import type { ValidationError } from '../schema/types';
import { flowPathKey, workspaceRelativeFlowPath } from './flowPath';
import type { FlowMetrics } from './metrics';

/** A `*.flow.json` found in the workspace, as far as the list needs it. */
export interface FlowFile {
  flowPath: string;
  flowName: string;
  /** Absent when the flow declares none, or when the file will not parse. */
  schedule: FlowSchedule | null;
  /** Resolved from machine-local schedule state so intervals do not drift. */
  nextRunAt: number | null;
  valid: boolean;
  problems: ValidationError[];
}

/**
 * Why a row looks the way it does.
 *
 * `archived` is a flow whose runs survive but whose file does not — deleting or
 * renaming a flow should not silently erase the record of what it did.
 */
export type FlowRowState =
  | 'invalid'
  | 'failing'
  | 'interrupted'
  | 'running'
  | 'cancelled'
  | 'ok'
  | 'never-run'
  | 'archived';

export interface FlowRow {
  /** Absolute where the host gave one — this is what `openFile` needs. */
  flowPath: string;
  /** The same file, workspace-relative, which is what a reader wants to see. */
  displayPath: string;
  flowName: string;
  state: FlowRowState;
  runs: number;
  failed: number;
  agentMs: number;
  averageAgentMs: number;
  humanMs: number;
  lastRunAt: number | null;
  schedule: FlowSchedule | null;
  nextRunAt: number | null;
  problemCount: number;
  problemSummary: string | null;
}

/**
 * Every flow in the workspace, whether or not it has ever run.
 *
 * The panel previously derived its list from run records alone, so a flow
 * written five minutes ago did not appear on the one screen named after it.
 * Flow files are the left side of this join for that reason; runs only decorate
 * them.
 *
 * Pure — the scan and the parse happen in `loadFlowFiles`.
 */
export function buildFlowRows(
  files: FlowFile[],
  metrics: FlowMetrics[],
  workspaceRoot = ''
): FlowRow[] {
  const key = (path: string) => flowPathKey(path, workspaceRoot);
  const byPath = new Map<string, FlowMetrics>();
  for (const entry of metrics) {
    const canonical = key(entry.pathKey || entry.flowPath);
    const existing = byPath.get(canonical);
    byPath.set(
      canonical,
      existing ? mergeMetrics(existing, entry, canonical) : { ...entry, pathKey: canonical }
    );
  }
  const rows: FlowRow[] = [];

  for (const file of files) {
    const canonical = key(file.flowPath);
    const runs = byPath.get(canonical);
    byPath.delete(canonical);
    rows.push({
      flowPath: file.flowPath,
      displayPath: workspaceRelativeFlowPath(file.flowPath, workspaceRoot),
      flowName: file.flowName,
      state: stateOf(file, runs),
      runs: runs?.runs ?? 0,
      failed: runs?.failed ?? 0,
      agentMs: runs?.agentMs ?? 0,
      averageAgentMs: runs?.runs ? Math.round(runs.agentMs / runs.runs) : 0,
      humanMs: runs?.humanMs ?? 0,
      lastRunAt: runs?.lastRunAt ?? null,
      schedule: file.schedule,
      nextRunAt: file.nextRunAt,
      problemCount: file.problems.length,
      problemSummary: file.problems[0]?.message ?? null,
    });
  }

  // Whatever is left has runs but no file behind it any more.
  for (const runs of byPath.values()) {
    rows.push({
      flowPath: runs.flowPath,
      displayPath: workspaceRelativeFlowPath(runs.flowPath, workspaceRoot),
      flowName: runs.flowName,
      state: 'archived',
      runs: runs.runs,
      failed: runs.failed,
      agentMs: runs.agentMs,
      averageAgentMs: runs.runs ? Math.round(runs.agentMs / runs.runs) : 0,
      humanMs: runs.humanMs,
      lastRunAt: runs.lastRunAt,
      schedule: null,
      nextRunAt: null,
      problemCount: 0,
      problemSummary: null,
    });
  }

  // What is broken, then what is alive and recent, then what has never run, then
  // what is gone — the order someone scanning for a problem reads in.
  return rows.sort((a, b) => {
    const group = sortGroup(a) - sortGroup(b);
    if (group !== 0) return group;
    if (a.nextRunAt !== b.nextRunAt && a.nextRunAt !== null && b.nextRunAt !== null) {
      return a.nextRunAt - b.nextRunAt;
    }
    if (a.lastRunAt !== b.lastRunAt) return (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0);
    return a.flowName.localeCompare(b.flowName);
  });
}

/** Broken/active work is urgent; after that, automation comes before manual work. */
function sortGroup(row: FlowRow): number {
  if (row.state === 'invalid') return 0;
  if (row.state === 'failing') return 1;
  if (row.state === 'interrupted') return 2;
  if (row.state === 'running') return 3;
  if (row.schedule?.enabled === true) return 4;
  if (row.state === 'cancelled') return 5;
  if (row.state === 'ok') return 6;
  if (row.state === 'never-run') return 7;
  return 8;
}

function stateOf(file: FlowFile, runs: FlowMetrics | undefined): FlowRowState {
  if (!file.valid) return 'invalid';
  if (!runs || runs.runs === 0) return 'never-run';
  if (runs.lastStatus === 'failed') return 'failing';
  if (runs.lastStatus === 'interrupted') return 'interrupted';
  if (runs.lastStatus === 'running') return 'running';
  if (runs.lastStatus === 'cancelled') return 'cancelled';
  return 'ok';
}

function mergeMetrics(a: FlowMetrics, b: FlowMetrics, pathKey: string): FlowMetrics {
  const latest = b.lastRunAt >= a.lastRunAt ? b : a;
  return {
    flowName: latest.flowName,
    flowPath: latest.flowPath,
    pathKey,
    runs: a.runs + b.runs,
    failed: a.failed + b.failed,
    agentMs: a.agentMs + b.agentMs,
    humanMs: a.humanMs + b.humanMs,
    lastRunAt: latest.lastRunAt,
    lastStatus: latest.lastStatus,
  };
}
