import type { HostIpc } from '../host/nimbalystSessionHost';

/**
 * Bring a session on screen.
 *
 * A run knows which sessions it created, and until now that was a string the
 * user could read but not follow. `sessions:focus` is the host channel that
 * puts one in front of them.
 */
export async function openSession(
  ipc: HostIpc,
  sessionId: string,
  workspacePath?: string
): Promise<void> {
  await ipc.invoke('sessions:focus', sessionId, workspacePath);
}
