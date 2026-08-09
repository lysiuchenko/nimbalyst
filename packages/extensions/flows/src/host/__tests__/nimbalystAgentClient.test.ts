// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ExtensionAIService } from '@nimbalyst/extension-sdk';
import { NimbalystAgentClient } from '../nimbalystAgentClient';

function aiService(overrides: Partial<ExtensionAIService> = {}): ExtensionAIService {
  return {
    sendPrompt: vi.fn(async () => ({ sessionId: 'session-3', response: 'done' })),
    ...overrides,
  } as unknown as ExtensionAIService;
}

const request = {
  kind: 'agent' as const,
  nodeId: 'plan',
  sessionName: 'Draft plan',
  prompt: 'Plan the change',
};

describe('NimbalystAgentClient', () => {
  it('runs the prompt through the host Claude Code provider and returns its session', async () => {
    const ai = aiService();

    const result = await new NimbalystAgentClient(ai).run(request, new AbortController().signal);

    expect(ai.sendPrompt).toHaveBeenCalledWith({
      prompt: 'Plan the change',
      sessionName: 'Flow: Draft plan',
      provider: 'claude-code',
      mode: 'agent',
    });
    expect(result).toEqual({ sessionId: 'session-3', response: 'done' });
  });

  it('asks for a mode the host can actually persist', async () => {
    const ai = aiService();

    await new NimbalystAgentClient(ai).run(request, new AbortController().signal);

    // `auto` is derived from workspace trust and fails the session table's
    // CHECK constraint; requesting it broke every node.
    expect(ai.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ mode: 'agent' }));
  });

  it('explains a step that stalled on a permission prompt instead of returning nothing', async () => {
    const ai = aiService({ sendPrompt: vi.fn(async () => ({ sessionId: 's1', response: '' })) });
    const sessions = {
      getTokenUsage: vi.fn(async () => undefined),
      hasPendingPermission: vi.fn(async () => true),
    };

    await expect(
      new NimbalystAgentClient(ai, sessions).run(request, new AbortController().signal)
    ).rejects.toThrow(/permission/i);
  });

  it('leaves an empty answer alone when nothing was blocking', async () => {
    const ai = aiService({ sendPrompt: vi.fn(async () => ({ sessionId: 's1', response: '' })) });
    const sessions = {
      getTokenUsage: vi.fn(async () => undefined),
      hasPendingPermission: vi.fn(async () => false),
    };

    const result = await new NimbalystAgentClient(ai, sessions).run(
      request,
      new AbortController().signal
    );

    expect(result.response).toBe('');
  });

  it('passes an explicit node model through', async () => {
    const ai = aiService();

    await new NimbalystAgentClient(ai).run(
      { ...request, model: 'claude-code:opus' },
      new AbortController().signal
    );

    expect(ai.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-code:opus' }));
  });

  it('omits the model so the host picks its default when the node declares none', async () => {
    const ai = aiService();

    await new NimbalystAgentClient(ai).run({ ...request, model: null }, new AbortController().signal);

    expect(vi.mocked(ai.sendPrompt).mock.calls[0][0]).not.toHaveProperty('model');
  });

  it('reads token usage back off the session the prompt created', async () => {
    const ai = aiService();
    const sessions = {
      getTokenUsage: vi.fn(async () => ({ inputTokens: 900, outputTokens: 120, totalTokens: 1020 })),
    };

    const result = await new NimbalystAgentClient(ai, sessions).run(request, new AbortController().signal);

    expect(sessions.getTokenUsage).toHaveBeenCalledWith('session-3');
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
  });

  it('still returns the node result when the session reports no usage', async () => {
    const ai = aiService();
    const sessions = { getTokenUsage: vi.fn(async () => undefined) };

    const result = await new NimbalystAgentClient(ai, sessions).run(request, new AbortController().signal);

    expect(result).toMatchObject({ sessionId: 'session-3', response: 'done' });
    expect(result.usage).toBeUndefined();
  });

  it('does not fail a finished node just because usage could not be read', async () => {
    const ai = aiService();
    const sessions = {
      getTokenUsage: vi.fn(async () => {
        throw new Error('session lookup failed');
      }),
    };

    const result = await new NimbalystAgentClient(ai, sessions).run(request, new AbortController().signal);

    expect(result.usage).toBeUndefined();
    expect(result.response).toBe('done');
  });

  it('cannot isolate a node without a worktree host', () => {
    expect(new NimbalystAgentClient(aiService()).capabilities.worktree).toBe(false);
  });

  it('runs an isolated node in a worktree of its own', async () => {
    const ai = aiService();
    const worktrees = { createWorktree: vi.fn(async () => ({ id: 'wt-7', path: '/repo/.worktrees/plan' })) };

    const client = new NimbalystAgentClient(ai, undefined, worktrees);
    expect(client.capabilities.worktree).toBe(true);

    await client.run({ ...request, worktree: true }, new AbortController().signal);

    expect(worktrees.createWorktree).toHaveBeenCalledWith('plan');
    expect(ai.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ worktreeId: 'wt-7' }));
  });

  it('leaves a node that did not ask for isolation in the main working tree', async () => {
    const ai = aiService();
    const worktrees = { createWorktree: vi.fn(async () => ({ id: 'wt-7', path: '/wt' })) };

    await new NimbalystAgentClient(ai, undefined, worktrees).run(request, new AbortController().signal);

    expect(worktrees.createWorktree).not.toHaveBeenCalled();
    expect(vi.mocked(ai.sendPrompt).mock.calls[0][0]).not.toHaveProperty('worktreeId');
  });

  it('fails an isolated node rather than running it in the main tree', async () => {
    const ai = aiService();
    const worktrees = {
      createWorktree: vi.fn(async () => {
        throw new Error('worktree:create refused');
      }),
    };

    await expect(
      new NimbalystAgentClient(ai, undefined, worktrees).run(
        { ...request, worktree: true },
        new AbortController().signal
      )
    ).rejects.toThrow('worktree:create refused');
    expect(ai.sendPrompt).not.toHaveBeenCalled();
  });

  it('does not start a session for a run that was already cancelled', async () => {
    const ai = aiService();
    const controller = new AbortController();
    controller.abort();

    await expect(new NimbalystAgentClient(ai).run(request, controller.signal)).rejects.toThrow(
      'node "plan" was cancelled before it started'
    );
    expect(ai.sendPrompt).not.toHaveBeenCalled();
  });
});
