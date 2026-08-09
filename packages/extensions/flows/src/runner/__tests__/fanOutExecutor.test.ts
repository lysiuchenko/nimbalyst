// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FlowNode } from '../../schema/types';
import { createFanOutExecutor } from '../executors';
import type { AgentClient } from '../ports';
import type { ChildProgress, NodeExecutorContext } from '../types';

function contextFor(
  node: FlowNode,
  resolved: Record<string, string>,
  onChildren?: (children: ChildProgress[]) => void
): NodeExecutorContext {
  return {
    node,
    resolved,
    variables: {},
    signal: new AbortController().signal,
    ...(onChildren ? { reportChildren: onChildren } : {}),
  };
}

const node = {
  id: 'review',
  type: 'fan-out',
  prompt: 'Review {{item}}',
  over: '{{files}}',
  output: 'reviews',
} as FlowNode;

function client(
  run?: AgentClient['run'],
  capabilities?: AgentClient['capabilities']
): AgentClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ...(capabilities ? { capabilities } : {}),
    run:
      run ??
      (async (request) => {
        calls.push(request.prompt);
        return { sessionId: `s-${calls.length}`, response: `done ${request.prompt}` };
      }),
  };
}

describe('fan-out executor', () => {
  it('runs one sub-agent per line of the list', async () => {
    const agent = client();

    await createFanOutExecutor(agent)(
      contextFor(node, { prompt: 'Review {{item}}', over: 'a.ts\nb.ts\nc.ts' })
    );

    expect(agent.calls).toEqual(['Review a.ts', 'Review b.ts', 'Review c.ts']);
  });

  it('ignores blank lines rather than spawning an agent for nothing', async () => {
    const agent = client();

    await createFanOutExecutor(agent)(
      contextFor(node, { prompt: 'Review {{item}}', over: 'a.ts\n\n  \nb.ts\n' })
    );

    expect(agent.calls).toHaveLength(2);
  });

  it('fails clearly when there is nothing to fan out over', async () => {
    await expect(
      createFanOutExecutor(client())(contextFor(node, { prompt: 'p', over: '   ' }))
    ).rejects.toThrow('has nothing to fan out over');
  });

  it('actually overlaps its sub-agents rather than running them one at a time', async () => {
    let running = 0;
    let peak = 0;
    const agent = client(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 15));
      running -= 1;
      return { sessionId: 's', response: 'ok' };
    });

    await createFanOutExecutor(agent)(
      contextFor(node, { prompt: 'p', over: '1\n2\n3\n4' })
    );

    expect(peak).toBeGreaterThan(1);
  });

  it('honours the node concurrency limit', async () => {
    let running = 0;
    let peak = 0;
    const agent = client(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      return { sessionId: 's', response: 'ok' };
    });
    const limited = { ...node, concurrency: 2 } as FlowNode;

    await createFanOutExecutor(agent)(contextFor(limited, { prompt: 'p', over: '1\n2\n3\n4\n5' }));

    expect(peak).toBe(2);
  });

  it('joins the sub-agent results into one output', async () => {
    const result = await createFanOutExecutor(client())(
      contextFor(node, { prompt: 'Review {{item}}', over: 'a\nb' })
    );

    expect(result.output).toContain('done Review a');
    expect(result.output).toContain('done Review b');
  });

  it('reports each sub-agent as it starts and finishes, so the canvas can show them', async () => {
    const seen: ChildProgress[][] = [];

    await createFanOutExecutor(client())(
      contextFor(node, { prompt: 'p', over: 'a\nb' }, (children) =>
        seen.push(children.map((child) => ({ ...child })))
      )
    );

    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0].map((c) => c.label)).toEqual(['a', 'b']);
    expect(seen[seen.length - 1].every((c) => c.status === 'done')).toBe(true);
  });

  it('marks only the failing sub-agent as failed', async () => {
    const seen: ChildProgress[][] = [];
    const agent = client(async (request) => {
      if (request.prompt.includes('b')) throw new Error('nope');
      return { sessionId: 's', response: 'ok' };
    });

    await expect(
      createFanOutExecutor(agent)(
        contextFor(node, { prompt: '{{item}}', over: 'a\nb\nc' }, (children) =>
          seen.push(children.map((child) => ({ ...child })))
        )
      )
    ).rejects.toThrow(/1 of 3/);

    const last = seen[seen.length - 1];
    expect(last.filter((c) => c.status === 'failed').map((c) => c.label)).toEqual(['b']);
    expect(last.filter((c) => c.status === 'done')).toHaveLength(2);
  });

  it('sums the usage of every sub-agent', async () => {
    const agent = client(async () => ({
      sessionId: 's',
      response: 'ok',
      usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.001 },
    }));

    const result = await createFanOutExecutor(agent)(
      contextFor(node, { prompt: 'p', over: 'a\nb\nc' })
    );

    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 6, costUsd: 0.003 });
  });

  it('names each sub-agent session after its item so they are findable', async () => {
    const requests: string[] = [];
    const agent = client(async (request) => {
      requests.push(request.sessionName);
      return { sessionId: 's', response: 'ok' };
    });

    await createFanOutExecutor(agent)(contextFor(node, { prompt: 'p', over: 'a.ts\nb.ts' }));

    expect(requests).toEqual(['review · a.ts', 'review · b.ts']);
  });

  it('gives every sub-agent its own checkout when the node asks for one', async () => {
    const requests: (boolean | undefined)[] = [];
    const agent = client(async (request) => {
      requests.push(request.worktree);
      return { sessionId: 's', response: 'ok' };
    }, { worktree: true, tools: false });
    const isolated = { ...node, worktree: true } as FlowNode;

    await createFanOutExecutor(agent)(contextFor(isolated, { prompt: 'p', over: 'a.ts\nb.ts' }));

    expect(requests).toEqual([true, true]);
  });

  it('leaves sub-agents in the main tree when the node does not ask', async () => {
    const requests: (boolean | undefined)[] = [];
    const agent = client(async (request) => {
      requests.push(request.worktree);
      return { sessionId: 's', response: 'ok' };
    });

    await createFanOutExecutor(agent)(contextFor(node, { prompt: 'p', over: 'a.ts' }));

    expect(requests).toEqual([undefined]);
  });

  it('refuses to fan out isolated work through a host that cannot isolate', async () => {
    const agent = client();
    const isolated = { ...node, worktree: true } as FlowNode;

    await expect(
      createFanOutExecutor(agent)(contextFor(isolated, { prompt: 'p', over: 'a.ts' }))
    ).rejects.toThrow('worktree isolation');
    expect(agent.calls).toEqual([]);
  });
});
