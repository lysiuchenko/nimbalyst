/**
 * The little glob a trigger needs: `**` spans directories, `*` stays inside a
 * segment, `?` is one non-slash character, everything else is literal.
 *
 * Matching is by suffix on a segment boundary because change events carry
 * absolute paths and `ExtensionContext` has no workspace root to relativise
 * against — `notes/*.md` matches `/w/project/notes/a.md` but not
 * `/w/project/mynotes/a.md`.
 */
export function matchesGlob(glob: string, path: string): boolean {
  const pattern = glob.replace(/^\.\//, '');
  const regex = new RegExp(`(^|/)${globToRegExpSource(pattern)}$`);
  return regex.test(path);
}

function globToRegExpSource(glob: string): string {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    if (glob.startsWith('**/', index)) {
      // Zero or more whole segments, so `src/**/*.ts` also matches `src/c.ts`.
      source += '(?:[^/]+/)*';
      index += 2;
    } else if (glob.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (glob[index] === '*') {
      source += '[^/]*';
    } else if (glob[index] === '?') {
      source += '[^/]';
    } else {
      source += glob[index].replace(/[.+^${}()|[\]\\]/, '\\$&');
    }
  }
  return source;
}
