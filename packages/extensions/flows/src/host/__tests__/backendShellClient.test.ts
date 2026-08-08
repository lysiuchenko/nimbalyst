// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ExtensionAIService } from '@nimbalyst/extension-sdk';
import { BackendShellClient } from '../backendShellClient';

function aiService(result: unknown = { stdout: 'ok', stderr: '', exitCode: 0 }) {
  return { callBackendTool: vi.fn(async () => result) } as unknown as ExtensionAIService;
}

const request = { nodeId: 'test', command: 'npm test' };

describe('BackendShellClient', () => {
  it('routes the command to the flows backend module with the allowlist attached', async () => {
    const ai = aiService();

    await new BackendShellClient(ai, ['npm'], '/repo').run(request, new AbortController().signal);

    expect(ai.callBackendTool).toHaveBeenCalledWith(
      'flows.runShell',
      { nodeId: 'test', command: 'npm test', allowlist: ['npm'] },
      '/repo'
    );
  });

  it('passes a working directory when the node names one', async () => {
    const ai = aiService();

    await new BackendShellClient(ai, ['npm']).run(
      { ...request, cwd: 'packages/x' },
      new AbortController().signal
    );

    expect(vi.mocked(ai.callBackendTool).mock.calls[0][1]).toMatchObject({ cwd: 'packages/x' });
  });

  it('returns the backend result unchanged', async () => {
    const ai = aiService({ stdout: '3 passing', stderr: 'warn', exitCode: 0 });

    const result = await new BackendShellClient(ai, ['npm']).run(request, new AbortController().signal);

    expect(result).toEqual({ stdout: '3 passing', stderr: 'warn', exitCode: 0 });
  });

  it('treats a backend result with no exit code as a failure rather than a success', async () => {
    const ai = aiService({ stdout: '', stderr: '' });

    const result = await new BackendShellClient(ai, ['npm']).run(request, new AbortController().signal);

    expect(result.exitCode).toBe(-1);
  });

  it('does not reach the backend for a run that was already cancelled', async () => {
    const ai = aiService();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new BackendShellClient(ai, ['npm']).run(request, controller.signal)
    ).rejects.toThrow('node "test" was cancelled before it started');
    expect(ai.callBackendTool).not.toHaveBeenCalled();
  });
});
