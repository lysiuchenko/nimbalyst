// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FlowNode } from '../../../schema/types';
import { configBadges, summarize } from '../summarize';

const node = (fields: Record<string, unknown>) => fields as unknown as FlowNode;

describe('summarize', () => {
  it('reads an agent node as the work it asks for', () => {
    expect(summarize(node({ id: 'plan', type: 'agent', prompt: 'Draft a rollout plan' }))).toBe(
      'Draft a rollout plan'
    );
  });

  it('says what a fan-out repeats and what it repeats over', () => {
    const summary = summarize(
      node({ id: 'r', type: 'fan-out', prompt: 'Review {{item}}', over: '{{files.list}}' })
    );

    expect(summary).toBe('For each item in {{files.list}}: Review {{item}}');
  });

  it('spells out a gate as waiting for a person', () => {
    expect(summarize(node({ id: 'g', type: 'human-gate', message: 'Ship it?' }))).toBe(
      'Waits for a person: Ship it?'
    );
  });

  it('names the skill a skill node uses', () => {
    expect(summarize(node({ id: 's', type: 'skill', skill: 'brainstorming' }))).toBe(
      'Uses the brainstorming skill'
    );
  });

  it('shows a slash command with its arguments', () => {
    expect(summarize(node({ id: 'c', type: 'slash-command', command: '/review', args: 'src/' }))).toBe(
      '/review src/'
    );
  });

  it('shows a shell node as the command it runs', () => {
    expect(summarize(node({ id: 'v', type: 'shell', run: 'npm test' }))).toBe('npm test');
  });

  it('invites the author to finish a node that has nothing in it yet', () => {
    expect(summarize(node({ id: 'plan', type: 'agent', prompt: '' }))).toBe('Not filled in yet');
  });

  it('keeps a long prompt to one readable line', () => {
    const summary = summarize(node({ id: 'p', type: 'agent', prompt: 'word '.repeat(80) }));

    expect(summary.length).toBeLessThanOrEqual(100);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('flattens a multi-line prompt so the card keeps its shape', () => {
    expect(summarize(node({ id: 'p', type: 'agent', prompt: 'first\nsecond' }))).toBe(
      'first second'
    );
  });
});

describe('configBadges', () => {
  it('shows nothing for a node left on every default', () => {
    expect(configBadges(node({ id: 'p', type: 'agent', prompt: 'go' }))).toEqual([]);
  });

  it('names a model without repeating the provider', () => {
    expect(
      configBadges(node({ id: 'p', type: 'agent', prompt: 'go', model: 'claude-code:opus' }))
    ).toContainEqual({ label: 'opus', title: 'Model: claude-code:opus' });
  });

  it('counts restricted tools rather than listing them', () => {
    const badges = configBadges(
      node({ id: 'p', type: 'agent', prompt: 'go', tools: ['Read', 'Write'] })
    );

    expect(badges.map((badge) => badge.label)).toContain('2 tools');
  });

  it('calls out isolation, the setting with real consequences', () => {
    const badges = configBadges(node({ id: 'p', type: 'agent', prompt: 'go', worktree: true }));

    expect(badges.map((badge) => badge.label)).toContain('Isolated');
  });

  it('shows how wide a fan-out runs', () => {
    const badges = configBadges(
      node({ id: 'r', type: 'fan-out', prompt: 'p', over: 'a', concurrency: 3 })
    );

    expect(badges.map((badge) => badge.label)).toContain('3 at a time');
  });

  it('surfaces a chosen reasoning effort', () => {
    const badges = configBadges(
      node({ id: 'p', type: 'agent', prompt: 'go', effortLevel: 'high' })
    );

    expect(badges).toContainEqual({ label: 'effort high', title: 'Reasoning effort: high' });
  });
});
