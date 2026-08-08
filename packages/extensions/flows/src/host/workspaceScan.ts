import type { CatalogEntry } from './catalog';

/**
 * Scan the workspace for skills and slash entries the host does not report.
 *
 * The host only scans a project's `.claude` directories when
 * `workspaceClaudeCompatibilityEnabled` is on, and it defaults to off — so a
 * user with `.claude/skills/` right there in the repo would otherwise open the
 * skill picker and not find their own skill. Flows looks for them directly and
 * merges the result with whatever the host reports.
 */
export interface WorkspaceFiles {
  findFiles(pattern: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
}

export interface WorkspaceCatalog {
  skills: CatalogEntry[];
  commands: CatalogEntry[];
}

const SKILL_PATTERNS = ['.claude/skills/**/SKILL.md', '.agents/skills/**/SKILL.md'];
const SLASH_PATTERN = '.claude/commands/**/*.md';

export async function scanWorkspaceCatalog(files: WorkspaceFiles): Promise<WorkspaceCatalog> {
  const [skillPaths, slashPaths] = await Promise.all([
    findAll(files, SKILL_PATTERNS),
    findAll(files, [SLASH_PATTERN]),
  ]);

  return {
    skills: compact(await Promise.all(skillPaths.map((p) => toEntry(files, p, false)))),
    commands: compact(await Promise.all(slashPaths.map((p) => toEntry(files, p, true)))),
  };
}

function compact(entries: (CatalogEntry | null)[]): CatalogEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry): entry is CatalogEntry => {
    if (!entry || seen.has(entry.value)) return false;
    seen.add(entry.value);
    return true;
  });
}

async function findAll(files: WorkspaceFiles, patterns: string[]): Promise<string[]> {
  const results = await Promise.all(
    patterns.map(async (pattern) => {
      try {
        return (await files.findFiles(pattern)) ?? [];
      } catch {
        return [];
      }
    })
  );
  return [...new Set(results.flat())];
}

async function toEntry(
  files: WorkspaceFiles,
  filePath: string,
  slashPrefixed: boolean
): Promise<CatalogEntry | null> {
  // A skill is named by its directory, a slash entry by its filename.
  const segments = filePath.split('/');
  const fallbackName = slashPrefixed
    ? (segments.pop() ?? '').replace(/\.md$/, '')
    : segments[segments.length - 2] ?? '';
  if (!fallbackName) return null;

  let frontmatter: Record<string, string> = {};
  try {
    frontmatter = parseFrontmatter(await files.readFile(filePath));
  } catch {
    // An unreadable file still names a real skill; offer it without a description.
  }

  if (frontmatter['user-invocable'] === 'false') return null;

  const name = frontmatter.name || fallbackName;
  return {
    value: slashPrefixed ? `/${name}` : name,
    name,
    ...(frontmatter.description ? { description: frontmatter.description } : {}),
    source: 'project',
  };
}

/** Minimal YAML frontmatter reader — flat `key: value` pairs only. */
function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    fields[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return fields;
}
