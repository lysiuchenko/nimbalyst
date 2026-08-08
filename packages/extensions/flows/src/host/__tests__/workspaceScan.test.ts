// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { scanWorkspaceCatalog } from '../workspaceScan';

function filesystem(files: Record<string, string>) {
  return {
    findFiles: vi.fn(async (pattern: string) => {
      const suffix = pattern.replace('**/', '');
      return Object.keys(files).filter((path) =>
        pattern.includes('skills') ? path.endsWith('SKILL.md') : path.endsWith('.md') && path.includes('/commands/')
      ).filter((path) => path.endsWith(suffix.split('/').pop() ?? '.md') || true);
    }),
    readFile: vi.fn(async (path: string) => files[path] ?? ''),
  };
}

const skillFile = `---
name: release-notes
description: Draft release notes from a diff
---

Body here.
`;

describe('scanWorkspaceCatalog', () => {
  it('finds a project skill the host does not report', async () => {
    const fs = filesystem({ '.claude/skills/release-notes/SKILL.md': skillFile });

    const found = await scanWorkspaceCatalog(fs);

    expect(found.skills).toEqual([
      expect.objectContaining({
        value: 'release-notes',
        name: 'release-notes',
        description: 'Draft release notes from a diff',
        source: 'project',
      }),
    ]);
  });

  it('falls back to the directory name when the frontmatter has no name', async () => {
    const fs = filesystem({ '.claude/skills/api-review/SKILL.md': 'no frontmatter here' });

    const found = await scanWorkspaceCatalog(fs);

    expect(found.skills[0]).toMatchObject({ value: 'api-review', source: 'project' });
  });

  it('finds project slash commands and prefixes them with a slash', async () => {
    const fs = filesystem({
      '.claude/commands/review.md': `---\ndescription: Review a diff\n---\nbody`,
    });

    const found = await scanWorkspaceCatalog(fs);

    expect(found.commands[0]).toMatchObject({
      value: '/review',
      name: 'review',
      description: 'Review a diff',
      source: 'project',
    });
  });

  it('skips a skill whose author marked it not user-invocable', async () => {
    const fs = filesystem({
      '.claude/skills/internal/SKILL.md': `---\nname: internal\nuser-invocable: false\n---\nbody`,
    });

    const found = await scanWorkspaceCatalog(fs);

    expect(found.skills).toEqual([]);
  });

  it('returns nothing rather than throwing when the workspace has no .claude directory', async () => {
    const fs = {
      findFiles: vi.fn(async () => {
        throw new Error('no such directory');
      }),
      readFile: vi.fn(async () => ''),
    };

    await expect(scanWorkspaceCatalog(fs)).resolves.toEqual({ skills: [], commands: [] });
  });

  it('survives a file that cannot be read', async () => {
    const fs = {
      findFiles: vi.fn(async (pattern: string) =>
        pattern.includes('skills') ? ['.claude/skills/broken/SKILL.md'] : []
      ),
      readFile: vi.fn(async () => {
        throw new Error('permission denied');
      }),
    };

    const found = await scanWorkspaceCatalog(fs);

    expect(found.skills[0]).toMatchObject({ value: 'broken' });
  });
});
