import type { RunFileWriter } from '../runner/runStore';
import type { WorkspaceFiles } from '../host/workspaceScan';
import type { ScheduleState } from './types';

/**
 * Schedule state lives beside the runs, not in the flow.
 *
 * A due time and a last outcome are machine-local: writing them into
 * `.flow.json` would dirty a shared, committed file on a timer and put one
 * machine's clock into everybody's repository.
 */
export function statePathFor(flowPath: string): string {
  const directory = flowPath.slice(0, Math.max(flowPath.lastIndexOf('/'), 0));
  const name = flowPath.slice(flowPath.lastIndexOf('/') + 1);
  const prefix = directory ? `${directory}/` : '';
  return `${prefix}.flow-runs/${name}.schedule.json`;
}

export async function readScheduleState(
  files: Pick<WorkspaceFiles, 'readFile'>,
  flowPath: string
): Promise<ScheduleState> {
  try {
    const parsed = JSON.parse(await files.readFile(statePathFor(flowPath))) as ScheduleState;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    // No state yet, or a hand-edited file: start clean rather than refusing to
    // schedule at all.
    return {};
  }
}

export async function writeScheduleState(
  writer: RunFileWriter,
  flowPath: string,
  state: ScheduleState
): Promise<void> {
  await writer.write(statePathFor(flowPath), `${JSON.stringify(state, null, 2)}\n`);
}
