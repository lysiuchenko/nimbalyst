/**
 * `nimbalyst-flows` entry point. The shebang is added by vite.cli.config.ts.
 *
 * A thin shell: real file I/O and a real subprocess runner, wired into the same
 * `runHeadless` the tests drive with fakes.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runHeadless } from './runHeadless';
import type { ShellClient } from '../runner/ports';
import { launchAgentPath, launchAgentPlist, labelFor, logPathFor } from '../schedule/launchAgent';
import type { ScheduleDeps } from './scheduleCommand';

/** Same default as the editor. Override with FLOWS_SHELL_ALLOWLIST. */
const DEFAULT_ALLOWLIST = ['npm', 'npx', 'node', 'git', 'echo', 'ls', 'pwd', 'cat'];

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

const shell: ShellClient = {
  run: (request) =>
    new Promise((resolve, reject) => {
      const argv = tokenize(request.command);
      // No shell, same as the in-app backend module: operators stay inert.
      const child = spawn(argv[0], argv.slice(1), {
        cwd: request.cwd ? path.resolve(process.cwd(), request.cwd) : process.cwd(),
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    }),
};

const allowlist = process.env.FLOWS_SHELL_ALLOWLIST
  ? process.env.FLOWS_SHELL_ALLOWLIST.split(',').map((entry) => entry.trim()).filter(Boolean)
  : DEFAULT_ALLOWLIST;

const argv = process.argv.slice(2);

/** `launchctl`, as a promise, so install/uninstall can report what happened. */
function launchctl(...args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('launchctl', args, { shell: false });
    let output = '';
    child.stdout?.on('data', (chunk) => (output += String(chunk)));
    child.stderr?.on('data', (chunk) => (output += String(chunk)));
    child.on('error', (error) => resolve({ code: -1, output: String(error) }));
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
}

const workspace = process.cwd();

const schedule: ScheduleDeps = {
  listFlows: async () => {
    const names = await fs.readdir(workspace);
    return names.filter((name) => name.endsWith('.flow.json'));
  },
  readFile: (file) => fs.readFile(file, 'utf-8'),
  writeFile: async (file, content) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf-8');
  },
  // One flow at a time: a scheduled batch competing for the same working tree
  // is the same hazard the in-app scheduler refuses.
  runFlow: async (flowPath) => {
    const code = await runHeadless(['run', flowPath], baseDeps);
    return code === 0;
  },

  installAgent: async (everyMinutes) => {
    if (process.platform !== 'darwin') {
      return 'schedule install only supports macOS launchd for now.';
    }
    const target = launchAgentPath(workspace);
    const plist = launchAgentPlist({
      workspace,
      cliPath: process.argv[1],
      nodePath: process.execPath,
      everyMinutes,
    });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, plist, 'utf-8');

    // `bootout` first so re-installing picks up a changed interval.
    await launchctl('bootout', `gui/${process.getuid?.() ?? ''}/${labelFor(workspace)}`);
    const loaded = await launchctl('bootstrap', `gui/${process.getuid?.() ?? ''}`, target);
    if (loaded.code !== 0) {
      return `Wrote ${target}, but launchctl refused it: ${loaded.output.trim()}`;
    }
    return `Scheduled flows will run every ${everyMinutes}m while Nimbalyst is closed.\n  agent: ${target}\n  log:   ${logPathFor(workspace)}`;
  },

  uninstallAgent: async () => {
    const target = launchAgentPath(workspace);
    await launchctl('bootout', `gui/${process.getuid?.() ?? ''}/${labelFor(workspace)}`);
    await fs.rm(target, { force: true });
    return `Removed ${target}.`;
  },

  log: (message) => console.log(message),
};

const baseDeps = {
  readFile: (file: string) => fs.readFile(file, 'utf-8'),
  writeFile: async (file: string, content: string) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf-8');
  },
  shell,
  allowlist,
  approveGates: argv.includes('--approve-gates'),
  log: (message: string) => console.log(message),
};

runHeadless(
  argv.filter((arg) => arg !== '--approve-gates'),
  { ...baseDeps, schedule }
)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
