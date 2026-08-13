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

describe('DagFlowRunner — resuming from a seed', () => {
  const seeded = (): import('../types').ResumeSeed => ({
    resumedFrom: 'run-old',
    executions: {
      a: { nodeId: 'a', type: 'agent', status: 'done', output: 'a-old', reused: true },
    },
    outputs: { a: { out: 'a-old' } },
  });

  it('does not execute a seeded node', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: recordingExecutor(order) });

    const state = await runner.run(chain, { seed: seeded() });

    expect(order).not.toContain('a:start');
    expect(order).toContain('b:start');
    expect(state.nodes.a).toMatchObject({ status: 'done', output: 'a-old', reused: true });
    expect(state.status).toBe('done');
  });

  it('interpolates a seeded output into the nodes that do run', async () => {
    let seen = '';
    const runner = new DagFlowRunner({
      defaultExecutor: async (ctx) => {
        if (ctx.node.id === 'b') seen = ctx.resolved.prompt;
        return { output: 'x' };
      },
    });
    const wired = flowOf(
      [agent('a', { output: 'out' }), agent('b', { prompt: 'use {{a.out}}' })],
      [{ from: 'a', to: 'b' }]
    );

    await runner.run(wired, { seed: seeded() });

    expect(seen).toBe('use a-old');
  });

  it('carries the resumed-from id onto the state', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({ output: 'x' }) });

    const state = await runner.run(chain, { seed: seeded() });

    expect(state.resumedFrom).toBe('run-old');
  });

  it('stamps a definition hash on every executed node', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: async () => ({ output: 'x' }) });

    const state = await runner.run(chain);

    for (const execution of Object.values(state.nodes)) {
      expect(execution.definitionHash).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe('DagFlowRunner — conditional edges', () => {
  /** `test` fails; `fix` handles it; `ship` is the success path. */
  const branching = (edges: Flow['edges']) =>
    flowOf(
      [
        agent('test', { output: 'log' }),
        agent('fix'),
        agent('ship'),
      ],
      edges
    );

  const failingExecutor =
    (failures: string[], order: string[] = []): NodeExecutor =>
    async (ctx) => {
      order.push(ctx.node.id);
      if (failures.includes(ctx.node.id)) throw new Error(`${ctx.node.id} broke`);
      return { output: `${ctx.node.id}-output` };
    };

  it('routes a failure to its handler and skips the success path', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: failingExecutor(['test'], order) });

    const state = await runner.run(
      branching([
        { from: 'test', to: 'fix', on: 'failure' },
        { from: 'test', to: 'ship' },
      ])
    );

    expect(order).toEqual(['test', 'fix']);
    expect(state.nodes.test.status).toBe('failed');
    expect(state.nodes.fix.status).toBe('done');
    expect(state.nodes.ship.status).toBe('skipped');
  });

  it('a handled failure does not fail the run', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: failingExecutor(['test']) });

    const state = await runner.run(
      branching([
        { from: 'test', to: 'fix', on: 'failure' },
        { from: 'test', to: 'ship' },
      ])
    );

    expect(state.status).toBe('done');
  });

  it('skips the handler when the step succeeds', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: failingExecutor([], order) });

    const state = await runner.run(
      branching([
        { from: 'test', to: 'fix', on: 'failure' },
        { from: 'test', to: 'ship' },
      ])
    );

    expect(order.sort()).toEqual(['ship', 'test']);
    expect(state.nodes.fix.status).toBe('skipped');
    expect(state.status).toBe('done');
  });

  it('an unhandled failure still fails the run', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: failingExecutor(['test']) });

    const state = await runner.run(branching([{ from: 'test', to: 'ship' }]));

    expect(state.status).toBe('failed');
  });

  it('a handler that itself fails, unhandled, fails the run', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: failingExecutor(['test', 'fix']) });

    const state = await runner.run(
      branching([
        { from: 'test', to: 'fix', on: 'failure' },
        { from: 'test', to: 'ship' },
      ])
    );

    expect(state.status).toBe('failed');
  });

  it('hands the error message to the handler as {{node.error}}', async () => {
    let seen = '';
    const runner = new DagFlowRunner({
      defaultExecutor: async (ctx) => {
        if (ctx.node.id === 'test') throw new Error('assertion blew up');
        seen = ctx.resolved.prompt;
        return { output: 'x' };
      },
    });
    const wired = flowOf(
      [agent('test'), agent('fix', { prompt: 'repair this: {{test.error}}' })],
      [{ from: 'test', to: 'fix', on: 'failure' }]
    );

    const state = await runner.run(wired);

    expect(seen).toBe('repair this: assertion blew up');
    expect(state.status).toBe('done');
  });

  it('a skipped handler cascades: nothing downstream of it runs', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: failingExecutor([], order) });
    const chainAfterHandler = flowOf(
      [agent('test'), agent('fix'), agent('report')],
      [
        { from: 'test', to: 'fix', on: 'failure' },
        { from: 'fix', to: 'report' },
      ]
    );

    const state = await runner.run(chainAfterHandler);

    expect(order).toEqual(['test']);
    expect(state.nodes.fix.status).toBe('skipped');
    expect(state.nodes.report.status).toBe('skipped');
  });
});

describe('DagFlowRunner — worktrees on the record', () => {
  it('copies an executor-reported checkout onto the execution', async () => {
    const runner = new DagFlowRunner({
      defaultExecutor: async () => ({
        output: 'x',
        worktree: { id: 'wt-1', branch: 'flow/only-ab12', path: '/wt/only' },
      }),
    });

    const state = await runner.run(flowOf([agent('only')], []));

    expect(state.nodes.only.worktree).toEqual({
      id: 'wt-1',
      branch: 'flow/only-ab12',
      path: '/wt/only',
    });
  });
});

describe('DagFlowRunner — any-joins', () => {
  /** The shape that motivated joins: a conditional fork that meets again. */
  const rejoined = flowOf(
    [
      agent('test', { output: 'out' }),
      agent('repair', { output: 'out' }),
      agent('review', {
        join: 'any',
        prompt: 'judge {{test.out ?? repair.out}}',
      }),
    ],
    [
      { from: 'test', to: 'review' },
      { from: 'test', to: 'repair', on: 'failure' },
      { from: 'repair', to: 'review' },
    ]
  );

  const executorWhere = (failures: string[], order: string[]): NodeExecutor =>
    async (ctx) => {
      order.push(ctx.node.id);
      if (failures.includes(ctx.node.id)) throw new Error(`${ctx.node.id} broke`);
      return { output: `${ctx.node.id}-output` };
    };

  it('the success arm reaches the join', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: executorWhere([], order) });

    const state = await runner.run(rejoined);

    expect(order).toEqual(['test', 'review']);
    expect(state.nodes.repair.status).toBe('skipped');
    expect(state.nodes.review.status).toBe('done');
    expect(state.status).toBe('done');
  });

  it('the failure arm reaches the same join', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: executorWhere(['test'], order) });

    const state = await runner.run(rejoined);

    expect(order).toEqual(['test', 'repair', 'review']);
    expect(state.nodes.review.status).toBe('done');
    // The failure was handled by the fork; the run is not lost.
    expect(state.status).toBe('done');
  });

  it('hands the join whichever arm actually produced output', async () => {
    let seen = '';
    const runner = new DagFlowRunner({
      defaultExecutor: async (ctx) => {
        if (ctx.node.id === 'test') throw new Error('red');
        if (ctx.node.id === 'review') seen = ctx.resolved.prompt;
        return { output: `${ctx.node.id}-output` };
      },
    });

    await runner.run(rejoined);

    expect(seen).toBe('judge repair-output');
  });

  it('runs an any-join once even when several parents complete live', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: executorWhere([], order) });
    const diamond = flowOf(
      [agent('a'), agent('b'), agent('meet', { join: 'any' })],
      [
        { from: 'a', to: 'meet' },
        { from: 'b', to: 'meet' },
      ]
    );

    const state = await runner.run(diamond, { concurrency: 1 });

    expect(order.filter((id) => id === 'meet')).toHaveLength(1);
    expect(state.nodes.meet.status).toBe('done');
  });

  it('skips an any-join only when every incoming edge is dead', async () => {
    const runner = new DagFlowRunner({ defaultExecutor: executorWhere([], []) });
    const bothDead = flowOf(
      [agent('a'), agent('handler', { join: 'any' }), agent('other', { join: 'any' })],
      [
        { from: 'a', to: 'handler', on: 'failure' },
        { from: 'a', to: 'other', on: 'failure' },
      ]
    );

    const state = await runner.run(bothDead);

    // a succeeded, so both failure edges are dead — the joins skip.
    expect(state.nodes.handler.status).toBe('skipped');
    expect(state.nodes.other.status).toBe('skipped');
  });

  it('a seeded parent releases an any-join', async () => {
    const order: string[] = [];
    const runner = new DagFlowRunner({ defaultExecutor: executorWhere([], order) });

    const state = await runner.run(rejoined, {
      seed: {
        resumedFrom: 'run-old',
        executions: {
          test: { nodeId: 'test', type: 'agent', status: 'done', output: 'old-out', reused: true },
        },
        outputs: { test: { out: 'old-out' } },
      },
    });

    expect(order).toEqual(['review']);
    expect(state.nodes.repair.status).toBe('skipped');
    expect(state.nodes.review.status).toBe('done');
  });
});

describe('DagFlowRunner — retries', () => {
  const flaky = (failuresBeforeSuccess: number) => {
    let failures = 0;
    const calls: string[] = [];
    const executor: NodeExecutor = async (ctx) => {
      calls.push(ctx.node.id);
      if (ctx.node.id === 'shaky' && failures < failuresBeforeSuccess) {
        failures += 1;
        throw new Error(`attempt ${failures} broke`);
      }
      return { output: `${ctx.node.id}-output` };
    };
    return { executor, calls };
  };

  it('a transient failure is retried and the run succeeds', async () => {
    const { executor, calls } = flaky(1);
    const runner = new DagFlowRunner({ defaultExecutor: executor });

    const state = await runner.run(flowOf([agent('shaky', { retries: 2 })], []));

    expect(calls).toEqual(['shaky', 'shaky']);
    expect(state.nodes.shaky.status).toBe('done');
    expect(state.status).toBe('done');
  });

  it('success still confesses what it cost: attempts and each failure', async () => {
    const { executor } = flaky(2);
    const runner = new DagFlowRunner({ defaultExecutor: executor });

    const state = await runner.run(flowOf([agent('shaky', { retries: 2 })], []));

    expect(state.nodes.shaky.attempts).toBe(3);
    expect(state.nodes.shaky.attemptErrors).toEqual(['attempt 1 broke', 'attempt 2 broke']);
  });

  it('exhausted retries fail the node with the final error', async () => {
    const { executor, calls } = flaky(99);
    const runner = new DagFlowRunner({ defaultExecutor: executor });

    const state = await runner.run(flowOf([agent('shaky', { retries: 2 })], []));

    expect(calls).toHaveLength(3);
    expect(state.nodes.shaky.status).toBe('failed');
    expect(state.nodes.shaky.error).toBe('attempt 3 broke');
    expect(state.status).toBe('failed');
  });

  it('a failure edge fires once, only after the last attempt', async () => {
    const { executor, calls } = flaky(99);
    const runner = new DagFlowRunner({ defaultExecutor: executor });

    const state = await runner.run(
      flowOf(
        [agent('shaky', { retries: 1 }), agent('handler')],
        [{ from: 'shaky', to: 'handler', on: 'failure' }]
      )
    );

    expect(calls).toEqual(['shaky', 'shaky', 'handler']);
    expect(state.nodes.handler.status).toBe('done');
    expect(state.status).toBe('done');
  });

  it('no retries declared means exactly one attempt, as before', async () => {
    const { executor, calls } = flaky(99);
    const runner = new DagFlowRunner({ defaultExecutor: executor });

    const state = await runner.run(flowOf([agent('shaky')], []));

    expect(calls).toEqual(['shaky']);
    expect(state.nodes.shaky.attempts).toBeUndefined();
  });

  it('cancellation stops the retrying immediately', async () => {
    const controller = new AbortController();
    let calls = 0;
    const runner = new DagFlowRunner({
      defaultExecutor: async () => {
        calls += 1;
        controller.abort();
        throw new Error('broke');
      },
    });

    await runner.run(flowOf([agent('shaky', { retries: 5 })], []), {
      signal: controller.signal,
    });

    expect(calls).toBe(1);
  });
});
