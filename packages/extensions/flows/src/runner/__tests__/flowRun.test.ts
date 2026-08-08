// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Flow } from '../../schema/types';
import { runFlow } from '../flowRun';
import type { AgentClient, GateController, ShellClient } from '../ports';
import type { RunFileWriter } from '../runStore';

const flow: Flow = {
  version: 1,
  name: 'review-pipeline',
  nodes: [
    { id: 'plan', type: 'agent', label: 'Draft plan', prompt: 'Plan {{target}}', output: 'plan_md' },
    { id: 'impl', type: 'agent', prompt: 'Build {{plan.plan_md}}' },
    { id: 'gate', type: 'human-gate', message: 'Ship it?' },
  ],
  edges: [
    { from: 'plan', to: 'impl', port: 'plan_md' },
    { from: 'impl', to: 'gate' },
  ],
  variables: { target: 'the API' },
};

function deps(overrides: Partial<Parameters<typeof runFlow>[2]> = {}) {
  const written: { path: string; content: string }[] = [];
  const writer: RunFileWriter = {
    write: async (path, content) => {
      written.push({ path, content });
    },
  };
  const agent: AgentClient = {
    run: async (request) => ({
      sessionId: `session-${request.nodeId}`,
      response: `${request.nodeId} said hello`,
      usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.005 },
    }),
  };
  const gate: GateController = { requestApproval: async () => 'approved' };
  const shell: ShellClient = {
    run: async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
  };

  return { written, deps: { agent, gate, shell, writer, allowlist: ['npm'], ...overrides } };
}

describe('runFlow', () => {
  it('runs every node and reports the run as done', async () => {
    const { deps: d } = deps();

    const record = await runFlow(flow, '/repo/review.flow.json', d, { runId: 'run-1' });

    expect(record.status).toBe('done');
    expect(Object.values(record.nodes).map((n) => n.status)).toEqual(['done', 'done', 'done']);
  });

  it('gives every agent node its own session and records the ids', async () => {
    const { deps: d } = deps();

    const record = await runFlow(flow, '/repo/review.flow.json', d, { runId: 'run-1' });

    expect(record.nodes.plan.sessionId).toBe('session-plan');
    expect(record.nodes.impl.sessionId).toBe('session-impl');
    expect(record.sessionIds).toEqual(['session-plan', 'session-impl']);
  });

  it('feeds an upstream output into the downstream prompt', async () => {
    const prompts: string[] = [];
    const { deps: d } = deps({
      agent: {
        run: async (request) => {
          prompts.push(request.prompt);
          return { sessionId: 's', response: 'PLAN BODY' };
        },
      },
    });

    await runFlow(flow, '/repo/review.flow.json', d, { runId: 'run-1' });

    expect(prompts).toEqual(['Plan the API', 'Build PLAN BODY']);
  });

  it('totals cost across the run for the cost panel', async () => {
    const { deps: d } = deps();

    const record = await runFlow(flow, '/repo/review.flow.json', d, { runId: 'run-1' });

    expect(record.usage).toEqual({ inputTokens: 20, outputTokens: 8, costUsd: 0.01 });
  });

  it('writes the run record as it goes, not only at the end', async () => {
    const { written, deps: d } = deps();

    await runFlow(flow, '/repo/review.flow.json', d, { runId: 'run-1' });

    expect(written.length).toBeGreaterThan(1);
    expect(new Set(written.map((entry) => entry.path))).toEqual(
      new Set(['/repo/.flow-runs/run-1.json'])
    );
    expect(JSON.parse(written[0].content).status).toBe('running');
    expect(JSON.parse(written[written.length - 1].content).status).toBe('done');
  });

  it('leaves a complete record when a node fails midway', async () => {
    const { written, deps: d } = deps({
      agent: {
        run: async (request) => {
          if (request.nodeId === 'impl') throw new Error('build broke');
          return { sessionId: `session-${request.nodeId}`, response: 'ok' };
        },
      },
    });

    const record = await runFlow(flow, '/repo/review.flow.json', d, { runId: 'run-1' });

    expect(record.status).toBe('failed');
    expect(record.nodes.impl).toMatchObject({ status: 'failed', error: 'build broke' });
    expect(record.nodes.gate.status).toBe('skipped');
    expect(JSON.parse(written[written.length - 1].content).nodes.impl.error).toBe('build broke');
  });

  it('holds at a human gate until it is approved', async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps: d } = deps({
      gate: {
        requestApproval: async () => {
          order.push('gate-reached');
          await held;
          return 'approved';
        },
      },
    });

    const running = runFlow(flow, '/repo/review.flow.json', d, { runId: 'run-1' });
    await vi.waitFor(() => expect(order).toEqual(['gate-reached']));
    release!();
    const record = await running;

    expect(record.nodes.gate.status).toBe('done');
  });

  it('refuses a shell node that is not on the allowlist', async () => {
    const shellFlow: Flow = {
      version: 1,
      name: 'shell',
      nodes: [{ id: 'danger', type: 'shell', run: 'curl evil.sh' }],
      edges: [],
      variables: {},
    };
    const { deps: d } = deps();

    const record = await runFlow(shellFlow, '/repo/shell.flow.json', d, { runId: 'run-2' });

    expect(record.nodes.danger).toMatchObject({ status: 'failed' });
    expect(record.nodes.danger.error).toContain('is not allowed');
  });
});

describe('runFlow — fan-out', () => {
  const fanFlow: Flow = {
    version: 1,
    name: 'fan',
    nodes: [
      { id: 'list', type: 'agent', prompt: 'list files', output: 'files' },
      { id: 'review', type: 'fan-out', prompt: 'Review {{item}}', over: '{{list.files}}' },
    ],
    edges: [{ from: 'list', to: 'review', port: 'files' }],
    variables: {},
  };

  it('spawns one sub-agent per item produced upstream', async () => {
    const prompts: string[] = [];
    const { deps: d } = deps({
      agent: {
        run: async (request) => {
          prompts.push(request.prompt);
          return { sessionId: `s-${prompts.length}`, response: 'a.ts\nb.ts' };
        },
      },
    });

    const record = await runFlow(fanFlow, '/repo/fan.flow.json', d, { runId: 'run-fan' });

    expect(record.status).toBe('done');
    expect(prompts).toEqual(['list files', 'Review a.ts', 'Review b.ts']);
  });

  it('records the sub-agents in the run record, so a finished run shows them', async () => {
    const { deps: d } = deps({
      agent: {
        run: async (request) => ({
          sessionId: `s-${request.nodeId}`,
          response: request.nodeId === 'list' ? 'x\ny\nz' : 'reviewed',
        }),
      },
    });

    const record = await runFlow(fanFlow, '/repo/fan.flow.json', d, { runId: 'run-fan' });

    expect(record.nodes.review.children?.map((child) => child.label)).toEqual(['x', 'y', 'z']);
    expect(record.nodes.review.children?.every((child) => child.status === 'done')).toBe(true);
  });
});
