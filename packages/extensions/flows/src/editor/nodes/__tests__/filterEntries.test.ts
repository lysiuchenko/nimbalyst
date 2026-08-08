// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../../../host/catalog';
import { filterEntries, formatDuration, previewOf } from '../entryFilter';

const entries: CatalogEntry[] = [
  { value: 'brainstorming', name: 'superpowers:brainstorming', description: 'Explore options', source: 'plugin' },
  { value: 'tdd', name: 'superpowers:test-driven-development', description: 'Write the test first', source: 'plugin' },
  { value: 'release-notes', name: 'release-notes', description: 'Draft release notes', source: 'project' },
  { value: 'api-review', name: 'api-review', description: 'Check breaking changes', source: 'project' },
];

describe('filterEntries', () => {
  it('returns everything when nothing is typed', () => {
    expect(filterEntries(entries, '')).toHaveLength(4);
  });

  it('matches on the name', () => {
    expect(filterEntries(entries, 'release').map((e) => e.value)).toEqual(['release-notes']);
  });

  it('matches on the description, so you can find a skill by what it does', () => {
    expect(filterEntries(entries, 'breaking').map((e) => e.value)).toEqual(['api-review']);
  });

  it('ignores case', () => {
    expect(filterEntries(entries, 'BRAINSTORM').map((e) => e.value)).toEqual(['brainstorming']);
  });

  it('matches across a plugin prefix, so "tdd" finds superpowers:test-driven-development', () => {
    expect(filterEntries(entries, 'test-driven').map((e) => e.value)).toEqual(['tdd']);
  });

  it('ranks a name match above a description-only match', () => {
    const ranked = filterEntries(entries, 'notes');

    expect(ranked[0].value).toBe('release-notes');
  });

  it('prefers this project over an installed plugin when both match', () => {
    const ranked = filterEntries(
      [
        { value: 'a', name: 'review', source: 'plugin' },
        { value: 'b', name: 'review', source: 'project' },
      ],
      'review'
    );

    expect(ranked[0].value).toBe('b');
  });

  it('returns nothing rather than guessing when there is no match', () => {
    expect(filterEntries(entries, 'zzzz')).toEqual([]);
  });
});

describe('formatDuration', () => {
  it.each([
    [450, '0.5s'],
    [1500, '1.5s'],
    [65_000, '1m 5s'],
    [3_601_000, '60m 1s'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('says nothing for a node that never finished', () => {
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('previewOf', () => {
  it('shows a short output whole', () => {
    expect(previewOf('done')).toBe('done');
  });

  it('collapses newlines so a multi-line output stays one row', () => {
    expect(previewOf('a\nb\nc')).toBe('a b c');
  });

  it('truncates a long output rather than blowing out the panel', () => {
    const preview = previewOf('x'.repeat(200));

    expect(preview).toHaveLength(80);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('says nothing for a node that produced no output', () => {
    expect(previewOf(undefined)).toBe('—');
  });
});
