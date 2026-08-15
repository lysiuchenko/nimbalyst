// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadCatalog, TOOL_CHOICES } from '../catalog';

type Capabilities = {
  models: { id: string; name: string }[];
  effortLevels: { key: string; label: string }[];
};

function ipc(commands: unknown[], capabilities: Record<string, Capabilities> = {}) {
  return {
    invoke: vi.fn(async (channel: string): Promise<unknown> =>
      channel === 'slash-command:list' ? commands : []
    ),
    getProviderCapabilities: vi.fn(
      async (provider: string): Promise<Capabilities> =>
        capabilities[provider] ?? { models: [], effortLevels: [] }
    ),
  };
}

const entries = [
  { name: 'review', description: 'Review a diff', kind: 'command', source: 'project', argumentHint: '[path]' },
  { name: 'brainstorming', description: 'Explore options', kind: 'skill', source: 'user' },
  { name: 'tdd', description: 'Test first', kind: 'skill', source: 'plugin' },
  { name: 'hidden', kind: 'skill', source: 'user', userInvocable: false },
];

describe('loadCatalog', () => {
  it('asks the host for the workspace it was opened on', async () => {
    const host = ipc(entries);

    await loadCatalog(host, host, '/repo');

    expect(host.invoke).toHaveBeenCalledWith('slash-command:list', { workspacePath: '/repo' });
  });

  it('separates skills from slash commands so each picker offers the right thing', async () => {
    const host = ipc(entries);

    const catalog = await loadCatalog(host, host, '/repo');

    expect(catalog.skills.map((s) => s.name)).toEqual(['brainstorming', 'tdd']);
    expect(catalog.commands.map((c) => c.name)).toEqual(['review']);
  });

  it('keeps the description and where each entry came from, so the picker can explain itself', async () => {
    const host = ipc(entries);

    const catalog = await loadCatalog(host, host, '/repo');

    expect(catalog.skills[0]).toMatchObject({
      name: 'brainstorming',
      description: 'Explore options',
      source: 'user',
    });
    expect(catalog.commands[0]).toMatchObject({ argumentHint: '[path]' });
  });

  it('omits entries the author marked as not user-invocable', async () => {
    const host = ipc(entries);

    const catalog = await loadCatalog(host, host, '/repo');

    expect(catalog.skills.map((s) => s.name)).not.toContain('hidden');
  });

  it('prefixes command names with a slash, since that is what a node stores', async () => {
    const host = ipc(entries);

    const catalog = await loadCatalog(host, host, '/repo');

    expect(catalog.commands[0].value).toBe('/review');
    expect(catalog.skills[0].value).toBe('brainstorming');
  });

  it('offers each provider its own live models and effort levels', async () => {
    const host = ipc(entries, {
      'claude-code': {
        models: [
          { id: 'claude-code:opus', name: 'Opus' },
          { id: 'claude-code:sonnet', name: 'Sonnet' },
        ],
        effortLevels: [
          { key: 'high', label: 'High' },
          { key: 'max', label: 'Max' },
        ],
      },
      // Verified against CopilotCLIProvider: it lists models but has no effort
      // control, so the host reports an empty effortLevels for it.
      'copilot-cli': { models: [{ id: 'gpt-5', name: 'GPT-5' }], effortLevels: [] },
    });

    const catalog = await loadCatalog(host, host, '/repo');

    expect(catalog.agentCapabilities['claude-code'].models).toEqual([
      { value: 'claude-code:opus', label: 'Opus' },
      { value: 'claude-code:sonnet', label: 'Sonnet' },
    ]);
    expect(catalog.agentCapabilities['claude-code'].effortLevels).toEqual([
      { key: 'high', label: 'High' },
      { key: 'max', label: 'Max' },
    ]);
    expect(catalog.agentCapabilities['copilot-cli'].effortLevels).toEqual([]);
  });

  it('still returns a usable catalog when the host cannot list anything', async () => {
    const broken = {
      invoke: vi.fn(async (): Promise<unknown> => {
        throw new Error('no workspace');
      }),
      getProviderCapabilities: vi.fn(async (): Promise<Capabilities> => {
        throw new Error('no provider');
      }),
    };

    const catalog = await loadCatalog(broken, broken, '/repo');

    expect(catalog).toMatchObject({ skills: [], commands: [] });
    expect(catalog.agentCapabilities['claude-code']).toEqual({ models: [], effortLevels: [] });
    expect(catalog.tools).toEqual(TOOL_CHOICES);
  });

  it('always offers the standard tool list, which is not host-discoverable', async () => {
    const host = ipc(entries);

    const catalog = await loadCatalog(host, host, '/repo');

    expect(catalog.tools).toContain('Read');
    expect(catalog.tools).toContain('Bash');
  });
});

describe('loadCatalog — project entries the host does not report', () => {
  it('merges skills found in the workspace ahead of plugin ones', async () => {
    const host = ipc(entries);

    const catalog = await loadCatalog(host, host, '/repo', async () => ({
      skills: [{ value: 'release-notes', name: 'release-notes', source: 'project' }],
      commands: [],
    }));

    expect(catalog.skills[0].value).toBe('release-notes');
    expect(catalog.skills.map((s) => s.value)).toContain('brainstorming');
  });

  it('does not list the same entry twice when host and workspace both report it', async () => {
    const host = ipc(entries);

    const catalog = await loadCatalog(host, host, '/repo', async () => ({
      skills: [{ value: 'brainstorming', name: 'brainstorming', source: 'project' }],
      commands: [],
    }));

    expect(catalog.skills.filter((s) => s.value === 'brainstorming')).toHaveLength(1);
    expect(catalog.skills[0].source).toBe('project');
  });

  it('still loads when the workspace scan fails', async () => {
    const host = ipc(entries);

    const catalog = await loadCatalog(host, host, '/repo', async () => {
      throw new Error('no filesystem');
    });

    expect(catalog.skills.length).toBeGreaterThan(0);
  });
});
