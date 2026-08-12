import type { TokenUsage, WorktreeRef } from './types';

/**
 * Ports the executors depend on.
 *
 * Every capability a node needs from outside the extension — running an agent,
 * running a command, asking a human — is expressed here as an interface. The
 * Claude Agent SDK is reached only through `AgentClient`, so no executor and no
 * UI module ever imports it directly.
 */

export interface AgentRunRequest {
  /** Which node type asked, for session naming and host routing. */
  kind: 'agent' | 'slash-command' | 'skill';
  nodeId: string;
  sessionName: string;
  prompt: string;
  model?: string | null;
  /** Tool allowlist for this node. Undefined means "host default". */
  tools?: string[];
  /** Run this node in its own git worktree. */
  worktree?: boolean;
}

export type { WorktreeRef } from './types';

export interface AgentRunResult {
  sessionId: string;
  response: string;
  usage?: TokenUsage;
  /** Present when the node asked for isolation and got it. */
  worktree?: WorktreeRef;
}

/**
 * What an agent client can actually honor.
 *
 * Both of these are safety properties a flow author is entitled to rely on, so
 * a client that cannot deliver one must say so rather than let the executor
 * quietly run the node without it.
 */
export interface AgentCapabilities {
  /** Can run the node in its own git worktree. */
  worktree?: boolean;
  /** Can enforce the node's `tools` allowlist. */
  tools?: boolean;
}

export interface AgentClient {
  /** Absent means "neither" — the safe default for a client that says nothing. */
  readonly capabilities?: AgentCapabilities;
  run(request: AgentRunRequest, signal: AbortSignal): Promise<AgentRunResult>;
}

export interface ShellRunRequest {
  nodeId: string;
  command: string;
  cwd?: string;
}

export interface ShellRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellClient {
  run(request: ShellRunRequest, signal: AbortSignal): Promise<ShellRunResult>;
}

export interface GateRequest {
  nodeId: string;
  message: string;
}

export type GateDecision = 'approved' | 'rejected';

export interface GateController {
  requestApproval(request: GateRequest, signal: AbortSignal): Promise<GateDecision>;
}
