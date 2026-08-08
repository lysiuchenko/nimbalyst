// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadCatalog, TOOL_CHOICES } from '../catalog';

function ipc(commands: unknown[], models: { id: string; name: string }[] = []) {
  return {
    invoke: vi.fn(async (channel: string): Promise<unknown> =>
      channel === 'slash-command:list' ? commands : []
    ),
    listModels: vi.fn(async () => models),
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

  it('offers the models the user actually has enabled', async () => {
    const host = ipc(entries, [
      { id: 'claude-code:opus', name: 'Opus' },
      { id: 'claude-code:sonnet', name: 'Sonnet' },
    ]);

    const catalog = await loadCatalog(host, host, '/repo');

    expect(catalog.models).toEqual([
      { value: 'claude-code:opus', label: 'Opus' },
      { value: 'claude-code:sonnet', label: 'Sonnet' },
    ]);
  });

  it('still returns a usable catalog when the host cannot list anything', async () => {
    const broken = {
      invoke: vi.fn(async (): Promise<unknown> => {
        throw new Error('no workspace');
      }),
      listModels: vi.fn(async (): Promise<{ id: string; name: string }[]> => {
        throw new Error('no provider');
      }),
    };

    const catalog = await loadCatalog(broken, broken, '/repo');

    expect(catalog).toMatchObject({ skills: [], commands: [], models: [] });
    expect(catalog.tools).toEqual(TOOL_CHOICES);
  });

  it('always offers the standard tool list, which is not host-discoverable', async () => {
    const host = ipc(entries);

    const catalog = await loadCatalog(host, host, '/repo');

    expect(catalog.tools).toContain('Read');
    expect(catalog.tools).toContain('Bash');
  });
});
