import { parseFlowFile } from '../schema/validate';
import type { WorkspaceFiles } from '../host/workspaceScan';
import type { FlowFile } from './flowList';

/**
 * Every flow in the workspace.
 *
 * `findFiles` walks from the glob's *literal* prefix, so a leading `**` scans
 * nothing — the same trap the run-history loader and the scheduler both hit.
 * This is the glob the scheduler already trusts (`startScheduler.ts`).
 */
export async function loadFlowFiles(files: WorkspaceFiles): Promise<FlowFile[]> {
  let paths: string[];
  try {
    paths = (await files.findFiles('*.flow.json')) ?? [];
  } catch {
    return [];
  }

  const found = await Promise.all(
    paths.map(async (flowPath): Promise<FlowFile> => {
      // A flow that will not parse is still a flow the user has. Listing it
      // under its filename beats hiding it from the one screen that would
      // explain where it went.
      const fallback: FlowFile = { flowPath, flowName: nameFor(flowPath), schedule: null };
      try {
        const parsed = parseFlowFile(await files.readFile(flowPath));
        if (!parsed.valid) return fallback;
        return {
          flowPath,
          flowName: parsed.flow.name || fallback.flowName,
          schedule: parsed.flow.schedule ?? null,
        };
      } catch {
        return fallback;
      }
    })
  );

  return found;
}

function nameFor(flowPath: string): string {
  const base = flowPath.slice(flowPath.lastIndexOf('/') + 1);
  return base.replace(/\.flow\.json$/, '');
}
