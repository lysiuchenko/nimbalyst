import type { StepProvider } from '../schema/types';
import type { HostIpc } from './nimbalystSessionHost';

/** The three CLIs a flow step can run, in the order the pickers list them. */
const AGENT_PROVIDERS: readonly StepProvider[] = ['claude-code', 'openai-codex', 'copilot-cli'];

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

export interface EffortChoice {
  /** What the node stores in `effortLevel`. */
  key: string;
  label: string;
}

/**
 * The models and effort levels one agent provider offers right now. Fetched
 * live from the host so a newly released model or effort level appears without
 * a code change here — and so the model list is the provider's own native
 * identifiers rather than the chat-only list `listModels` returns.
 */
export interface ProviderCapabilities {
  models: ModelChoice[];
  effortLevels: EffortChoice[];
}

export interface Catalog {
  skills: CatalogEntry[];
  commands: CatalogEntry[];
  /** Keyed by provider; the picker reads the one the node currently selects. */
  agentCapabilities: Record<StepProvider, ProviderCapabilities>;
  tools: readonly string[];
}

/** Every provider present but empty — the shape before any host reply lands. */
export const EMPTY_AGENT_CAPABILITIES: Record<StepProvider, ProviderCapabilities> =
  Object.fromEntries(
    AGENT_PROVIDERS.map(
      (provider) => [provider, { models: [], effortLevels: [] }] as [StepProvider, ProviderCapabilities]
    )
  ) as Record<StepProvider, ProviderCapabilities>;

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

interface CapabilitiesProvider {
  getProviderCapabilities(provider: string): Promise<{
    models: { id: string; name: string }[];
    effortLevels: { key: string; label: string }[];
  }>;
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
  ai: CapabilitiesProvider,
  workspacePath: string,
  scanWorkspace?: WorkspaceScanner
): Promise<Catalog> {
  const [entries, agentCapabilities, project] = await Promise.all([
    safely(async () => (await ipc.invoke('slash-command:list', { workspacePath })) as HostSlashCommand[], []),
    loadAgentCapabilities(ai),
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
    agentCapabilities,
    tools: TOOL_CHOICES,
  };
}

/**
 * Fetch each agent provider's live models and effort levels. One provider
 * failing to answer leaves that provider empty rather than sinking the whole
 * catalog — the picker degrades to free text, it does not disappear.
 */
async function loadAgentCapabilities(
  ai: CapabilitiesProvider
): Promise<Record<StepProvider, ProviderCapabilities>> {
  const pairs = await Promise.all(
    AGENT_PROVIDERS.map(async (provider) => {
      const found = await safely(() => ai.getProviderCapabilities(provider), {
        models: [] as { id: string; name: string }[],
        effortLevels: [] as EffortChoice[],
      });
      const capabilities: ProviderCapabilities = {
        models: found.models.map((model) => ({ value: model.id, label: model.name || model.id })),
        effortLevels: found.effortLevels,
      };
      return [provider, capabilities] as const;
    })
  );
  return Object.fromEntries(pairs) as Record<StepProvider, ProviderCapabilities>;
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
