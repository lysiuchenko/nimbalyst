// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { matchesGlob } from '../matcher';

describe('matchesGlob', () => {
  it('matches a plain relative path', () => {
    expect(matchesGlob('notes/todo.md', 'notes/todo.md')).toBe(true);
    expect(matchesGlob('notes/todo.md', 'notes/other.md')).toBe(false);
  });

  it('* stays inside one path segment', () => {
    expect(matchesGlob('notes/*.md', 'notes/todo.md')).toBe(true);
    expect(matchesGlob('notes/*.md', 'notes/deep/todo.md')).toBe(false);
  });

  it('** spans directories', () => {
    expect(matchesGlob('src/**/*.ts', 'src/a/b/c.ts')).toBe(true);
    expect(matchesGlob('src/**/*.ts', 'src/c.ts')).toBe(true);
    expect(matchesGlob('src/**/*.ts', 'lib/c.ts')).toBe(false);
  });

  it('? matches exactly one character, never a slash', () => {
    expect(matchesGlob('v?.txt', 'v1.txt')).toBe(true);
    expect(matchesGlob('v?.txt', 'v12.txt')).toBe(false);
    expect(matchesGlob('a?b', 'a/b')).toBe(false);
  });

  it('a literal dot is a dot, not a wildcard', () => {
    expect(matchesGlob('a.md', 'aXmd')).toBe(false);
  });

  it('matches as a suffix of an absolute path — events carry absolute paths', () => {
    expect(matchesGlob('notes/*.md', '/Users/w/project/notes/todo.md')).toBe(true);
    // But only on a segment boundary: "mynotes" is not "notes".
    expect(matchesGlob('notes/*.md', '/Users/w/project/mynotes/todo.md')).toBe(false);
  });

  it('tolerates a leading ./ on the glob', () => {
    expect(matchesGlob('./notes/*.md', 'notes/todo.md')).toBe(true);
  });
});
