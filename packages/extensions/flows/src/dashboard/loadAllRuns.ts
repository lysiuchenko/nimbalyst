import type { RunRecord } from '../runner/runStore';
import type { WorkspaceFiles } from '../host/workspaceScan';

/**
 * Every run record in the workspace.
 *
 * `findFiles` walks from a glob's literal prefix, so the pattern has to start
 * with the directory name; a leading `**` finds nothing.
 */
export async function loadAllRuns(files: WorkspaceFiles): Promise<RunRecord[]> {
  let paths: string[];
  try {
    paths = (await files.findFiles('.flow-runs/*.json')) ?? [];
  } catch {
    return [];
  }

  const records = await Promise.all(
    paths
      // Schedule state lives beside the runs but is not one.
      .filter((path) => !path.endsWith('.schedule.json'))
      .map(async (path) => {
        try {
          const parsed = JSON.parse(await files.readFile(path)) as RunRecord;
          return typeof parsed?.runId === 'string' ? parsed : null;
        } catch {
          return null;
        }
      })
  );

  return records
    .filter((record): record is RunRecord => record !== null)
    .sort((a, b) => b.startedAt - a.startedAt);
}
