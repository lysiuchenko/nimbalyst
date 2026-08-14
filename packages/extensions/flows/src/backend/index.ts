/**
 * Flows — backend module.
 *
 * Runs in an Electron utility-process (outside main and the renderer), which is
 * the only place extension code gets Node. That is what makes `shell` nodes
 * possible at all: the renderer has no `child_process`, and the host's
 * `terminal:*` channels are a PTY with no per-command exit code.
 *
 * Commands are spawned WITHOUT a shell, so metacharacters cannot chain a second
 * command, and both the allowlist and the smuggling-flag policy are enforced
 * here on the tokenized argv — the renderer's check is a convenience, this one
 * is the boundary.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertArgvSafe, tokenize } from '../runner/shellPolicy';

const SPAWN_TIMEOUT_MS = 10 * 60 * 1000;

interface ActivateContext {
  services: {
    workspacePath: string;
    log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => void;
    /**
     * Advertises this module's methods to the host. Until a method is
     * registered, `callBackendTool` reports it as "not available to this
     * extension" — the host namespaces the name as `<extension>.<method>`,
     * so `runShell` is reached from the renderer as `flows.runShell`.
     */
    registerMcpTools?: (
      tools: {
        name: string;
        description?: string;
        inputSchema?: unknown;
        scope?: 'global' | 'workspace';
      }[]
    ) => Promise<unknown>;
  };
}

export interface RunShellParams {
  nodeId: string;
  command: string;
  cwd?: string;
  allowlist: string[];
}

export interface RunShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function activate(ctx: ActivateContext) {
  const { workspacePath, log, registerMcpTools } = ctx.services;

  await registerMcpTools?.([
    {
      name: 'runShell',
      description: "Run one allowlisted shell command for a flow's shell node.",
      inputSchema: {
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          command: { type: 'string' },
          cwd: { type: 'string' },
          allowlist: { type: 'array', items: { type: 'string' } },
        },
        required: ['nodeId', 'command', 'allowlist'],
      },
      scope: 'workspace',
    },
  ]);

  return {
    methods: {
      runShell: async (params: RunShellParams): Promise<RunShellResult> => {
        const argv = tokenize(params.command);
        const executable = argv[0] ?? '';

        if (!params.allowlist.includes(executable)) {
          throw new Error(
            `shell command ${JSON.stringify(executable)} is not allowed; permitted commands: ${
              params.allowlist.join(', ') || '(none)'
            }`
          );
        }

        // The boundary, not the renderer, is where the smuggling-flag policy has
        // to hold — and on the tokenized argv, because that is what gets spawned.
        assertArgvSafe(argv.slice(1));

        const cwd = resolveCwd(workspacePath, params.cwd);
        log('info', `[flows] node ${params.nodeId} running ${executable}`, { cwd });

        return await spawnCapture(executable, argv.slice(1), cwd);
      },
    },
  };
}

/**
 * Keep a node's working directory inside the workspace.
 *
 * The containment check runs on the REAL path: `path.resolve` is lexical, so a
 * symlink inside the workspace pointing outside it would pass a purely textual
 * check and then run somewhere else entirely.
 */
function resolveCwd(workspacePath: string, requested?: string): string {
  const workspaceReal = realPath(workspacePath);
  if (!requested) return workspaceReal;

  const resolved = realPath(path.resolve(workspaceReal, requested));
  const relative = path.relative(workspaceReal, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`cwd must stay inside the workspace, got ${JSON.stringify(requested)}`);
  }
  return resolved;
}

/** Resolve symlinks where the path exists; a missing path cannot be escaped through. */
function realPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function spawnCapture(executable: string, args: string[], cwd: string): Promise<RunShellResult> {
  return new Promise((resolve, reject) => {
    // `shell: false` is the security property: the command line is never handed
    // to a shell, so `&&`, `;`, `$(…)` and backticks are inert argument text.
    const child = spawn(executable, args, { cwd, shell: false });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`shell command timed out after ${SPAWN_TIMEOUT_MS}ms`));
    }, SPAWN_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}
