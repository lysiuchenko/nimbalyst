import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * The headless CLI, exercised as a user would: the built binary, from a shell,
 * with no app running. Fast enough to be worth covering every command.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'dist', 'nimbalyst-flows.js');

function workspace(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-cli-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), `${JSON.stringify(content, null, 2)}\n`);
  }
  return dir;
}

/** Records only: the directory also holds the `.gitignore` that keeps them local. */
function runRecords(dir: string): string[] {
  return fs
    .readdirSync(path.join(dir, '.flow-runs'))
    .filter((name) => name.startsWith('run-') && name.endsWith('.json'));
}

function run(args: string[], cwd: string): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

const shellFlow = {
  version: 1,
  name: 'cli-smoke',
  nodes: [{ id: 'greet', type: 'shell', run: 'echo hello-{{who}}', output: 'greeting' }],
  edges: [],
  variables: { who: 'world' },
};

const agentFlow = {
  version: 1,
  name: 'needs-an-agent',
  nodes: [{ id: 'plan', type: 'agent', prompt: 'Plan it' }],
  edges: [],
  variables: {},
};

const gateFlow = {
  version: 1,
  name: 'has-a-gate',
  nodes: [{ id: 'ok', type: 'human-gate', message: 'Ship it?' }],
  edges: [],
  variables: {},
};

test.describe('the headless CLI', () => {
  test('runs a shell flow with no app in sight', () => {
    const dir = workspace({ 'smoke.flow.json': shellFlow });

    const result = run(['run', 'smoke.flow.json'], dir);

    expect(result.status).toBe(0);
    expect(result.out).toContain('done');
    expect(runRecords(dir).length).toBeGreaterThan(0);
  });

  test('substitutes a variable given on the command line', () => {
    const dir = workspace({ 'smoke.flow.json': shellFlow });

    run(['run', 'smoke.flow.json', '--var', 'who=ci'], dir);

    const [name] = runRecords(dir);
    const record = JSON.parse(fs.readFileSync(path.join(dir, '.flow-runs', name), 'utf8'));
    expect(JSON.stringify(record.outputs)).toContain('hello-ci');
  });

  test('validates a good flow without running it', () => {
    const dir = workspace({ 'smoke.flow.json': shellFlow });

    const result = run(['validate', 'smoke.flow.json'], dir);

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(dir, '.flow-runs'))).toBe(false);
  });

  test('rejects an invalid flow with the bad-usage code', () => {
    const dir = workspace({
      'broken.flow.json': { version: 1, name: '', nodes: [], edges: [], variables: {} },
    });

    const result = run(['validate', 'broken.flow.json'], dir);

    expect(result.status).toBe(2);
    expect(result.out).toContain('name');
  });

  test('refuses an agent flow rather than pretending to run it', () => {
    const dir = workspace({ 'agent.flow.json': agentFlow });

    const result = run(['run', 'agent.flow.json'], dir);

    expect(result.status).not.toBe(0);
    expect(result.out).toContain('headless');
  });

  test('fails a gate in CI unless told to approve', () => {
    const dir = workspace({ 'gate.flow.json': gateFlow });

    // A gate exists so a person sees it; auto-approving by default would make
    // it a no-op the first time a flow ran unattended.
    expect(run(['run', 'gate.flow.json'], dir).status).not.toBe(0);
    expect(run(['run', 'gate.flow.json', '--approve-gates'], dir).status).toBe(0);
  });

  test('compiles a flow to a slash command', () => {
    const dir = workspace({ 'smoke.flow.json': shellFlow });

    const result = run(['compile', 'smoke.flow.json'], dir);

    expect(result.status).toBe(0);
    const command = path.join(dir, '.claude', 'commands', 'flow-cli-smoke.md');
    expect(fs.existsSync(command)).toBe(true);
    expect(fs.readFileSync(command, 'utf8')).toContain('echo hello-{{who}}');
  });

  test('explains itself when asked for help', () => {
    const dir = workspace({});

    const result = run(['--help'], dir);

    expect(result.out).toContain('nimbalyst-flows run');
  });

  test('lists what is scheduled, and what cannot run out here', () => {
    const dir = workspace({
      'nightly.flow.json': {
        ...shellFlow,
        name: 'nightly',
        schedule: { type: 'interval', intervalMinutes: 60, enabled: true },
      },
      'thinking.flow.json': {
        ...agentFlow,
        schedule: { type: 'interval', intervalMinutes: 60, enabled: true },
      },
    });

    const result = run(['schedule', 'list'], dir);

    expect(result.status).toBe(0);
    expect(result.out).toContain('nightly');
    // Agent work is called out before it comes due, not after it fails.
    expect(result.out).toMatch(/needs-an-agent.*needs the app/s);
  });

  test('anchors a due time, then runs the flow once it passes', () => {
    const dir = workspace({
      'nightly.flow.json': {
        ...shellFlow,
        name: 'nightly',
        schedule: { type: 'interval', intervalMinutes: 60, enabled: true },
      },
    });

    // First pass writes the deadline down; without that it would be recomputed
    // forever and the flow would never come due.
    expect(run(['schedule', 'run'], dir).out).toContain('Nothing is due');
    const statePath = path.join(dir, '.flow-runs', 'nightly.flow.json.schedule.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(state.dueAt).toBeGreaterThan(Date.now());

    fs.writeFileSync(statePath, JSON.stringify({ ...state, dueAt: Date.now() - 1_000 }));
    const second = run(['schedule', 'run'], dir);

    expect(second.status).toBe(0);
    expect(second.out).toContain('nightly: running');
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).lastOutcome).toBe('done');
  });

  test('says so when nothing here is scheduled', () => {
    const dir = workspace({ 'smoke.flow.json': shellFlow });

    expect(run(['schedule', 'list'], dir).out).toContain('No flow');
  });
});
