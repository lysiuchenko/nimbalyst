// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Flow, FlowNode } from '../../schema/types';
import { DagFlowRunner } from '../dagExecutor';
import type { NodeExecutor, NodeExecutorContext, RunEvent } from '../types';

function agent(id: string, extra: Partial<FlowNode> = {}): FlowNode {
  return { id, type: 'agent', prompt: `run ${id}`, ...extra } as FlowNode;
}

function flowOf(nodes: FlowNode[], edges: Flow['edges'], variables: Record<string, string> = {}): Flow {
  return { version: 1, name: 'test', nodes, edges, variables };
}

/** Executor that records the order nodes ran in and echoes a deterministic output. */
function recordingExecutor(order: string[], delays: Record<string, number> = {}): NodeExecutor {
  return async (ctx: NodeExecutorContext) => {
    order.push(`${ctx.node.id}:start`);
    const delay = delays[ctx.node.id] ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    order.push(`${ctx.node.id}:end`);
    return { output: `${ctx.node.id}-output` };
  };
}

const chain = flowOf(
  [agent('a', { output: 'out' }), agent('b'), agent('c')],
  [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]
);

describe('DagFlowRunner — ordering', () => {
  it('runs a single node and reports the run as done', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({ output: 'x' }) });

    const state = await runner.run(flowOf([agent('only')], []));

    expect(state.status).toBe('done');
    expect(state.nodes.only).toMatchObject({ status: 'done', output: 'x' });
  });

  it('runs a chain in dependency order', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: recordingExecutor(order) });

    await runner.run(chain);

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
  });

  it('overlaps independent branches instead of serializing them', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({
      defaultExecutor: recordingExecutor(order, { slow: 40 }),
    });

    await runner.run(flowOf([agent('slow'), agent('quick')], []));

    // `quick` must finish while `slow` is still in flight.
    expect(order).toEqual(['slow:start', 'quick:start', 'quick:end', 'slow:end']);
  });

  it('waits for every parent before running a join node', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: recordingExecutor(order, { left: 30 }) });

    await runner.run(
      flowOf(
        [agent('root'), agent('left'), agent('right'), agent('join')],
        [
          { from: 'root', to: 'left' },
          { from: 'root', to: 'right' },
          { from: 'left', to: 'join' },
          { from: 'right', to: 'join' },
        ]
      )
    );

    expect(order.indexOf('join:start')).toBeGreaterThan(order.indexOf('left:end'));
    expect(order.indexOf('join:start')).toBeGreaterThan(order.indexOf('right:end'));
  });

  it('never exceeds the concurrency cap', async () => {
    let running = 0;
    let peak = 0;
    const runner = new DagFlowRunner({
      defaultExecutor: async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running -= 1;
        return {};
      },
    });

    await runner.run(
      flowOf(['a', 'b', 'c', 'd', 'e'].map((id) => agent(id)), []),
      { concurrency: 2 }
    );

    expect(peak).toBe(2);
  });
});

describe('DagFlowRunner — failure propagation', () => {
  const failing: NodeExecutor = async (ctx) => {
    if (ctx.node.id === 'b') throw new Error('boom');
    return { output: `${ctx.node.id}-output` };
  };

  it('marks the failed node and skips everything downstream', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: failing });

    const state = await runner.run(chain);

    expect(state.nodes.a.status).toBe('done');
    expect(state.nodes.b).toMatchObject({ status: 'failed', error: 'boom' });
    expect(state.nodes.c.status).toBe('skipped');
    expect(state.status).toBe('failed');
  });

  it('still finishes an unrelated branch when one branch fails', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: failing });

    const state = await runner.run(
      flowOf([agent('a'), agent('b'), agent('sibling')], [{ from: 'a', to: 'b' }])
    );

    expect(state.nodes.sibling.status).toBe('done');
    expect(state.status).toBe('failed');
  });

  it('refuses to run an invalid flow and names the problem', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({}) });
    const cyclic = flowOf(
      [agent('a'), agent('b')],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ]
    );

    await expect(runner.run(cyclic)).rejects.toThrow('flow contains a cycle: a -> b -> a');
  });

  it('rejects an unresolvable reference before running any node', async () => {
    const executor = vi.fn(async () => ({}));
    const runner = new DagFlowRunner({ defaultExecutor: executor });

    await expect(
      runner.run(flowOf([agent('a', { prompt: 'use {{nope}}' })], []))
    ).rejects.toThrow('unknown reference {{nope}}');
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('DagFlowRunner — data flow', () => {
  it('hands each executor its node text with references resolved', async () => {
    const seen: Record<string, string> = {};
    const runner = new DagFlowRunner({
      defaultExecutor: async (ctx) => {
        seen[ctx.node.id] = ctx.resolved.prompt ?? '';
        return { output: 'PLAN BODY' };
      },
    });

    await runner.run(
      flowOf(
        [agent('plan', { output: 'plan_md' }), agent('impl', { prompt: 'build {{plan.plan_md}} for {{target}}' })],
        [{ from: 'plan', to: 'impl', port: 'plan_md' }],
        { target: 'the API' }
      )
    );

    expect(seen.impl).toBe('build PLAN BODY for the API');
  });

  it('publishes an output only under the port name its node declares', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({ output: 'value' }) });

    const state = await runner.run(flowOf([agent('a', { output: 'result' })], []));

    expect(state.outputs).toEqual({ a: { result: 'value' } });
  });

  it('routes each node type to its own executor', async () => {
    const calls: string[] = [];
    const runner = new DagFlowRunner({
      executors: {
        agent: async () => {
          calls.push('agent');
          return {};
        },
        shell: async () => {
          calls.push('shell');
          return {};
        },
      },
      defaultExecutor: async () => {
        calls.push('default');
        return {};
      },
    });

    await runner.run(
      flowOf(
        [agent('a'), { id: 's', type: 'shell', run: 'ls' }, { id: 'g', type: 'human-gate', message: 'ok?' }],
        []
      )
    );

    expect(calls.sort()).toEqual(['agent', 'default', 'shell']);
  });

  it('totals token usage across nodes for the cost panel', async () => {
    const runner = new DagFlowRunner({
      defaultExecutor: async () => ({
        usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
      }),
    });

    const state = await runner.run(flowOf([agent('a'), agent('b')], []));

    expect(state.usage).toEqual({ inputTokens: 20, outputTokens: 10, costUsd: 0.02 });
  });
});

describe('DagFlowRunner — observability', () => {
  it('emits run and node events in order', async () => {
    const events: RunEvent[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({}) });

    await runner.run(flowOf([agent('a'), agent('b')], [{ from: 'a', to: 'b' }]), {
      onEvent: (event) => events.push(event),
    });

    expect(events.map((e) => `${e.type}${'nodeId' in e ? `:${e.nodeId}` : ''}`)).toEqual([
      'run-started',
      'node-started:a',
      'node-finished:a',
      'node-started:b',
      'node-finished:b',
      'run-finished',
    ]);
  });

  it('reports the failing node through an event', async () => {
    const events: RunEvent[] = [];
    const runner = new DagFlowRunner({
      defaultExecutor: async () => {
        throw new Error('nope');
      },
    });

    await runner.run(flowOf([agent('a')], []), { onEvent: (event) => events.push(event) });

    expect(events.map((e) => e.type)).toEqual(['run-started', 'node-started', 'node-failed', 'run-finished']);
  });

  it('stamps the run and its nodes with a clock the caller supplies', async () => {
    let tick = 100;
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({}) });

    const state = await runner.run(flowOf([agent('a')], []), { now: () => (tick += 1) });

    expect(state.startedAt).toBe(101);
    expect(state.nodes.a.startedAt).toBeGreaterThanOrEqual(101);
    expect(state.finishedAt).toBeGreaterThan(state.nodes.a.finishedAt!);
  });

  it('gives every run an id so its state file can be found later', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({}) });

    const state = await runner.run(flowOf([agent('a')], []), { runId: 'run-42' });

    expect(state.runId).toBe('run-42');
    expect(state.flowName).toBe('test');
  });
});

describe('DagFlowRunner — cancellation', () => {
  it('stops scheduling once the caller aborts', async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const runner = new DagFlowRunner({
      defaultExecutor: async (ctx) => {
        started.push(ctx.node.id);
        controller.abort();
        return {};
      },
    });

    const state = await runner.run(
      flowOf([agent('a'), agent('b'), agent('c')], [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ]),
      { signal: controller.signal, concurrency: 1 }
    );

    expect(started).toEqual(['a']);
    expect(state.status).toBe('cancelled');
    expect(state.nodes.b.status).toBe('skipped');
  });

  it('flags a node that declared an output but published nothing', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({ output: '   ' }) });

    const state = await runner.run(flowOf([agent('a', { output: 'text' })], []));

    // The node worked; what it published did not, and downstream nodes would
    // otherwise interpolate an empty string with no sign anything was wrong.
    expect(state.nodes.a.status).toBe('done');
    expect(state.nodes.a.warning).toContain('empty text');
  });

  it('records what kind of node each step was', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({ output: 'x' }) });

    const state = await runner.run(flowOf([agent('a')], []));

    // Without this a run record cannot tell agent time from time a person spent
    // at a gate, and reading it off the flow would be wrong once it is edited.
    expect(state.nodes.a.type).toBe('agent');
  });
});
