import type { FlowSchedule } from '../schedule/types';
import type { FlowMetrics } from './metrics';

/** A `*.flow.json` found in the workspace, as far as the list needs it. */
export interface FlowFile {
  flowPath: string;
  flowName: string;
  /** Absent when the flow declares none, or when the file will not parse. */
  schedule: FlowSchedule | null;
}

/**
 * Why a row looks the way it does.
 *
 * `archived` is a flow whose runs survive but whose file does not — deleting or
 * renaming a flow should not silently erase the record of what it did.
 */
export type FlowRowState = 'failing' | 'ok' | 'never-run' | 'archived';

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
  humanMs: number;
  lastRunAt: number | null;
  schedule: FlowSchedule | null;
}

const GROUP_ORDER: Record<FlowRowState, number> = {
  failing: 0,
  ok: 1,
  'never-run': 2,
  archived: 3,
};

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
  const key = (path: string) => relativeTo(path, workspaceRoot);
  const byPath = new Map(metrics.map((entry) => [key(entry.flowPath), entry]));
  const rows: FlowRow[] = [];

  for (const file of files) {
    const runs = byPath.get(key(file.flowPath));
    byPath.delete(key(file.flowPath));
    rows.push({
      flowPath: file.flowPath,
      displayPath: key(file.flowPath),
      flowName: file.flowName,
      state: stateOf(runs),
      runs: runs?.runs ?? 0,
      failed: runs?.failed ?? 0,
      agentMs: runs?.agentMs ?? 0,
      humanMs: runs?.humanMs ?? 0,
      lastRunAt: runs?.lastRunAt ?? null,
      schedule: file.schedule,
    });
  }

  // Whatever is left has runs but no file behind it any more.
  for (const runs of byPath.values()) {
    rows.push({
      flowPath: runs.flowPath,
      displayPath: key(runs.flowPath),
      flowName: runs.flowName,
      state: 'archived',
      runs: runs.runs,
      failed: runs.failed,
      agentMs: runs.agentMs,
      humanMs: runs.humanMs,
      lastRunAt: runs.lastRunAt,
      schedule: null,
    });
  }

  // What is broken, then what is alive and recent, then what has never run, then
  // what is gone — the order someone scanning for a problem reads in.
  return rows.sort((a, b) => {
    const group = GROUP_ORDER[a.state] - GROUP_ORDER[b.state];
    if (group !== 0) return group;
    if (a.lastRunAt !== b.lastRunAt) return (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0);
    return a.flowName.localeCompare(b.flowName);
  });
}

/**
 * One comparable form for a flow's path.
 *
 * The editor records `host.filePath`, which is absolute; the headless CLI
 * records whatever was typed on the command line, which usually is not. Joined
 * on the raw string, the same flow appeared twice — once live, once "archived".
 */
function relativeTo(path: string, workspaceRoot: string): string {
  const trimmed =
    workspaceRoot && path.startsWith(workspaceRoot) ? path.slice(workspaceRoot.length) : path;
  return trimmed.replace(/^\.?\//, '');
}

function stateOf(runs: FlowMetrics | undefined): FlowRowState {
  if (!runs || runs.runs === 0) return 'never-run';
  return runs.lastStatus === 'failed' ? 'failing' : 'ok';
}
