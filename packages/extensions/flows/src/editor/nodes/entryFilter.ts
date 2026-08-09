import type { CatalogEntry } from '../../host/catalog';

/**
 * Filter and rank a catalog for a type-to-search picker.
 *
 * A workspace with plugins installed can offer a hundred-plus skills, which is
 * a scroll, not a choice. Matching on the description too means a user can find
 * a skill by what it does when they cannot recall its name.
 */
export function filterEntries(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return entries;

  return entries
    .map((entry) => ({ entry, score: scoreOf(entry, needle) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}

function scoreOf(entry: CatalogEntry, needle: string): number {
  const name = entry.name.toLowerCase();
  const description = (entry.description ?? '').toLowerCase();

  let score = 0;
  if (name.startsWith(needle)) score = 100;
  else if (name.includes(needle)) score = 60;
  else if (description.includes(needle)) score = 20;
  else return 0;

  // A skill in this project beats an identically-named one from a plugin: it is
  // the one the author is far more likely to have meant.
  if (entry.source === 'project') score += 5;
  return score;
}

/** `1.5s`, `1m 5s` — short enough for a table cell. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  // Work that finished inside a tick still took time; "0.0s" reads as a stopped clock.
  if (ms < 50) return '<1s';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

const PREVIEW_LIMIT = 80;

/** One-line preview of a node's output, for the run panel. */
export function previewOf(output: string | undefined): string {
  if (output === undefined || output === '') return '—';

  const flat = output.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LIMIT ? `${flat.slice(0, PREVIEW_LIMIT - 1)}…` : flat;
}
