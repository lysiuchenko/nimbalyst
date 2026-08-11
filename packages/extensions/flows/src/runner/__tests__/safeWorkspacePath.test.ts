// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { safeWorkspacePath } from '../safeWorkspacePath';

describe('safeWorkspacePath', () => {
  test.each([
    ['RELEASE_NOTES.md', 'RELEASE_NOTES.md'],
    ['notes/2026-08.md', 'notes/2026-08.md'],
    ['./notes/a.md', 'notes/a.md'],
    ['notes//a.md', 'notes/a.md'],
    ['notes/./a.md', 'notes/a.md'],
    ['deep/dir/./b/../a.md', 'deep/dir/a.md'],
    ['.flow-runs/fixture.json', '.flow-runs/fixture.json'],
    ['notes\\windows.md', 'notes/windows.md'],
  ])('accepts %s', (input, expected) => {
    expect(safeWorkspacePath(input)).toBe(expected);
  });

  test.each([
    ['', 'a path is required'],
    ['   ', 'a path is required'],
    ['/etc/passwd', 'must be relative'],
    ['C:\\Windows\\system32', 'must be relative'],
    ['\\\\server\\share', 'must be relative'],
    ['../outside.md', 'cannot leave the workspace'],
    ['../../outside.md', 'cannot leave the workspace'],
    // Escapes only after normalisation — a front-of-string check misses this.
    ['notes/../../outside.md', 'cannot leave the workspace'],
    ['a/b/../../../c.md', 'cannot leave the workspace'],
    ['.git/config', 'cannot write into .git'],
    ['.git/hooks/pre-commit', 'cannot write into .git'],
    ['nested/.git/config', 'cannot write into .git'],
  ])('refuses %s', (input, because) => {
    expect(() => safeWorkspacePath(input)).toThrow(because);
  });

  test('never echoes the offending path back in full', () => {
    // The rejection reports the shape, not the value -- the same rule the
    // credential scanner follows, so a path with a secret in it cannot leak
    // into a log or a screenshot.
    try {
      safeWorkspacePath('../../home/me/.ssh/id_rsa_SECRETVALUE');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRETVALUE');
    }
  });

  test('a bare .gitignore is a normal file, not a .git escape', () => {
    expect(safeWorkspacePath('.gitignore')).toBe('.gitignore');
  });
});
