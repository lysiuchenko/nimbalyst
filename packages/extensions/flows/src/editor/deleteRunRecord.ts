import type { HostIpc } from '../host/nimbalystSessionHost';

/**
 * Forget one run.
 *
 * The extension filesystem service can read and write but not delete, so this
 * goes through the host's own `delete-file` channel — the same one the file
 * tree uses, which means the record lands wherever the user's trash settings
 * say it should.
 */
export async function deleteRunRecord(
  ipc: HostIpc,
  flowPath: string,
  runId: string
): Promise<void> {
  const directory = flowPath.slice(0, Math.max(flowPath.lastIndexOf('/'), 0));
  const prefix = directory ? `${directory}/` : '';
  await ipc.invoke('delete-file', `${prefix}.flow-runs/${runId}.json`);
}
