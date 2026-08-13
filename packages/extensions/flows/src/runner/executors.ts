import type { AgentNode, FanOutNode, FlowNode, ShellNode } from '../schema/types';
import type { AgentClient, GateController, ShellClient } from './ports';
import type { ChildProgress, NodeExecutor, NodeExecutorContext, TokenUsage } from './types';
import type { RunFileWriter } from './runStore';
import { safeWorkspacePath } from './safeWorkspacePath';

/** Sub-agent previews are stored per child in the run record, so they are capped. */
const CHILD_PREVIEW_LIMIT = 400;

function childPreview(response: string): string {
  if (response.length <= CHILD_PREVIEW_LIMIT) return response;
  return `${response.slice(0, CHILD_PREVIEW_LIMIT)}…`;
}

/** Operators that would let one allowlisted command pull in another. */
const CHAINING = ['&&', '||', ';', '|', '$(', '`', '>', '<', '&', '\n'];

/**
 * Flags that turn an allowlisted executable into an arbitrary one.
 *
 * Allowlisting the *executable* is not enough: `node -e '…'`, npm's
 * `--node-options=--require=…` and git's `--upload-pack=…` all execute code the
 * allowlist never approved. These are refused for every command, because the
 * point of the allowlist is to bound what a flow can run.
 */
const SMUGGLING_FLAGS = [
  '-e',
  '--eval',
  '-p',
  '--print',
  '--node-options',
  '--require',
  '-r',
  '--upload-pack',
  '--receive-pack',
  '--exec',
  '--use',
  '-c',
];

function sessionNameFor(node: FlowNode): string {
  return node.label ?? node.id;
}

/**
 * Fail a node whose isolation or tool restrictions the client cannot honor.
 *
 * Running it anyway is the dangerous option: the author asked for a worktree or
 * a tool allowlist, would be told the node succeeded, and would have neither.
 * Two parallel branches editing the same tree, or an agent reaching a tool the
 * flow tried to withhold, are both worse than a clear failure.
 */
function assertCapableFor(node: AgentNode, client: AgentClient): void {
  if (node.worktree === true && !client.capabilities?.worktree) {
    throw new Error(
      `node ${JSON.stringify(node.id)} asks for worktree isolation, which this host cannot provide; ` +
        `it would otherwise run in the main working tree`
    );
  }
  if (node.tools !== undefined && node.tools.length > 0 && !client.capabilities?.tools) {
    throw new Error(
      `node ${JSON.stringify(node.id)} restricts tools to ${node.tools.join(', ')}, which this host cannot enforce; ` +
        `it would otherwise run with every tool available`
    );
  }
}

/** `agent` nodes: the resolved prompt goes to the agent as written. */
export function createAgentExecutor(client: AgentClient): NodeExecutor {
  return async (context: NodeExecutorContext) => {
    const node = context.node as AgentNode;
    assertCapableFor(node, client);

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

    return {
      output: result.response,
      sessionId: result.sessionId,
      usage: result.usage,
      // The branch is the review surface after the run; see the design note.
      ...(result.worktree ? { worktree: result.worktree } : {}),
    };
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

/** How many sub-agents a fan-out node runs at once when it does not say. */
const DEFAULT_FAN_OUT_CONCURRENCY = 4;

/**
 * `fan-out` nodes: one sub-agent per item, running concurrently.
 *
 * The item list is resolved at run time, so a flow can fan out over whatever an
 * upstream node produced — a list of files, tickets, packages — rather than a
 * shape fixed when the flow was authored. Progress is published per sub-agent
 * so the canvas can show them arriving and finishing.
 */
export function createFanOutExecutor(client: AgentClient): NodeExecutor {
  return async (context: NodeExecutorContext) => {
    const node = context.node as FanOutNode;
    assertCapableFor(node as unknown as AgentNode, client);

    const items = (context.resolved.over ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');

    if (items.length === 0) {
      throw new Error(
        `node ${JSON.stringify(node.id)} has nothing to fan out over — ${JSON.stringify(node.over)} resolved to an empty list`
      );
    }

    const children: ChildProgress[] = items.map((label) => ({ label, status: 'queued' }));
    const publish = () => context.reportChildren?.(children.map((child) => ({ ...child })));
    publish();

    const results: (string | undefined)[] = new Array(items.length);
    // Indexed, not pushed: workers finish out of order and the run should list
    // sub-agent sessions in item order.
    const childSessionIds: (string | undefined)[] = new Array(items.length);
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const failures: string[] = [];
    const limit = Math.max(1, node.concurrency ?? DEFAULT_FAN_OUT_CONCURRENCY);

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < items.length) {
        const index = next++;
        const item = items[index];
        children[index].status = 'running';
        publish();

        try {
          const result = await client.run(
            {
              kind: 'agent',
              nodeId: `${node.id}[${index}]`,
              sessionName: `${node.label ?? node.id} · ${item}`,
              // `{{item}}` is resolved here rather than upstream: it only has a
              // value once the list has been split.
              prompt: (context.resolved.prompt ?? '').split('{{item}}').join(item),
              model: node.model,
              tools: node.tools,
              // Per sub-agent, not per node: concurrent workers sharing one
              // checkout would overwrite each other's edits.
              worktree: node.worktree,
            },
            context.signal
          );
          results[index] = result.response;
          children[index] = {
            label: item,
            status: 'done',
            sessionId: result.sessionId,
            // Each checkout is findable after the run: branch on the record.
            ...(result.worktree ? { worktree: result.worktree } : {}),
            // A capped preview: children are stored in the run record, and
            // the full text already lives in the child's session.
            output: childPreview(result.response),
          };
          if (result.sessionId) childSessionIds[index] = result.sessionId;
          addUsage(usage, result.usage);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          children[index] = { label: item, status: 'failed', error: message };
          failures.push(`${item}: ${message}`);
        }
        publish();
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} of ${items.length} sub-agents failed — ${failures.join('; ')}`
      );
    }

    return {
      output: items.map((item, index) => `## ${item}\n\n${results[index] ?? ''}`).join('\n\n'),
      usage,
      childSessionIds: childSessionIds.filter((id): id is string => id !== undefined),
    };
  };
}

function addUsage(total: TokenUsage, usage?: TokenUsage): void {
  if (!usage) return;
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  if (usage.costUsd !== undefined) {
    total.costUsd = Number(((total.costUsd ?? 0) + usage.costUsd).toFixed(10));
  }
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

  const argv = command.trim().split(/\s+/);
  const executable = argv[0] ?? '';
  if (!allowlist.includes(executable)) {
    throw new Error(
      `shell command ${JSON.stringify(executable)} is not allowed; permitted commands: ${allowlist.join(', ')}`
    );
  }

  for (const argument of argv.slice(1)) {
    // `--flag=value` smuggles just as well as `--flag value`.
    const flag = argument.split('=')[0];
    if (SMUGGLING_FLAGS.includes(flag)) {
      throw new Error(
        `shell flag ${JSON.stringify(flag)} is not allowed for ${JSON.stringify(executable)}: ` +
          `it can execute code the allowlist does not cover`
      );
    }
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

/**
 * Write a node's content to a file in the workspace.
 *
 * The node type that makes a flow produce something. Every other type ends by
 * handing text to the next node; without this, that text's last stop is the run
 * record, which is build output nobody opens.
 *
 * Reuses `RunFileWriter` — the channel the run record already writes through —
 * so this needs no new host surface and no new permission. The path guard is
 * the real substance here; see `safeWorkspacePath`.
 */
export function createWriteFileExecutor(writer: RunFileWriter): NodeExecutor {
  return async (context: NodeExecutorContext) => {
    // Throws on an escape, so a refused path fails the node instead of quietly
    // writing somewhere else or reporting a success that never happened.
    const target = safeWorkspacePath(context.resolved.path ?? '');
    const content = context.resolved.content ?? '';

    await writer.write(target, content);

    return { output: `wrote ${target} (${content.length} characters)` };
  };
}
