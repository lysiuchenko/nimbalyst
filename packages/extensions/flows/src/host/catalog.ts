import type { HostIpc } from './nimbalystSessionHost';

/**
 * What a flow author can pick from, instead of typing a name and hoping.
 *
 * Everything here already exists in the host: `slash-command:list` scans
 * `.claude/commands`, `.claude/skills` and `.agents/skills` for both the
 * project and the user, and the AI service knows which models are enabled.
 */
export interface CatalogEntry {
  /** What the node stores — `/review` for a command, the bare name for a skill. */
  value: string;
  name: string;
  description?: string;
  /** `project`, `user`, `plugin` or `builtin` — shown so two same-named entries are tellable apart. */
  source?: string;
  argumentHint?: string;
}

export interface ModelChoice {
  value: string;
  label: string;
}

export interface Catalog {
  skills: CatalogEntry[];
  commands: CatalogEntry[];
  models: ModelChoice[];
  tools: readonly string[];
}

/**
 * Claude Code's standard tools. Not discoverable from the host, so this is a
 * curated list — a node may still be given a tool that isn't here by editing
 * the file directly.
 */
export const TOOL_CHOICES = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
  'NotebookEdit',
] as const;

interface ModelLister {
  listModels(): Promise<{ id: string; name: string }[]>;
}

/** Optional workspace scan, merged ahead of whatever the host reports. */
export interface WorkspaceScanner {
  (): Promise<{ skills: CatalogEntry[]; commands: CatalogEntry[] }>;
}

/** Project entries win: a skill in this repo is the one the author means. */
function mergeEntries(project: CatalogEntry[], host: CatalogEntry[]): CatalogEntry[] {
  const seen = new Set(project.map((entry) => entry.value));
  return [...project, ...host.filter((entry) => !seen.has(entry.value))];
}

interface HostSlashCommand {
  name: string;
  description?: string;
  kind?: 'command' | 'skill';
  source?: string;
  argumentHint?: string;
  userInvocable?: boolean;
}

/**
 * Load everything the canvas pickers offer.
 *
 * A failure to list is never fatal: an empty picker with a free-text fallback
 * is far better than an editor that will not open because a model list timed
 * out.
 */
export async function loadCatalog(
  ipc: HostIpc,
  ai: ModelLister,
  workspacePath: string,
  scanWorkspace?: WorkspaceScanner
): Promise<Catalog> {
  const [entries, models, project] = await Promise.all([
    safely(async () => (await ipc.invoke('slash-command:list', { workspacePath })) as HostSlashCommand[], []),
    safely(() => ai.listModels(), []),
    safely(
      async () => (scanWorkspace ? await scanWorkspace() : { skills: [], commands: [] }),
      { skills: [] as CatalogEntry[], commands: [] as CatalogEntry[] }
    ),
  ]);

  const invocable = entries.filter((entry) => entry.userInvocable !== false);

  return {
    skills: mergeEntries(
      project.skills,
      invocable.filter((entry) => entry.kind === 'skill').map((entry) => toEntry(entry, false))
    ),
    commands: mergeEntries(
      project.commands,
      invocable.filter((entry) => entry.kind !== 'skill').map((entry) => toEntry(entry, true))
    ),
    models: models.map((model) => ({ value: model.id, label: model.name || model.id })),
    tools: TOOL_CHOICES,
  };
}

function toEntry(entry: HostSlashCommand, asCommand: boolean): CatalogEntry {
  return {
    value: asCommand ? `/${entry.name.replace(/^\//, '')}` : entry.name,
    name: entry.name,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.source !== undefined ? { source: entry.source } : {}),
    ...(entry.argumentHint !== undefined ? { argumentHint: entry.argumentHint } : {}),
  };
}

async function safely<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return (await load()) ?? fallback;
  } catch {
    return fallback;
  }
}
