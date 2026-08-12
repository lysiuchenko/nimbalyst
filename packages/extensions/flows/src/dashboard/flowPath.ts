function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path);
}

function normalise(path: string): string {
  const slashed = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  if (slashed === '/' || /^[a-z]:\/$/i.test(slashed)) return slashed;
  return slashed.replace(/\/+$/, '');
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[a-z]:\//i.test(path);
}

/** A path suitable for display and comparison within one workspace. */
export function workspaceRelativeFlowPath(flowPath: string, workspaceRoot = ''): string {
  const candidate = normalise(flowPath);
  const root = normalise(workspaceRoot);
  if (!candidate) return '';

  if (root) {
    const insensitive = isWindowsPath(flowPath) || isWindowsPath(workspaceRoot);
    const comparablePath = insensitive ? candidate.toLocaleLowerCase('en-US') : candidate;
    const comparableRoot = insensitive ? root.toLocaleLowerCase('en-US') : root;
    const rootBoundary = comparableRoot.endsWith('/') ? comparableRoot : `${comparableRoot}/`;
    if (comparablePath.startsWith(rootBoundary)) {
      return candidate.slice(rootBoundary.length);
    }
  }

  if (!isAbsolute(candidate)) return candidate.replace(/^(?:\.\/)+/, '');
  return candidate;
}

/** Stable key shared by editor (absolute) and CLI (usually relative) records. */
export function flowPathKey(flowPath: string, workspaceRoot = ''): string {
  const relative = workspaceRelativeFlowPath(flowPath, workspaceRoot);
  return isWindowsPath(flowPath) || isWindowsPath(workspaceRoot)
    ? relative.toLocaleLowerCase('en-US')
    : relative;
}

/** Filename-derived flow name, independent of the platform running the UI. */
export function flowBasename(flowPath: string): string {
  const segments = normalise(flowPath).split('/');
  return (segments.at(-1) ?? '').replace(/\.flow\.json$/i, '');
}
