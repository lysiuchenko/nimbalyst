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

runHeadless(
  argv.filter((arg) => arg !== '--approve-gates'),
  {
    readFile: (file) => fs.readFile(file, 'utf-8'),
    writeFile: async (file, content) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf-8');
    },
    shell,
    allowlist,
    approveGates: argv.includes('--approve-gates'),
    log: (message) => console.log(message),
  }
)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
