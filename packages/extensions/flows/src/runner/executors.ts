import type { AgentNode, FlowNode, ShellNode } from '../schema/types';
import type { AgentClient, GateController, ShellClient } from './ports';
import type { NodeExecutor, NodeExecutorContext } from './types';

/** Operators that would let one allowlisted command pull in another. */
const CHAINING = ['&&', '||', ';', '|', '$(', '`', '>', '<', '&', '\n'];

function sessionNameFor(node: FlowNode): string {
  return node.label ?? node.id;
}

/** `agent` nodes: the resolved prompt goes to the agent as written. */
export function createAgentExecutor(client: AgentClient): NodeExecutor {
  return async (context: NodeExecutorContext) => {
    const node = context.node as AgentNode;
    const result = await client.run(
      {
        kind: 'agent',
        nodeId: node.id,
        sessionName: sessionNameFor(node),
        prompt: context.resolved.prompt ?? '',
        model: node.model,
        tools: node.tools,
        worktree: node.worktree,
      },
      context.signal
    );

    return { output: result.response, sessionId: result.sessionId, usage: result.usage };
  };
}

/** `slash-command` nodes: the agent receives `/command args`, as a user would type it. */
export function createSlashCommandExecutor(client: AgentClient): NodeExecutor {
  return async (context: NodeExecutorContext) => {
    const { command = '', args } = context.resolved;
    const result = await client.run(
      {
        kind: 'slash-command',
        nodeId: context.node.id,
        sessionName: sessionNameFor(context.node),
        prompt: args ? `${command} ${args}` : command,
      },
      context.signal
    );

    return { output: result.response, sessionId: result.sessionId, usage: result.usage };
  };
}

/** `skill` nodes: ask the agent for the skill by name, then hand it the input. */
export function createSkillExecutor(client: AgentClient): NodeExecutor {
  return async (context: NodeExecutorContext) => {
    const { skill = '', input } = context.resolved;
    const prompt = input ? `Use the ${skill} skill.\n\n${input}` : `Use the ${skill} skill.`;
    const result = await client.run(
      {
        kind: 'skill',
        nodeId: context.node.id,
        sessionName: sessionNameFor(context.node),
        prompt,
      },
      context.signal
    );

    return { output: result.response, sessionId: result.sessionId, usage: result.usage };
  };
}

export interface ShellExecutorOptions {
  /** Executable names a flow may run. Empty means shell nodes are disabled. */
  allowlist: readonly string[];
}

/**
 * `shell` nodes, gated by an allowlist.
 *
 * The allowlist is checked before the command reaches the host, and any
 * chaining or substitution operator is refused outright — without that, a
 * single allowlisted binary would be enough to run anything.
 */
export function createShellExecutor(client: ShellClient, options: ShellExecutorOptions): NodeExecutor {
  return async (context: NodeExecutorContext) => {
    const node = context.node as ShellNode;
    const command = context.resolved.run ?? '';

    assertAllowed(command, options.allowlist);

    const result = await client.run(
      { nodeId: node.id, command, cwd: context.resolved.cwd },
      context.signal
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `shell command exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`
      );
    }

    return { output: result.stdout };
  };
}

function assertAllowed(command: string, allowlist: readonly string[]): void {
  if (allowlist.length === 0) {
    throw new Error('no shell commands are allowed; add an allowlist to enable shell nodes');
  }
  for (const operator of CHAINING) {
    if (command.includes(operator)) {
      throw new Error(
        `shell command may not chain or substitute other commands (found ${JSON.stringify(operator)})`
      );
    }
  }

  const executable = command.trim().split(/\s+/)[0] ?? '';
  if (!allowlist.includes(executable)) {
    throw new Error(
      `shell command ${JSON.stringify(executable)} is not allowed; permitted commands: ${allowlist.join(', ')}`
    );
  }
}

/**
 * `human-gate` nodes: hold the branch until a person decides.
 *
 * A rejection fails the node, which is what makes the executor skip everything
 * downstream while letting unrelated branches finish.
 */
export function createHumanGateExecutor(gate: GateController): NodeExecutor {
  return async (context: NodeExecutorContext) => {
    const decision = await gate.requestApproval(
      { nodeId: context.node.id, message: context.resolved.message ?? '' },
      context.signal
    );

    if (decision === 'rejected') {
      throw new Error(`gate ${JSON.stringify(context.node.id)} was rejected`);
    }

    return { output: decision };
  };
}
