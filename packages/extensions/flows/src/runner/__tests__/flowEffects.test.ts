// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { resolveTemplate, flowEffects } from '../flowEffects';
import type { Flow } from '../../schema/types';

describe('resolveTemplate', () => {
  test('a literal resolves concrete', () => {
    expect(resolveTemplate('out/report.md', {})).toEqual({ text: 'out/report.md', resolved: true });
  });
  test('a variable resolves concrete', () => {
    expect(resolveTemplate('{{dir}}/report.md', { dir: 'out' })).toEqual({ text: 'out/report.md', resolved: true });
  });
  test('a node.port reference stays symbolic — raw template, resolved false', () => {
    expect(resolveTemplate('{{plan.outfile}}', {})).toEqual({ text: '{{plan.outfile}}', resolved: false });
  });
});

const flow = (nodes: Flow['nodes'], variables: Record<string, string> = {}): Flow => ({
  version: 1, name: 't', nodes, edges: [], variables,
});
const ALLOW = ['npm', 'git'] as const;

describe('flowEffects', () => {
  test('a human-gate-only flow is empty', () => {
    const summary = flowEffects(flow([{ id: 'g', type: 'human-gate', message: 'ok?' }]), { shellAllowlist: ALLOW });
    expect(summary.empty).toBe(true);
    expect(summary.files).toEqual([]);
  });

  test('write-file: literal path resolves, {{node.port}} stays symbolic', () => {
    const summary = flowEffects(flow([
      { id: 'a', type: 'write-file', path: 'out.md', content: 'x' },
      { id: 'b', type: 'write-file', path: '{{a.result}}.md', content: 'y' },
    ]), { shellAllowlist: ALLOW });
    expect(summary.empty).toBe(false);
    expect(summary.files[0].path).toEqual({ text: 'out.md', resolved: true });
    expect(summary.files[1].path.resolved).toBe(false);
    expect(summary.files[1].path.text).toBe('{{a.result}}.md');
  });

  test('shell: allowlisted, non-allowlisted, and ref-leading commands', () => {
    const summary = flowEffects(flow([
      { id: 's1', type: 'shell', run: 'npm test' },
      { id: 's2', type: 'shell', run: 'curl example.com' },
      { id: 's3', type: 'shell', run: '{{cmd}} now' },
    ]), { shellAllowlist: ALLOW });
    expect(summary.shell[0]).toMatchObject({ leadingToken: 'npm', inAllowlist: true });
    expect(summary.shell[1]).toMatchObject({ leadingToken: 'curl', inAllowlist: false });
    expect(summary.shell[2]).toMatchObject({ leadingToken: null, inAllowlist: null });
  });

  test('agent: tools listed; missing tools is undefined; worktree false is main tree', () => {
    const summary = flowEffects(flow([
      { id: 'a', type: 'agent', prompt: 'p', tools: ['Read'] },
      { id: 'b', type: 'agent', prompt: 'p' },
    ]), { shellAllowlist: ALLOW });
    expect(summary.agents[0]).toMatchObject({ kind: 'agent', provider: 'claude-code', tools: ['Read'], worktree: false });
    expect(summary.agents[1].tools).toBeUndefined();
  });

  test('fan-out over a reference is symbolic', () => {
    const summary = flowEffects(flow([
      { id: 'f', type: 'fan-out', prompt: 'p', over: '{{items.list}}' },
    ]), { shellAllowlist: ALLOW });
    expect(summary.agents[0]).toMatchObject({ kind: 'fan-out' });
    expect(summary.agents[0].over).toEqual({ text: '{{items.list}}', resolved: false });
  });

  test('slash-command and skill are agents with the default provider', () => {
    const summary = flowEffects(flow([
      { id: 'c', type: 'slash-command', command: '/review' },
      { id: 'k', type: 'skill', skill: 'lint' },
    ]), { shellAllowlist: ALLOW });
    expect(summary.agents.map((a) => a.kind)).toEqual(['slash-command', 'skill']);
    expect(summary.agents[0].provider).toBe('claude-code');
  });
});
