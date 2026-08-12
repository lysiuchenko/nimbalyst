import type { WorkspaceFiles } from './workspaceScan';

const FIND_FILES_CHANNEL = 'extensions:find-files';

export interface WorkspaceFindIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Give a panel a filesystem whose discovery calls cannot drift to another project.
 *
 * Activation services predate panels and may retain the startup workspace. The
 * panel already receives the live workspace path, so Electron discovery uses the
 * existing scoped IPC directly. Reads keep using the host service because every
 * discovered path is absolute.
 */
export function createWorkspaceFiles(
  filesystem: WorkspaceFiles,
  workspacePath: string,
  ipc?: WorkspaceFindIpc
): WorkspaceFiles {
  const root = workspacePath.trim();
  if (!root) throw new Error('workspace path is required for a flow scan');

  return {
    readFile: (path) => filesystem.readFile(path),
    findFiles: async (pattern) => {
      if (!ipc) return filesystem.findFiles(pattern);

      const result = await ipc.invoke(FIND_FILES_CHANNEL, root, pattern);
      if (!Array.isArray(result) || !result.every((path) => typeof path === 'string')) {
        throw new Error(`${FIND_FILES_CHANNEL} returned an invalid file list`);
      }
      return result;
    },
  };
}

/** Browser-safe access to the preload bridge. */
export function workspaceFindIpc(): WorkspaceFindIpc | undefined {
  if (typeof window === 'undefined') return undefined;
  return (
    window as unknown as {
      electronAPI?: WorkspaceFindIpc;
    }
  ).electronAPI;
}
