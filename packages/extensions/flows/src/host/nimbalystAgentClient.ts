import type { ExtensionAIService } from '@nimbalyst/extension-sdk';
import type { AgentClient, AgentRunRequest, AgentRunResult } from '../runner/ports';

/**
 * `AgentClient` backed by the host's AI service.
 *
 * This is the only module in the extension that touches Nimbalyst's agent
 * plumbing. `services.ai.sendPrompt` runs the prompt through the host's
 * Claude Code provider — which is where the Claude Agent SDK actually lives —
 * and creates a real session, so every flow node shows up in the session list
 * with the host's own worktree and permission handling.
 *
 * `sendPrompt` itself returns no usage, so token counts are read back off the
 * session it created. It takes no tool allowlist, so a node's `tools` is still
 * unhonored — see docs/editorhost-notes.md §5b. A node's `worktree` is honored
 * when a worktree host is supplied: this client creates the checkout and hands
 * its id to `sendPrompt`, which binds the session the host creates to it.
 */
export interface SessionUsageReader {
  getTokenUsage(
    sessionId: string
  ): Promise<{ inputTokens: number; outputTokens: number } | undefined>;
}

export interface NodeWorktreeCreator {
  createWorktree(nodeId: string): Promise<{ id: string }>;
}

export class NimbalystAgentClient implements AgentClient {
  /**
   * A tool allowlist is still not available through `sendPrompt`, and this
   * client deliberately does not try to provide one by running its own agent:
   * the host strips API keys from three env sources and resolves the CLI binary
   * through its own fallback policy, all of it written after a real billing
   * incident. Re-implementing that here would put credential handling in an
   * extension that will not inherit the host's future fixes. Declaring the
   * limit instead makes the executor fail such nodes loudly.
   */
  readonly capabilities: { worktree: boolean; tools: boolean };

  constructor(
    private readonly ai: ExtensionAIService,
    private readonly sessions?: SessionUsageReader,
    private readonly worktrees?: NodeWorktreeCreator
  ) {
    this.capabilities = { worktree: worktrees !== undefined, tools: false };
  }

  async run(request: AgentRunRequest, signal: AbortSignal): Promise<AgentRunResult> {
    if (signal.aborted) {
      throw new Error(`node ${JSON.stringify(request.nodeId)} was cancelled before it started`);
    }

    // Created before the prompt is sent: a node that asked for isolation and
    // cannot get it must fail, never quietly edit the main working tree.
    const worktree =
      request.worktree === true ? await this.worktrees?.createWorktree(request.nodeId) : undefined;

    const { sessionId, response } = await this.ai.sendPrompt({
      prompt: request.prompt,
      sessionName: `Flow: ${request.sessionName}`,
      provider: 'claude-code',
      ...(request.model ? { model: request.model } : {}),
      ...(worktree ? { worktreeId: worktree.id } : {}),
    });

    const usage = await this.readUsage(sessionId);
    return usage ? { sessionId, response, usage } : { sessionId, response };
  }

  /**
   * Usage is reporting, not result: a node that did its work must not be failed
   * because the session lookup did.
   */
  private async readUsage(sessionId: string): Promise<AgentRunResult['usage']> {
    if (!this.sessions) return undefined;
    try {
      const usage = await this.sessions.getTokenUsage(sessionId);
      if (!usage) return undefined;
      return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    } catch {
      return undefined;
    }
  }
}
