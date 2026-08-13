/**
 * Adapter over the renderer's IPC event bridge.
 *
 * `ExtensionContext` exposes no event API — only panel hosts do, and no panel
 * is alive at activate time. The extension bundle runs in the same renderer as
 * `PanelHostImpl`, whose `onWorkspaceEvent` is exactly this call; going to the
 * bridge directly keeps the trigger machinery inside the extension instead of
 * asking core for a new surface.
 */
interface ElectronEventBridge {
  on(event: string, callback: (data: unknown) => void): () => void;
}

export function onFileChangedOnDisk(callback: (path: string) => void): () => void {
  const api = (globalThis as { electronAPI?: ElectronEventBridge }).electronAPI;
  // Absent outside the app (tests, storybook) — a trigger that cannot hear
  // events is simply inert.
  if (typeof api?.on !== 'function') return () => {};

  return api.on('file-changed-on-disk', (data) => {
    const path = (data as { path?: unknown } | undefined)?.path;
    if (typeof path === 'string') callback(path);
  });
}
