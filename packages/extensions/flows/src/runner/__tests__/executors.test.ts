// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '../../schema/types';
import {
  createAgentExecutor,
  createHumanGateExecutor,
  createShellExecutor,
  createSkillExecutor,
  createSlashCommandExecutor,
} from '../executors';
import type { AgentClient, GateController, ShellClient } from '../ports';
import type { NodeExecutorContext } from '../types';

function contextFor(node: FlowNode, resolved: Record<string, string>): NodeExecutorContext {
  return { node, resolved, variables: {}, signal: new AbortController().signal };
}

const agentClient = (result = {}): AgentClient & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    run: async (request) => {
      calls.push(request);
      return { sessionId: 'session-1', response: 'the answer', ...result };
    },
  };
};

describe('agent executor', () => {
  it('sends the resolved prompt and returns the response as the node output', async () => {
    const client = agentClient();
    const node = { id: 'plan', type: 'agent', prompt: 'raw {{x}}' } as FlowNode;

    const result = await createAgentExecutor(client)(contextFor(node, { prompt: 'resolved prompt' }));

    expect(client.calls[0]).toMatchObject({ kind: 'agent', prompt: 'resolved prompt', nodeId: 'plan' });
    expect(result.output).toBe('the answer');
  });

  it('passes the node model, tools and worktree flag through to the client', async () => {
    const client = agentClient();
    const node = {
      id: 'plan',
      type: 'agent',
      prompt: 'p',
      model: 'claude-code:opus',
      tools: ['Read', 'Bash'],
      worktree: true,
    } as FlowNode;

    await createAgentExecutor(client)(contextFor(node, { prompt: 'p' }));

    expect(client.calls[0]).toMatchObject({
      model: 'claude-code:opus',
      tools: ['Read', 'Bash'],
      worktree: true,
    });
  });

  it('captures the session id and token usage for the run record', async () => {
    const client = agentClient({
      sessionId: 'session-9',
      usage: { inputTokens: 120, outputTokens: 40, costUsd: 0.02 },
    });
    const node = { id: 'plan', type: 'agent', prompt: 'p' } as FlowNode;

    const result = await createAgentExecutor(client)(contextFor(node, { prompt: 'p' }));

    expect(result.sessionId).toBe('session-9');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40, costUsd: 0.02 });
  });

  it('names the session after the node so it is findable in the session list', async () => {
    const client = agentClient();
    const node = { id: 'plan', type: 'agent', label: 'Draft plan', prompt: 'p' } as FlowNode;

    await createAgentExecutor(client)(contextFor(node, { prompt: 'p' }));

    expect(client.calls[0]).toMatchObject({ sessionName: 'Draft plan' });
  });
});

describe('slash-command executor', () => {
  it('sends the command with its arguments as the prompt', async () => {
    const client = agentClient();
    const node = { id: 'r', type: 'slash-command', command: '/review', args: 'src/' } as FlowNode;

    await createSlashCommandExecutor(client)(contextFor(node, { command: '/review', args: 'src/' }));

    expect(client.calls[0]).toMatchObject({ kind: 'slash-command', prompt: '/review src/' });
  });

  it('sends a bare command when there are no arguments', async () => {
    const client = agentClient();
    const node = { id: 'r', type: 'slash-command', command: '/review' } as FlowNode;

    await createSlashCommandExecutor(client)(contextFor(node, { command: '/review' }));

    expect(client.calls[0]).toMatchObject({ prompt: '/review' });
  });
});

describe('skill executor', () => {
  it('asks for the skill by name and passes its input', async () => {
    const client = agentClient();
    const node = { id: 's', type: 'skill', skill: 'brainstorming', input: 'a flow builder' } as FlowNode;

    await createSkillExecutor(client)(contextFor(node, { skill: 'brainstorming', input: 'a flow builder' }));

    expect(client.calls[0]).toMatchObject({
      kind: 'skill',
      prompt: 'Use the brainstorming skill.\n\na flow builder',
    });
  });
});

describe('shell executor', () => {
  const shellClient = (result: Partial<{ stdout: string; stderr: string; exitCode: number }> = {}) => {
    const calls: unknown[] = [];
    const client: ShellClient & { calls: unknown[] } = {
      calls,
      run: async (request) => {
        calls.push(request);
        return { stdout: 'done', stderr: '', exitCode: 0, ...result };
      },
    };
    return client;
  };

  it('runs an allowlisted command and captures stdout as the output', async () => {
    const client = shellClient({ stdout: '3 passing' });
    const node = { id: 'test', type: 'shell', run: 'npm test' } as FlowNode;

    const result = await createShellExecutor(client, { allowlist: ['npm'] })(
      contextFor(node, { run: 'npm test' })
    );

    expect(client.calls[0]).toMatchObject({ command: 'npm test' });
    expect(result.output).toBe('3 passing');
  });

  it('passes the working directory through', async () => {
    const client = shellClient();
    const node = { id: 't', type: 'shell', run: 'npm test', cwd: 'packages/x' } as FlowNode;

    await createShellExecutor(client, { allowlist: ['npm'] })(
      contextFor(node, { run: 'npm test', cwd: 'packages/x' })
    );

    expect(client.calls[0]).toMatchObject({ cwd: 'packages/x' });
  });

  it('fails the node when the command exits non-zero', async () => {
    const client = shellClient({ exitCode: 1, stderr: '1 failing' });
    const node = { id: 't', type: 'shell', run: 'npm test' } as FlowNode;

    await expect(
      createShellExecutor(client, { allowlist: ['npm'] })(contextFor(node, { run: 'npm test' }))
    ).rejects.toThrow('shell command exited with code 1: 1 failing');
  });

  it('refuses a command that is not on the allowlist, without running it', async () => {
    const client = shellClient();
    const node = { id: 't', type: 'shell', run: 'curl https://example.com' } as FlowNode;

    await expect(
      createShellExecutor(client, { allowlist: ['npm'] })(contextFor(node, { run: 'curl https://example.com' }))
    ).rejects.toThrow('shell command "curl" is not allowed; permitted commands: npm');
    expect(client.calls).toEqual([]);
  });

  it.each([
    ['npm test && curl evil.sh', '&&'],
    ['npm test; rm -rf /', ';'],
    ['npm test | sh', '|'],
    ['npm test $(whoami)', '$('],
    ['npm test `whoami`', '`'],
  ])('refuses %s — chaining would defeat the allowlist', async (command, _operator) => {
    const client = shellClient();
    const node = { id: 't', type: 'shell', run: command } as FlowNode;

    await expect(
      createShellExecutor(client, { allowlist: ['npm'] })(contextFor(node, { run: command }))
    ).rejects.toThrow('shell command may not chain or substitute other commands');
    expect(client.calls).toEqual([]);
  });

  it('refuses everything when the allowlist is empty', async () => {
    const client = shellClient();
    const node = { id: 't', type: 'shell', run: 'npm test' } as FlowNode;

    await expect(
      createShellExecutor(client, { allowlist: [] })(contextFor(node, { run: 'npm test' }))
    ).rejects.toThrow('no shell commands are allowed');
    expect(client.calls).toEqual([]);
  });
});

describe('human-gate executor', () => {
  const gate = (decision: 'approved' | 'rejected'): GateController & { calls: unknown[] } => {
    const calls: unknown[] = [];
    return {
      calls,
      requestApproval: async (request) => {
        calls.push(request);
        return decision;
      },
    };
  };

  it('pauses on the gate and continues once approved', async () => {
    const controller = gate('approved');
    const node = { id: 'g', type: 'human-gate', message: 'Ship {{x}}?' } as FlowNode;

    const result = await createHumanGateExecutor(controller)(
      contextFor(node, { message: 'Ship it?' })
    );

    expect(controller.calls[0]).toMatchObject({ nodeId: 'g', message: 'Ship it?' });
    expect(result.output).toBe('approved');
  });

  it('fails the node when the gate is rejected, so downstream work is skipped', async () => {
    const controller = gate('rejected');
    const node = { id: 'g', type: 'human-gate', message: 'Ship it?' } as FlowNode;

    await expect(
      createHumanGateExecutor(controller)(contextFor(node, { message: 'Ship it?' }))
    ).rejects.toThrow('gate "g" was rejected');
  });

  it('hands the gate the run signal so cancelling a run releases the wait', async () => {
    const controller = { requestApproval: vi.fn(async () => 'approved' as const) };
    const node = { id: 'g', type: 'human-gate', message: 'ok?' } as FlowNode;
    const context = contextFor(node, { message: 'ok?' });

    await createHumanGateExecutor(controller)(context);

    expect(controller.requestApproval).toHaveBeenCalledWith(expect.anything(), context.signal);
  });
});
