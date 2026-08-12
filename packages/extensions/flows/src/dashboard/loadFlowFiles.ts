import { parseFlowFile } from '../schema/validate';
import type { WorkspaceFiles } from '../host/workspaceScan';
import { dueAt } from '../schedule/nextRun';
import { readScheduleState } from '../schedule/scheduleState';
import { flowBasename } from './flowPath';
import type { FlowFile } from './flowList';

/**
 * Every flow in the workspace.
 *
 * `findFiles` walks from the glob's *literal* prefix, so a leading `**` scans
 * nothing — the same trap the run-history loader and the scheduler both hit.
 * This is the glob the scheduler already trusts (`startScheduler.ts`).
 */
export async function loadFlowFiles(
  files: WorkspaceFiles,
  now: number = Date.now()
): Promise<FlowFile[]> {
  // Failure to scan is not the same as a workspace with no flows. The caller
  // owns the recoverable error state.
  const paths = (await files.findFiles('*.flow.json')) ?? [];

  const found = await Promise.all(
    paths.map(async (flowPath): Promise<FlowFile> => {
      // A flow that will not parse is still a flow the user has. Listing it
      // under its filename beats hiding it from the one screen that would
      // explain where it went.
      const fallback: FlowFile = {
        flowPath,
        flowName: flowBasename(flowPath),
        schedule: null,
        nextRunAt: null,
        valid: false,
        problems: [{ path: '', message: 'This flow file could not be read.' }],
      };
      try {
        const parsed = parseFlowFile(await files.readFile(flowPath));
        if (!parsed.valid) return { ...fallback, problems: parsed.errors };
        const schedule = parsed.flow.schedule ?? null;
        const scheduleState = schedule?.enabled
          ? await readScheduleState(files, flowPath)
          : undefined;
        return {
          flowPath,
          flowName: parsed.flow.name || fallback.flowName,
          schedule,
          nextRunAt: schedule?.enabled ? dueAt(schedule, scheduleState?.dueAt, now) : null,
          valid: true,
          problems: [],
        };
      } catch {
        return fallback;
      }
    })
  );

  return found;
}
