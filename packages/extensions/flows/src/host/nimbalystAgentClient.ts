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
 * Known limits of the host API, both recorded in docs/editorhost-notes.md:
 *   - `sendPrompt` returns no token usage, so `usage` is left undefined here
 *     rather than invented. Per-node cost has to be read back from the session.
 *   - `sendPrompt` takes no per-call tool allowlist or worktree flag, so a
 *     node's `tools` and `worktree` cannot yet be honored per node.
 */
export class NimbalystAgentClient implements AgentClient {
  constructor(private readonly ai: ExtensionAIService) {}

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

    return { sessionId, response };
  }
}
