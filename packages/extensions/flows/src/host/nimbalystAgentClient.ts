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
 * session it created. It also takes no tool allowlist and no worktree, so a
 * node's `tools` and `worktree` are still unhonored — see
 * docs/editorhost-notes.md §5b.
 */
export interface SessionUsageReader {
  getTokenUsage(
    sessionId: string
  ): Promise<{ inputTokens: number; outputTokens: number } | undefined>;
}

export class NimbalystAgentClient implements AgentClient {
  constructor(
    private readonly ai: ExtensionAIService,
    private readonly sessions?: SessionUsageReader
  ) {}

  async run(request: AgentRunRequest, signal: AbortSignal): Promise<AgentRunResult> {
    if (signal.aborted) {
      throw new Error(`node ${JSON.stringify(request.nodeId)} was cancelled before it started`);
    }

    const { sessionId, response } = await this.ai.sendPrompt({
      prompt: request.prompt,
      sessionName: `Flow: ${request.sessionName}`,
      provider: 'claude-code',
      ...(request.model ? { model: request.model } : {}),
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
