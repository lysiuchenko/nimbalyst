// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyDue, needsTheApp } from '../dueFlows';
import type { Flow } from '../../schema/types';

const at = (iso: string) => new Date(iso).getTime();
const now = at('2026-08-09T02:00:00');

const flow = (over: Partial<Flow> = {}): Flow =>
  ({
    version: 1,
    name: 'nightly',
    nodes: [{ id: 'check', type: 'shell', run: 'npm test' }],
    edges: [],
    variables: {},
    schedule: { type: 'daily', time: '02:00', enabled: true },
    ...over,
  }) as Flow;

describe('needsTheApp', () => {
  it('lets a shell-only flow run anywhere', () => {
    expect(needsTheApp(flow())).toBeNull();
  });

  it('names the agent steps that keep a flow indoors', () => {
    const withAgent = flow({
      nodes: [
        { id: 'check', type: 'shell', run: 'npm test' },
        { id: 'plan', type: 'agent', prompt: 'think' },
        { id: 'spread', type: 'fan-out', prompt: 'p', over: 'a' },
      ],
    } as Partial<Flow>);

    expect(needsTheApp(withAgent)).toContain('plan');
    expect(needsTheApp(withAgent)).toContain('spread');
  });

  it('counts skills and slash commands as agent work too', () => {
    for (const node of [
      { id: 's', type: 'skill', skill: 'review' },
      { id: 'c', type: 'slash-command', command: '/go' },
    ]) {
      expect(needsTheApp(flow({ nodes: [node] } as Partial<Flow>))).not.toBeNull();
    }
  });
});

describe('classifyDue', () => {
  const entry = (over = {}) => ({
    flowPath: 'nightly.flow.json',
    flow: flow(),
    state: { dueAt: now },
    ...over,
  });

  it('picks out the flow whose time has come', () => {
    const result = classifyDue([entry()], now);

    expect(result.runnable.map((r) => r.flowPath)).toEqual(['nightly.flow.json']);
  });

  it('leaves a flow alone before its time', () => {
    const result = classifyDue([entry({ state: { dueAt: now + 60_000 } })], now);

    expect(result.runnable).toEqual([]);
    expect(result.waiting).toHaveLength(1);
  });

  it('separates work that cannot run without the app, rather than failing it', () => {
    const agentFlow = flow({ nodes: [{ id: 'plan', type: 'agent', prompt: 'x' }] } as Partial<Flow>);

    const result = classifyDue([entry({ flow: agentFlow })], now);

    expect(result.runnable).toEqual([]);
    expect(result.needsApp).toHaveLength(1);
    expect(result.needsApp[0].reason).toContain('plan');
  });

  it('ignores a flow with no schedule at all', () => {
    const result = classifyDue([entry({ flow: flow({ schedule: undefined }) })], now);

    expect(result.runnable).toEqual([]);
    expect(result.waiting).toEqual([]);
  });

  it('skips a run too stale to be worth making', () => {
    const result = classifyDue([entry({ state: { dueAt: now - 13 * 3_600_000 } })], now);

    expect(result.runnable).toEqual([]);
    expect(result.missed).toHaveLength(1);
  });
});
