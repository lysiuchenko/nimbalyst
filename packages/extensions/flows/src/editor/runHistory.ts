import type { RunFileWriter, RunRecord } from '../runner/runStore';
import { repairStale } from '../runner/staleRuns';
import type { WorkspaceFiles } from '../host/workspaceScan';

/** Enough runs to see a trend, few enough to render. */
const MAX_RUNS = 20;

/**
 * The host's `findFiles` skips hidden directories while walking, but it uses a
 * glob's literal prefix as the scan root — so `.flow-runs/…` finds records
 * while `**\/.flow-runs/…` never can. The prefix has to be literal.
 */
function runsGlobFor(flowPath: string, workspaceRoot: string): string {
  const directory = flowPath.slice(0, Math.max(flowPath.lastIndexOf('/'), 0));
  const relative = directory.startsWith(workspaceRoot)
    ? directory.slice(workspaceRoot.length).replace(/^\//, '')
    : '';
  return relative ? `${relative}/.flow-runs/*.json` : '.flow-runs/*.json';
}

/**
 * Past runs of this flow.
 *
 * `.flow-runs/` accumulates a record per run and nothing surfaced them, so a
 * flow's history — what it cost, what failed, which sessions it created — was
 * invisible unless the user opened the JSON.
 */
export async function loadRunHistory(
  files: WorkspaceFiles,
  flowPath: string,
  workspaceRoot = '',
  /** Set when this editor is mid-run, so its own record is left alone. */
  liveRunId: string | null = null,
  /** Supplied to settle abandoned runs on disk as well as on screen. */
  writer?: RunFileWriter
): Promise<RunRecord[]> {
  // The host globs relative to the workspace root, so an absolute pattern finds
  // nothing. Search every .flow-runs directory and let the flowPath filter
  // below scope the result to this flow.
  let paths: string[];
  try {
    paths = (await files.findFiles(runsGlobFor(flowPath, workspaceRoot))) ?? [];
  } catch {
    return [];
  }

  const records = await Promise.all(paths.map((path) => readRecord(files, path)));

  const mine = records
    .filter((record): record is RunRecord => record !== null)
    // Runs of a sibling flow live in the same directory, so filter by source.
    .filter((record) => record.flowPath === flowPath)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_RUNS);

  if (!writer) return mine;

  const directory = flowPath.slice(0, Math.max(flowPath.lastIndexOf('/'), 0));
  return repairStale(mine, liveRunId, writer, (runId) =>
    directory ? `${directory}/.flow-runs/${runId}.json` : `.flow-runs/${runId}.json`
  );
}

async function readRecord(files: WorkspaceFiles, path: string): Promise<RunRecord | null> {
  try {
    const parsed = JSON.parse(await files.readFile(path)) as RunRecord;
    return typeof parsed?.runId === 'string' ? parsed : null;
  } catch {
    // A half-written or hand-edited record should not break the panel.
    return null;
  }
}
