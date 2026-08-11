/**
 * Reduce an author-supplied path to one that cannot leave the workspace.
 *
 * `write-file` is the first node type that writes to a path of the author's
 * choosing, so this guard is the feature rather than a detail of it. It runs in
 * the renderer — unlike a shell command, the write never reaches the backend
 * module, so there is no second boundary behind this one.
 *
 * Pure, and normalises before it judges: a check against the front of the
 * string accepts `notes/../../outside.md`, which escapes just as surely as
 * `../outside.md` does.
 *
 * Returns the normalised, forward-slashed, workspace-relative path.
 */
export function safeWorkspacePath(requested: string): string {
  const trimmed = requested.trim();
  if (trimmed === '') {
    throw new Error('write-file needs a path: a path is required');
  }

  // Windows separators are accepted so a flow authored on Windows still runs
  // here, but everything downstream sees one separator.
  const slashed = trimmed.replace(/\\/g, '/');

  // Absolute in any dialect: POSIX root, a drive letter, or a UNC share.
  if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) {
    throw new Error('write-file path must be relative to the workspace');
  }

  const segments: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        throw new Error('write-file path cannot leave the workspace');
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    throw new Error('write-file needs a path: a path is required');
  }

  // Checked after normalisation so `notes/../.git/config` is caught too.
  if (segments.includes('.git')) {
    throw new Error('write-file cannot write into .git');
  }

  return segments.join('/');
}
