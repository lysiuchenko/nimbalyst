// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { dryAgentClient, dryShellClient } from '../dryRun';
import { runFlow } from '../flowRun';
import type { Flow } from '../../schema/types';
import type { RunFileWriter } from '../runStore';

const gateApproving = { requestApproval: vi.fn(async () => 'approved' as const) };

const flow: Flow = {
  version: 1,
  name: 'rehearsal',
  nodes: [
    { id: 'check', type: 'shell', run: 'npm test', output: 'log' },
    { id: 'draft', type: 'agent', prompt: 'use {{check.log}}', output: 'notes' },
    { id: 'gate', type: 'human-gate', message: 'Ship?' },
    { id: 'save', type: 'write-file', path: 'OUT.md', content: '{{draft.notes}}' },
  ],
  edges: [
    { from: 'check', to: 'draft', port: 'log' },
    { from: 'draft', to: 'gate' },
    { from: 'gate', to: 'save' },
  ],
  variables: {},
} as Flow;

function dryDeps(gate = gateApproving) {
  const writes: string[] = [];
  const writer: RunFileWriter = {
    write: async (path) => {
      writes.push(path);
    },
  };
  return { deps: { agent: dryAgentClient(), shell: dryShellClient(), gate, writer, allowlist: ['npm'] }, writes };
}

describe('dry clients', () => {
  it('the agent stub answers instantly and claims every capability — nothing runs anyway', async () => {
    const client = dryAgentClient();

    expect(client.capabilities).toEqual({ worktree: true, tools: true });
    const result = await client.run(
      { kind: 'agent', nodeId: 'a', sessionName: 'Draft notes', prompt: 'p' },
      new AbortController().signal
    );
    expect(result.response).toContain('[dry-run]');
    expect(result.sessionId).toBe('');
  });

  it('the shell stub reports what it would run, and never runs it', async () => {
    const result = await dryShellClient().run(
      { nodeId: 's', command: 'rm -rf /' },
      new AbortController().signal
    );

    expect(result.stdout).toBe('[dry-run] would run: rm -rf /');
    expect(result.exitCode).toBe(0);
  });
});

describe('runFlow in dry mode', () => {
  it('walks the whole graph, consults the gate, and writes nothing anywhere', async () => {
    const { deps, writes } = dryDeps();

    const record = await runFlow(flow, 'rehearsal.flow.json', deps, { dryRun: true });

    expect(record.status).toBe('done');
    expect(gateApproving.requestApproval).toHaveBeenCalled();
    // The one lever: neither run records nor artifacts touched the writer.
    expect(writes).toEqual([]);
    expect(record.nodes.save.output).toMatch(/^\[dry-run\] would write OUT\.md \(\d+ characters\)$/);
    expect(record.nodes.check.output).toBe('[dry-run] would run: npm test');
  });

  it('a when edge routes on the stub output, and the dead branch dies visibly', async () => {
    const routed: Flow = {
      ...flow,
      nodes: [
        { id: 'a', type: 'agent', prompt: 'p', output: 'word' },
        { id: 'yes', type: 'agent', prompt: 'y' },
        { id: 'no', type: 'agent', prompt: 'n' },
      ],
      edges: [
        { from: 'a', to: 'yes', when: '{{a.word}} contains "[dry-run]"' },
        { from: 'a', to: 'no', when: '{{a.word}} contains "IMPOSSIBLE"' },
      ],
    } as Flow;
    const { deps } = dryDeps();

    const record = await runFlow(routed, 'r.flow.json', deps, { dryRun: true });

    expect(record.nodes.yes.status).toBe('done');
    expect(record.nodes.no.status).toBe('skipped');
  });

  it('without dryRun the write-file executor still writes, so the lever is the flag', async () => {
    const { deps, writes } = dryDeps();

    await runFlow(flow, 'rehearsal.flow.json', deps, {});

    expect(writes).toContain('OUT.md');
  });
});
