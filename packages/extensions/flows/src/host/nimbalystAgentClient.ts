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
  ): Promise<{ inputTokens: number; outputTokens: number; costUsd?: number } | undefined>;
  /** Whether the session is sitting on a tool-permission prompt. */
  hasPendingPermission?(sessionId: string): Promise<boolean>;
}

export interface NodeWorktreeCreator {
  /**
   * The full shape, not just the id: the branch and path are what make the
   * checkout findable on the run record after the session is gone.
   */
  createWorktree(nodeId: string): Promise<{ id: string; branch: string; path: string }>;
}

export class NimbalystAgentClient implements AgentClient {
  /**
   * Both are now carried by `sendPrompt`: a tool allowlist rides on the
   * session's provider config, and a worktree needs a host that can create one.
   */
  readonly capabilities: { worktree: boolean; tools: boolean };

  constructor(
    private readonly ai: ExtensionAIService,
    private readonly sessions?: SessionUsageReader,
    private readonly worktrees?: NodeWorktreeCreator
  ) {
    this.capabilities = { worktree: worktrees !== undefined, tools: true };
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
      // Per step: a flow can draft on one CLI and review on another. Codex
      // steps refuse a tools allowlist at validation, because that provider
      // does not honor one.
      provider: request.provider ?? 'claude-code',
      // Sessions persist `planning` or `agent` only; `auto` is an *effective*
      // mode the host derives from workspace trust, so a flow cannot request it
      // — and should not, since that would decide permissions on the user's
      // behalf. Flows inherit the project's trust level.
      mode: 'agent',
      // The flow reports at run level — gates, completion — not once per step.
      suppressTurnNotification: true,
      ...(request.model ? { model: request.model } : {}),
      ...(request.effortLevel ? { effortLevel: request.effortLevel } : {}),
      ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
      ...(worktree ? { worktreeId: worktree.id } : {}),
    });

    // An empty answer is the shape a blocked step takes: the agent asked for
    // tool permission, nobody was there to answer, and the turn ended with no
    // text. Reporting that as success publishes "" to every downstream node.
    if (response.trim() === '' && (await this.blockedOnPermission(sessionId))) {
      throw new Error(
        `node ${JSON.stringify(request.nodeId)} is waiting for tool permission and nothing answered it. ` +
          `Trust this project (Settings > project trust) so its steps can run unattended, ` +
          `or run the flow with the session open so you can approve.`
      );
    }

    const usage = await this.readUsage(sessionId);
    return {
      sessionId,
      response,
      ...(usage ? { usage } : {}),
      // The branch is how the work is found again after the run; without it the
      // record never learns the checkout existed.
      ...(worktree ? { worktree } : {}),
    };
  }

  private async blockedOnPermission(sessionId: string): Promise<boolean> {
    try {
      return (await this.sessions?.hasPendingPermission?.(sessionId)) === true;
    } catch {
      // Never turn a diagnostic lookup into the reason a node failed.
      return false;
    }
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
      return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      };
    } catch {
      return undefined;
    }
  }
}
