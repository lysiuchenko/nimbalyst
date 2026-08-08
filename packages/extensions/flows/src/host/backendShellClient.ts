import type { ExtensionAIService } from '@nimbalyst/extension-sdk';
import type { ShellClient, ShellRunRequest, ShellRunResult } from '../runner/ports';

/**
 * `ShellClient` backed by the flows backend module.
 *
 * The renderer cannot spawn processes, so the command goes to the extension's
 * own utility-process module through `callBackendTool`. The allowlist travels
 * with the request and is enforced again on the far side — this side's check is
 * a fast failure, the backend's is the boundary.
 */
export class BackendShellClient implements ShellClient {
  constructor(
    private readonly ai: ExtensionAIService,
    private readonly allowlist: readonly string[],
    private readonly workspacePath?: string
  ) {}

  async run(request: ShellRunRequest, signal: AbortSignal): Promise<ShellRunResult> {
    if (signal.aborted) {
      throw new Error(`node ${JSON.stringify(request.nodeId)} was cancelled before it started`);
    }

    const result = (await this.ai.callBackendTool(
      'flows.runShell',
      {
        nodeId: request.nodeId,
        command: request.command,
        ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
        allowlist: [...this.allowlist],
      },
      this.workspacePath
    )) as ShellRunResult;

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? -1,
    };
  }
}
