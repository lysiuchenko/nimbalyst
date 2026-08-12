import type { WorkspaceFiles } from '../host/workspaceScan';
import { buildFlowRows, type FlowRow } from './flowList';
import { loadAllRuns, type RunRecordProblem } from './loadAllRuns';
import { loadFlowFiles } from './loadFlowFiles';
import { summariseRuns, type RunsSummary } from './metrics';

export interface DashboardData {
  summary: RunsSummary;
  rows: FlowRow[];
  runProblems: RunRecordProblem[];
}

/** One consistent snapshot: both scans share the same workspace root and clock. */
export async function loadDashboardData(
  files: WorkspaceFiles,
  workspaceRoot: string,
  now: number = Date.now()
): Promise<DashboardData> {
  const [loadedRuns, flowFiles] = await Promise.all([
    loadAllRuns(files, now),
    loadFlowFiles(files, now),
  ]);
  const summary = summariseRuns(loadedRuns.records, workspaceRoot);
  return {
    summary,
    rows: buildFlowRows(flowFiles, summary.byFlow, workspaceRoot),
    runProblems: loadedRuns.problems,
  };
}
