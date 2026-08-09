import type { SessionUsageReader } from './nimbalystAgentClient';

/**
 * The host IPC surface this adapter needs. Declared structurally so the adapter
 * can be tested without Electron, and so every channel the extension touches is
 * visible in one place.
 */
export interface HostIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export interface NodeWorktree {
  id: string;
  path: string;
  branch: string;
}

/**
 * A branch name for a node's worktree: readable, legal, and unique per run.
 *
 * Two constraints, both learned the hard way. Worktrees are branched as
 * `worktree/<name>`, and git refnames reject the brackets a fan-out uses for
 * its sub-agents (`review[2]`) — so those become `review-2`. And the host
 * refuses a path it already has a row for, so a second run of the same flow
 * would fail every node on `Worktree path already exists in database`; the
 * suffix keeps runs from colliding with each other.
 */
function worktreeNameFor(nodeId: string): string {
  const base =
    nodeId
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'node';

  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export interface CreateSessionRequest {
  nodeId: string;
  title: string;
  /** Binds the session to a worktree so the node's work is isolated. */
  worktreeId?: string;
  model?: string;
}

/**
 * Worktree-isolated sessions for flow nodes.
 *
 * `services.ai.sendPrompt` always creates its own session and takes no
 * worktree, so a node cannot be isolated through it. These four host channels
 * do the same job with the pieces separated — create the worktree, create a
 * session bound to it, run the work, write the transcript back — which is what
 * makes per-node worktree isolation possible without changing core.
 *
 * Verified against a running app: `worktree:create` returns a real worktree,
 * `sessions:create` accepts its id, `sessions:get` reads that id back, and
 * `session:save` writes a transcript into the session.
 */
export class NimbalystSessionHost implements SessionUsageReader {
  constructor(
    private readonly ipc: HostIpc,
    private readonly workspacePath: string
  ) {}

  async createWorktree(nodeId: string): Promise<NodeWorktree> {
    const result = (await this.ipc.invoke('worktree:create', this.workspacePath, {
      name: worktreeNameFor(nodeId),
    })) as { success?: boolean; error?: string; worktree?: NodeWorktree };

    if (!result?.success || !result.worktree) {
      throw new Error(
        `could not create a worktree for node ${JSON.stringify(nodeId)}: ${result?.error ?? 'unknown error'}`
      );
    }
    return result.worktree;
  }

  async createSession(request: CreateSessionRequest): Promise<string> {
    const id = `flow-${request.nodeId}-${crypto.randomUUID()}`;
    const result = (await this.ipc.invoke('sessions:create', {
      session: {
        id,
        title: request.title,
        provider: 'claude-code',
        mode: 'agent',
        worktreeId: request.worktreeId ?? null,
        ...(request.model ? { model: request.model } : {}),
      },
      workspaceId: this.workspacePath,
    })) as { success?: boolean; error?: string; id?: string };

    if (!result?.success) {
      throw new Error(
        `could not create a session for node ${JSON.stringify(request.nodeId)}: ${result?.error ?? 'unknown error'}`
      );
    }
    return result.id ?? id;
  }

  /** Record what the node asked and what came back, so the run is reviewable. */
  async saveTranscript(sessionId: string, prompt: string, response: string): Promise<void> {
    await this.ipc.invoke('session:save', {
      id: sessionId,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: response },
      ],
    });
  }

  async getTokenUsage(
    sessionId: string
  ): Promise<{ inputTokens: number; outputTokens: number } | undefined> {
    const result = (await this.ipc.invoke('sessions:get', sessionId)) as {
      session?: { tokenUsage?: { inputTokens?: number; outputTokens?: number } };
    };
    const usage = result?.session?.tokenUsage;
    if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) {
      return undefined;
    }
    return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
  }
}
