// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runScheduleCommand } from '../scheduleCommand';

const flow = {
  version: 1,
  name: 'nightly',
  nodes: [{ id: 'check', type: 'shell', run: 'ls' }],
  edges: [],
  variables: {},
  schedule: { type: 'interval', intervalMinutes: 60, enabled: true },
};

function deps(over: Record<string, unknown> = {}) {
  const written: Record<string, string> = {};
  const logs: string[] = [];
  return {
    written,
    logs,
    deps: {
      listFlows: async () => ['nightly.flow.json'],
      readFile: async (path: string) => {
        if (path.endsWith('.schedule.json')) throw new Error('ENOENT');
        return JSON.stringify(flow);
      },
      writeFile: async (path: string, content: string) => void (written[path] = content),
      runFlow: vi.fn(async () => true),
      installAgent: async () => 'installed',
      uninstallAgent: async () => 'removed',
      log: (message: string) => void logs.push(message),
      now: () => 1_000_000,
      ...over,
    },
  };
}

describe('schedule run', () => {
  it('writes down the first due time instead of recomputing it forever', async () => {
    // Without this every invocation resolves `now + interval` afresh, so the
    // deadline walks away and a scheduled flow never runs at all.
    const { deps: d, written } = deps();

    await runScheduleCommand('run', 30, d as never);

    const state = JSON.parse(written['.flow-runs/nightly.flow.json.schedule.json']);
    expect(state.dueAt).toBe(1_000_000 + 3_600_000);
  });

  it('runs a flow once its anchored time has passed', async () => {
    const { deps: d } = deps({
      readFile: async (path: string) =>
        path.endsWith('.schedule.json')
          ? JSON.stringify({ dueAt: 999_000 })
          : JSON.stringify(flow),
    });

    const code = await runScheduleCommand('run', 30, d as never);

    expect(d.runFlow).toHaveBeenCalledWith('nightly.flow.json');
    expect(code).toBe(0);
  });

  it('reports a failing flow with a non-zero exit code', async () => {
    const { deps: d } = deps({
      readFile: async (path: string) =>
        path.endsWith('.schedule.json')
          ? JSON.stringify({ dueAt: 999_000 })
          : JSON.stringify(flow),
      runFlow: vi.fn(async () => false),
    });

    expect(await runScheduleCommand('run', 30, d as never)).toBe(1);
  });

  it('reports agent work rather than attempting it', async () => {
    const agentFlow = { ...flow, nodes: [{ id: 'plan', type: 'agent', prompt: 'x' }] };
    const { deps: d, logs } = deps({
      readFile: async (path: string) =>
        path.endsWith('.schedule.json')
          ? JSON.stringify({ dueAt: 999_000 })
          : JSON.stringify(agentFlow),
    });

    await runScheduleCommand('run', 30, d as never);

    expect(d.runFlow).not.toHaveBeenCalled();
    expect(logs.join(' ')).toContain('only works with Nimbalyst open');
  });

  it('says so when the workspace schedules nothing', async () => {
    const { deps: d, logs } = deps({ listFlows: async () => [] });

    await runScheduleCommand('list', 30, d as never);

    expect(logs.join(' ')).toContain('No flow');
  });
});
