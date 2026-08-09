// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NimbalystSessionHost } from '../nimbalystSessionHost';

function electronApi(responses: Record<string, unknown> = {}) {
  const calls: { channel: string; args: unknown[] }[] = [];
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    calls.push({ channel, args });
    return (
      responses[channel] ?? {
        success: true,
        worktree: { id: 'wt-1', path: '/repo_worktrees/plan', branch: 'worktree/plan' },
        id: 'session-1',
      }
    );
  });
  return { api: { invoke }, calls };
}

describe('NimbalystSessionHost', () => {
  it('makes a sub-agent id safe to use as a branch name', async () => {
    const { api, calls } = electronApi();

    await new NimbalystSessionHost(api, '/repo').createWorktree('review[2]');

    // Brackets are not legal in a refname, so `review[2]` cannot be one.
    expect((calls[0].args[1] as { name: string }).name).toMatch(/^review-2-[a-z0-9]+$/);
  });

  it('does not collide with the worktree an earlier run of the same node left behind', async () => {
    const { api, calls } = electronApi();
    const host = new NimbalystSessionHost(api, '/repo');

    await host.createWorktree('review[2]');
    await host.createWorktree('review[2]');

    expect(calls[0].args[1]).not.toEqual(calls[1].args[1]);
  });

  it('creates a worktree for a node and returns where it landed', async () => {
    const { api, calls } = electronApi();

    const worktree = await new NimbalystSessionHost(api, '/repo').createWorktree('plan');

    expect(calls[0].channel).toBe('worktree:create');
    expect(calls[0].args[0]).toBe('/repo');
    expect((calls[0].args[1] as { name: string }).name).toMatch(/^plan-/);
    expect(worktree).toEqual({ id: 'wt-1', path: '/repo_worktrees/plan', branch: 'worktree/plan' });
  });

  it('reports why a worktree could not be created rather than continuing silently', async () => {
    const { api } = electronApi({
      'worktree:create': { success: false, error: 'not a git repository' },
    });

    await expect(new NimbalystSessionHost(api, '/repo').createWorktree('plan')).rejects.toThrow(
      'could not create a worktree for node "plan": not a git repository'
    );
  });

  it('creates a session bound to the worktree so the node is isolated', async () => {
    const { api, calls } = electronApi();

    const sessionId = await new NimbalystSessionHost(api, '/repo').createSession({
      nodeId: 'plan',
      title: 'Flow: Draft plan',
      worktreeId: 'wt-1',
    });

    expect(calls[0].channel).toBe('sessions:create');
    expect(calls[0].args[0]).toMatchObject({
      workspaceId: '/repo',
      session: { title: 'Flow: Draft plan', provider: 'claude-code', mode: 'agent', worktreeId: 'wt-1' },
    });
    expect(sessionId).toBe('session-1');
  });

  it('creates an unbound session when the node does not want a worktree', async () => {
    const { api, calls } = electronApi();

    await new NimbalystSessionHost(api, '/repo').createSession({
      nodeId: 'plan',
      title: 'Flow: Draft plan',
    });

    expect((calls[0].args[0] as { session: { worktreeId: string | null } }).session.worktreeId).toBeNull();
  });

  it('writes the node transcript into its session', async () => {
    const { api, calls } = electronApi();

    await new NimbalystSessionHost(api, '/repo').saveTranscript('session-1', 'do it', 'done');

    expect(calls[0]).toEqual({
      channel: 'session:save',
      args: [
        {
          id: 'session-1',
          messages: [
            { role: 'user', content: 'do it' },
            { role: 'assistant', content: 'done' },
          ],
        },
      ],
    });
  });

  it('reads token usage back off a finished session', async () => {
    const { api } = electronApi({
      'sessions:get': { success: true, session: { tokenUsage: { inputTokens: 90, outputTokens: 12 } } },
    });

    const usage = await new NimbalystSessionHost(api, '/repo').getTokenUsage('session-1');

    expect(usage).toEqual({ inputTokens: 90, outputTokens: 12 });
  });

  it('returns no usage when the session has none rather than reporting zero', async () => {
    const { api } = electronApi({ 'sessions:get': { success: true, session: {} } });

    expect(await new NimbalystSessionHost(api, '/repo').getTokenUsage('session-1')).toBeUndefined();
  });

  it('spots a session parked on a permission prompt', async () => {
    const { api } = electronApi({
      'transcript:get-tail-messages': [
        { type: 'user_message', text: '/changelog' },
        { type: 'tool_call', toolCall: { toolName: 'Bash', status: 'running' } },
        { type: 'tool_call', toolCall: { toolName: 'ToolPermission', status: 'running' } },
      ],
    });

    expect(await new NimbalystSessionHost(api, '/repo').hasPendingPermission('s1')).toBe(true);
  });

  it('does not mistake a finished permission call for a block', async () => {
    const { api } = electronApi({
      'transcript:get-tail-messages': [
        { type: 'tool_call', toolCall: { toolName: 'ToolPermission', status: 'completed' } },
        { type: 'assistant_message', text: 'done' },
      ],
    });

    expect(await new NimbalystSessionHost(api, '/repo').hasPendingPermission('s1')).toBe(false);
  });
});
