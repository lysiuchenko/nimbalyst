import type { AgentClient, AgentRunRequest, AgentRunResult, ShellClient, ShellRunRequest, ShellRunResult } from './ports';

/**
 * The stub clients behind Dry run.
 *
 * A rehearsal executes the flow's *logic* — routing, conditions, joins,
 * references, gate placement — with every external effect replaced by an
 * instant, clearly-labelled stand-in. Nothing is spent, nothing is written,
 * nothing survives.
 */

/**
 * Answers instantly with a labelled placeholder.
 *
 * Claims every capability on purpose: `assertCapableFor` exists to stop a
 * *real* run from silently dropping isolation or an allowlist, and in a
 * rehearsal nothing runs at all — refusing here would make worktree flows
 * un-rehearsable for no protective gain.
 */
export function dryAgentClient(): AgentClient {
  return {
    capabilities: { worktree: true, tools: true },
    run: async (request: AgentRunRequest): Promise<AgentRunResult> => ({
      // No session: there is nothing to open.
      sessionId: '',
      response: `[dry-run] ${request.sessionName}`,
    }),
  };
}

/** Reports what it would run; never runs it. Always "succeeds" — a rehearsal
 * cannot know exit codes, and failure-path rehearsal is the gate's job. */
export function dryShellClient(): ShellClient {
  return {
    run: async (request: ShellRunRequest): Promise<ShellRunResult> => ({
      stdout: `[dry-run] would run: ${request.command}`,
      stderr: '',
      exitCode: 0,
    }),
  };
}
