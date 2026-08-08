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
    });
    expect(result).toEqual({ sessionId: 'session-3', response: 'done' });
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
