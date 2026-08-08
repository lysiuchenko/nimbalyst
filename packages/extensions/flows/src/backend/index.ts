/**
 * Flows — backend module.
 *
 * Runs in an Electron utility-process (outside main and the renderer), which is
 * the only place extension code gets Node. That is what makes `shell` nodes
 * possible at all: the renderer has no `child_process`, and the host's
 * `terminal:*` channels are a PTY with no per-command exit code.
 *
 * Commands are spawned WITHOUT a shell, so metacharacters cannot chain a second
 * command, and the allowlist is re-checked here — the renderer's check is a
 * convenience, this one is the boundary.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';

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

        const cwd = resolveCwd(workspacePath, params.cwd);
        log('info', `[flows] node ${params.nodeId} running ${executable}`, { cwd });

        return await spawnCapture(executable, argv.slice(1), cwd);
      },
    },
  };
}

/**
 * Split a command line into argv, honoring single and double quotes.
 *
 * Quoting is the one shell convenience worth keeping — `--grep "two words"` is
 * ordinary usage. Nothing else is interpreted: no expansion, no substitution,
 * no operators, because the result is passed to `spawn` without a shell.
 */
function tokenize(command: string): string[] {
  const argv: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const character of command.trim()) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started || current) argv.push(current);
      current = '';
      started = false;
      continue;
    }
    current += character;
    started = true;
  }
  if (started || current) argv.push(current);

  return argv;
}

/** Keep a node's working directory inside the workspace, symlinks included. */
function resolveCwd(workspacePath: string, requested?: string): string {
  if (!requested) return workspacePath;

  const resolved = path.resolve(workspacePath, requested);
  const relative = path.relative(workspacePath, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`cwd must stay inside the workspace, got ${JSON.stringify(requested)}`);
  }
  return resolved;
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
