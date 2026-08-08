// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { activate } from '../index';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-backend-'));

async function methods() {
  const api = await activate({
    services: {
      workspacePath: workspace,
      log: () => {},
      registerMcpTools: async () => undefined,
    },
  });
  return api.methods;
}

describe('flows.runShell', () => {
  it('runs a real command and returns its output and exit code', async () => {
    const result = await (await methods()).runShell({
      nodeId: 'n',
      command: 'echo hello-from-flows',
      allowlist: ['echo'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-from-flows');
  });

  it('reports the real exit code of a failing command', async () => {
    const result = await (await methods()).runShell({
      nodeId: 'n',
      command: 'sh -c "exit 3"',
      allowlist: ['sh'],
    });

    expect(result.exitCode).toBe(3);
  });

  it('captures stderr separately from stdout', async () => {
    const result = await (await methods()).runShell({
      nodeId: 'n',
      command: 'sh -c "echo oops 1>&2"',
      allowlist: ['sh'],
    });

    expect(result.stderr.trim()).toBe('oops');
    expect(result.stdout.trim()).toBe('');
  });

  it('runs in the workspace by default', async () => {
    const result = await (await methods()).runShell({
      nodeId: 'n',
      command: 'pwd',
      allowlist: ['pwd'],
    });

    expect(fs.realpathSync(result.stdout.trim())).toBe(fs.realpathSync(workspace));
  });

  it('runs in a subdirectory when the node asks for one', async () => {
    fs.mkdirSync(path.join(workspace, 'sub'), { recursive: true });

    const result = await (await methods()).runShell({
      nodeId: 'n',
      command: 'pwd',
      cwd: 'sub',
      allowlist: ['pwd'],
    });

    expect(fs.realpathSync(result.stdout.trim())).toBe(
      fs.realpathSync(path.join(workspace, 'sub'))
    );
  });

  it('re-checks the allowlist in the backend, not only in the renderer', async () => {
    await expect(
      (await methods()).runShell({ nodeId: 'n', command: 'echo hi', allowlist: ['npm'] })
    ).rejects.toThrow('shell command "echo" is not allowed');
  });

  it('refuses a cwd that escapes the workspace', async () => {
    await expect(
      (await methods()).runShell({
        nodeId: 'n',
        command: 'pwd',
        cwd: '../..',
        allowlist: ['pwd'],
      })
    ).rejects.toThrow('cwd must stay inside the workspace');
  });

  it('keeps a quoted argument together instead of splitting it on spaces', async () => {
    const result = await (await methods()).runShell({
      nodeId: 'n',
      command: 'echo "two words" \'and more\'',
      allowlist: ['echo'],
    });

    expect(result.stdout.trim()).toBe('two words and more');
  });

  it('refuses a cwd that reaches outside via a symlink, not just via ..', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-outside-'));
    const link = path.join(workspace, 'escape');
    fs.rmSync(link, { force: true });
    fs.symlinkSync(outside, link, 'dir');

    await expect(
      (await methods()).runShell({ nodeId: 'n', command: 'pwd', cwd: 'escape', allowlist: ['pwd'] })
    ).rejects.toThrow('cwd must stay inside the workspace');

    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('does not run the command through a shell, so metacharacters are inert', async () => {
    const result = await (await methods()).runShell({
      nodeId: 'n',
      command: 'echo a && echo b',
      allowlist: ['echo'],
    });

    // `&&` arrives as a literal argument to echo rather than chaining a second
    // command, because there is no shell to interpret it.
    expect(result.stdout.trim()).toBe('a && echo b');
  });
});
