// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runHeadless, type HeadlessDeps } from '../runHeadless';

const shellFlow = JSON.stringify({
  version: 1,
  name: 'checks',
  nodes: [
    { id: 'build', type: 'shell', run: 'npm run build' },
    { id: 'test', type: 'shell', run: 'npm test' },
  ],
  edges: [{ from: 'build', to: 'test' }],
  variables: {},
});

function deps(overrides: Partial<HeadlessDeps> = {}) {
  const written: Record<string, string> = {};
  const logs: string[] = [];
  const base: HeadlessDeps = {
    readFile: async () => shellFlow,
    writeFile: async (path, content) => {
      written[path] = content;
    },
    shell: { run: async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }) },
    allowlist: ['npm'],
    log: (message) => logs.push(message),
    ...overrides,
  };
  return { deps: base, written, logs };
}

describe('runHeadless', () => {
  it('runs a shell flow and exits 0', async () => {
    const { deps: d, logs } = deps();

    expect(await runHeadless(['run', 'checks.flow.json'], d)).toBe(0);
    expect(logs).toContain('done     build');
    expect(logs).toContain('done     test');
    expect(logs[logs.length - 1]).toMatch(/^run run-.+: done$/);
  });

  it('exits 1 when the flow fails', async () => {
    const { deps: d } = deps({
      shell: { run: async () => ({ stdout: '', stderr: 'boom', exitCode: 1 }) },
    });

    expect(await runHeadless(['run', 'checks.flow.json'], d)).toBe(1);
  });

  it('writes a run record next to the flow', async () => {
    const { deps: d, written } = deps();

    await runHeadless(['run', 'checks.flow.json'], d);

    expect(Object.keys(written).some((path) => path.startsWith('.flow-runs/'))).toBe(true);
  });

  it('passes --var values into the flow', async () => {
    const seen: string[] = [];
    const { deps: d } = deps({
      readFile: async () =>
        JSON.stringify({
          version: 1,
          name: 'vars',
          nodes: [{ id: 'echo', type: 'shell', run: 'npm run {{task}}' }],
          edges: [],
          variables: { task: 'default' },
        }),
      shell: {
        run: async (request) => {
          seen.push(request.command);
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      },
    });

    await runHeadless(['run', 'v.flow.json', '--var', 'task=lint'], d);

    expect(seen).toEqual(['npm run lint']);
  });

  it('exits 2 on an invalid flow and names the problem', async () => {
    const { deps: d, logs } = deps({ readFile: async () => '{"version": 9}' });

    expect(await runHeadless(['run', 'bad.flow.json'], d)).toBe(2);
    expect(logs.join('\n')).toContain('version must be 1');
  });

  it('exits 2 on bad usage instead of running anything', async () => {
    const { deps: d, logs } = deps();

    expect(await runHeadless(['deploy', 'x.flow.json'], d)).toBe(2);
    expect(logs.join('\n')).toContain('unknown command');
  });

  it('fails a gate in CI rather than deciding for the user', async () => {
    const { deps: d } = deps({
      readFile: async () =>
        JSON.stringify({
          version: 1,
          name: 'gated',
          nodes: [{ id: 'gate', type: 'human-gate', message: 'Ship?' }],
          edges: [],
          variables: {},
        }),
    });

    expect(await runHeadless(['run', 'g.flow.json'], d)).toBe(1);
  });

  it('approves gates only when explicitly asked', async () => {
    const { deps: d } = deps({
      approveGates: true,
      readFile: async () =>
        JSON.stringify({
          version: 1,
          name: 'gated',
          nodes: [{ id: 'gate', type: 'human-gate', message: 'Ship?' }],
          edges: [],
          variables: {},
        }),
    });

    expect(await runHeadless(['run', 'g.flow.json'], d)).toBe(0);
  });

  it('refuses to run an agent node and points at compile instead', async () => {
    const { deps: d, written } = deps({
      readFile: async () =>
        JSON.stringify({
          version: 1,
          name: 'agentic',
          nodes: [{ id: 'plan', type: 'agent', prompt: 'plan it' }],
          edges: [],
          variables: {},
        }),
    });

    expect(await runHeadless(['run', 'a.flow.json'], d)).toBe(1);
    const record = Object.values(written).find((c) => c.includes('"nodes"'));
    expect(record).toContain('nimbalyst-flows compile');
  });

  it('compiles a flow to the default command path', async () => {
    const { deps: d, written, logs } = deps();

    expect(await runHeadless(['compile', 'checks.flow.json'], d)).toBe(0);
    expect(written['.claude/commands/flow-checks.md']).toContain('# checks');
    expect(logs.join('\n')).toContain('.claude/commands/flow-checks.md');
  });

  it('compiles to an explicit path when one is given', async () => {
    const { deps: d, written } = deps();

    await runHeadless(['compile', 'checks.flow.json', '--out', 'custom.md'], d);

    expect(written['custom.md']).toBeDefined();
  });

  it('validates without running anything', async () => {
    let ran = false;
    const { deps: d, logs } = deps({
      shell: {
        run: async () => {
          ran = true;
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      },
    });

    expect(await runHeadless(['validate', 'checks.flow.json'], d)).toBe(0);
    expect(ran).toBe(false);
    expect(logs.join('\n')).toContain('is valid (2 nodes)');
  });

  it('prints usage for help', async () => {
    const { deps: d, logs } = deps();

    expect(await runHeadless(['--help'], d)).toBe(0);
    expect(logs.join('\n')).toContain('nimbalyst-flows run');
  });
});
