import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createWorkspace, launchFlowsApp, nodeStatuses, openFlow, type FlowsApp } from './helpers';
import { nodeDefinitionHash } from '../src/runner/resume';

/**
 * History and dashboard behaviour, driven by seeded run records.
 *
 * Records are fixtures rather than the product of a live run: an agent turn
 * costs money, takes minutes and produces different numbers every time, none of
 * which makes for a test that can assert an exact figure.
 */

const flow = {
  version: 1,
  name: 'seeded',
  nodes: [
    { id: 'plan', type: 'agent', prompt: 'Plan it', output: 'plan_md' },
    { id: 'approve', type: 'human-gate', message: 'Approve?' },
    { id: 'review', type: 'fan-out', prompt: 'Review {{item}}', over: 'a\nb' },
  ],
  edges: [
    { from: 'plan', to: 'approve', port: 'plan_md' },
    { from: 'approve', to: 'review' },
  ],
  variables: {},
};

const HOUR = 3_600_000;
const base = Date.now() - 2 * HOUR;

/** flowPath is absolute in a record, so it is filled in once the workspace exists. */
const record = (over: Record<string, unknown>) => ({
  runId: 'run-seed',
  flowName: 'seeded',
  status: 'done',
  startedAt: base,
  finishedAt: base + 60_000,
  updatedAt: base + 60_000,
  nodes: {},
  outputs: {},
  usage: { inputTokens: 0, outputTokens: 0 },
  sessionIds: [],
  ...over,
});

const finished = record({
  runId: 'run-finished',
  status: 'done',
  nodes: {
    plan: { nodeId: 'plan', type: 'agent', status: 'done', startedAt: base, finishedAt: base + 120_000 },
    approve: {
      nodeId: 'approve',
      type: 'human-gate',
      status: 'done',
      startedAt: base + 120_000,
      finishedAt: base + 420_000,
    },
    review: {
      nodeId: 'review',
      type: 'fan-out',
      status: 'done',
      startedAt: base + 420_000,
      finishedAt: base + 480_000,
      childSessionIds: ['child-a', 'child-b'],
      // Worktree-isolated sub-agents: the branches must survive onto the
      // record and render as chips. The paths do not exist, which is the
      // degrade case a reviewer hits once checkouts are cleaned up.
      children: [
        {
          label: 'a',
          status: 'done',
          sessionId: 'child-a',
          worktree: { id: 'wt-a', branch: 'flow/review-0-ab12', path: '/nowhere/wt-a' },
          output: 'a: two nits, no blockers',
        },
        {
          label: 'b',
          status: 'done',
          sessionId: 'child-b',
          worktree: { id: 'wt-b', branch: 'flow/review-1-cd34', path: '/nowhere/wt-b' },
          output: 'b: clean',
        },
      ],
    },
  },
  usage: { inputTokens: 1_000, outputTokens: 200 },
  sessionIds: ['session-main', 'child-a', 'child-b'],
  manualBaselineMinutes: 90,
});

const failed = record({
  runId: 'run-failed',
  status: 'failed',
  startedAt: base + HOUR,
  finishedAt: base + HOUR + 5_000,
  updatedAt: base + HOUR + 5_000,
  nodes: {
    plan: { nodeId: 'plan', type: 'agent', status: 'done', startedAt: base + HOUR, finishedAt: base + HOUR + 1_000 },
    approve: {
      nodeId: 'approve',
      type: 'human-gate',
      status: 'failed',
      error: 'rejected by the reviewer',
      startedAt: base + HOUR + 1_000,
      finishedAt: base + HOUR + 5_000,
    },
    review: { nodeId: 'review', type: 'fan-out', status: 'skipped' },
  },
});

/** Left mid-run by an app that went away — the record still claims to be running. */
const stranded = record({
  runId: 'run-stranded',
  status: 'running',
  startedAt: base,
  finishedAt: undefined,
  updatedAt: base,
  nodes: {
    plan: { nodeId: 'plan', type: 'agent', status: 'done', startedAt: base, finishedAt: base + 1_000 },
    approve: { nodeId: 'approve', type: 'human-gate', status: 'running', startedAt: base + 1_000 },
    review: { nodeId: 'review', type: 'fan-out', status: 'queued' },
  },
});

/** A real in-flight run, recent enough that it must not be called abandoned. */
const active = record({
  runId: 'run-active',
  flowName: 'active',
  status: 'running',
  startedAt: Date.now() - 30_000,
  finishedAt: undefined,
  updatedAt: Date.now(),
  nodes: {},
});

const mixedAbsolute = record({
  runId: 'run-mixed-absolute',
  flowName: 'mixed',
  startedAt: base - 2 * HOUR,
  updatedAt: base - 2 * HOUR,
});

const mixedRelative = record({
  runId: 'run-mixed-relative',
  flowName: 'mixed',
  startedAt: base - 3 * HOUR,
  updatedAt: base - 3 * HOUR,
});

/** A node that finished but published nothing into its declared port. */
const warned = record({
  runId: 'run-warned',
  status: 'done',
  startedAt: base - HOUR,
  finishedAt: base - HOUR + 2_000,
  updatedAt: base - HOUR + 2_000,
  nodes: {
    plan: {
      nodeId: 'plan',
      type: 'agent',
      status: 'done',
      startedAt: base - HOUR,
      finishedAt: base - HOUR + 2_000,
      warning: 'published an empty plan_md — downstream nodes will read "" from {{plan.plan_md}}',
    },
  },
});

function workspaceWithRuns(): string {
  const quietDueAt = Date.now() + 30 * 60_000;
  const workspace = createWorkspace({
    'seeded.flow.json': flow,
    // Never run, so it exists only as a file — the case the panel could not
    // represent when it derived its list from run records alone.
    'quiet.flow.json': {
      ...flow,
      name: 'quiet',
      schedule: { type: 'interval', intervalMinutes: 30, enabled: true },
    },
    'active.flow.json': { ...flow, name: 'active' },
    'mixed.flow.json': { ...flow, name: 'mixed' },
    // Kept visible on the dashboard with its validation count, not hidden or
    // coloured green because an old record happened to succeed.
    'broken-dashboard.flow.json': '{ not json',
    '.flow-runs/run-finished.json': finished,
    '.flow-runs/run-failed.json': failed,
    '.flow-runs/run-stranded.json': stranded,
    '.flow-runs/run-warned.json': warned,
    '.flow-runs/run-active.json': active,
    '.flow-runs/run-mixed-absolute.json': mixedAbsolute,
    '.flow-runs/run-mixed-relative.json': mixedRelative,
    '.flow-runs/damaged.json': '{ half written',
    '.flow-runs/quiet.flow.json.schedule.json': { dueAt: quietDueAt },
  });

  // Most editor records are absolute. Leave one record for the dedicated
  // mixed-path flow relative to prove the dashboard canonicalises before it
  // aggregates without changing the open editor's history contract.
  const runNames = fs
    .readdirSync(path.join(workspace, '.flow-runs'))
    .filter((name) => name.startsWith('run-') && name.endsWith('.json'));
  for (const name of runNames) {
    const file = path.join(workspace, '.flow-runs', name);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const flowPath =
      name === 'run-mixed-relative.json'
        ? 'mixed.flow.json'
        : path.join(workspace, `${parsed.flowName}.flow.json`);
    fs.writeFileSync(file, JSON.stringify({ ...parsed, flowPath }, null, 2));
  }
  return workspace;
}

test.describe.configure({ mode: 'serial' });

test.describe('run history, from seeded records', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(workspaceWithRuns());
    await openFlow(flows.page, 'seeded.flow.json');
    await flows.page.locator('[data-testid="flow-runs-toggle"]').click();
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('summarises the runs before the reader scans them', async () => {
    const summary = flows.page.locator('[data-testid="flow-run-history-summary"]');

    await expect(summary).toHaveText('4 runs · 1 failed · 1 interrupted');
  });

  test('a run left behind by a dead app reads as interrupted, not running', async () => {
    const row = flows.page.locator('[data-past-run="run-stranded"]');

    await expect(row).toHaveAttribute('data-run-status', 'interrupted');
    await expect(row.locator('.flow-run-outcome')).toHaveText('1 of 3 steps · stopped at approve');
  });

  test('and is settled on disk, so the next reader is not misled either', async () => {
    const file = path.join(flows.workspace, '.flow-runs', 'run-stranded.json');

    await expect
      .poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).status, { timeout: 15_000 })
      .toBe('interrupted');
  });

  test('a failed run names the step that failed', async () => {
    const row = flows.page.locator('[data-past-run="run-failed"]');

    await expect(row).toHaveAttribute('data-run-status', 'failed');
    await expect(row.locator('.flow-run-outcome')).toHaveText('1 of 3 steps · failed at approve');
  });

  test('a step that failed wears its reliability; a clean one stays clean', async () => {
    // approve: done once, failed once across the records — 1/2 on the card.
    await expect(flows.page.locator('[data-reliability="approve"]')).toHaveText('1/2');
    // plan finished every recorded run; the chip is signal, not decoration.
    await expect(flows.page.locator('[data-reliability="plan"]')).toHaveCount(0);
  });

  test('unrecorded token usage reads as a dash, not as free', async () => {
    const cells = flows.page.locator('[data-past-run="run-failed"] td');

    await expect(cells.nth(4)).toHaveText('—');
  });

  test('recorded token usage is shown as a number', async () => {
    const cells = flows.page.locator('[data-past-run="run-finished"] td');

    await expect(cells.nth(4)).toHaveText('1,200');
  });

  test('opening a run shows each step and the error behind a failure', async () => {
    await flows.page.locator('[data-past-run="run-failed"]').click();
    const detail = flows.page.locator('[data-run-detail="run-failed"]');

    await expect(detail.locator('[data-detail-node="approve"]')).toContainText(
      'rejected by the reviewer'
    );
    await expect(detail.locator('[data-detail-node="review"]')).toContainText('skipped');
    await flows.page.locator('[data-past-run="run-failed"]').click();
  });

  test('a step that published nothing says so, rather than passing "" on quietly', async () => {
    await flows.page.locator('[data-past-run="run-warned"]').click();
    const detail = flows.page.locator('[data-run-detail="run-warned"]');

    await expect(detail.locator('[data-detail-node="plan"]')).toContainText('published an empty');
    await flows.page.locator('[data-past-run="run-warned"]').click();
  });

  test("a run's sessions are reachable, sub-agents included", async () => {
    await flows.page.locator('[data-past-run="run-finished"]').click();
    const detail = flows.page.locator('[data-run-detail="run-finished"]');

    // One button per session: the node's own plus both fan-out sub-agents.
    await expect(detail.locator('[data-open-session]')).toHaveCount(3);
    await expect(detail.locator('[data-open-session="child-b"]')).toBeVisible();
    await flows.page.locator('[data-past-run="run-finished"]').click();
  });
});

test.describe('the dashboard, from seeded records', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(workspaceWithRuns());
    await flows.page.locator('[title="Flows"], [aria-label="Flows"]').first().click();
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('adds up agent time across every run', async () => {
    const dash = flows.page.locator('[data-testid="flows-dashboard"]');
    await expect(dash).toBeVisible({ timeout: 30_000 });

    // 120s + 60s (finished) + 1s (failed) + 2s (warned) = 183s.
    await expect(dash.locator('[data-metric="agent-time"] .flows-dashboard-value')).toHaveText('3m');
  });

  test('counts gate waits separately, because that is a person', async () => {
    const dash = flows.page.locator('[data-testid="flows-dashboard"]');

    // 300s at the approved gate + 4s at the rejected one.
    await expect(dash.locator('[data-metric="human-time"] .flows-dashboard-value')).toHaveText('5m');
  });

  test('counts the sub-agents a fan-out spawned', async () => {
    const dash = flows.page.locator('[data-testid="flows-dashboard"]');

    await expect(dash.locator('[data-metric="sub-agents"] .flows-dashboard-value')).toHaveText('2');
  });

  test('reports the token spend it does know about', async () => {
    const dash = flows.page.locator('[data-testid="flows-dashboard"]');

    await expect(dash.locator('[data-metric="tokens"] .flows-dashboard-value')).toHaveText('1,200');
  });

  test('estimates time saved only where an author supplied a baseline', async () => {
    const dash = flows.page.locator('[data-testid="flows-dashboard"]');
    const saved = dash.locator('[data-metric="saved"]');

    // 90 minutes claimed by hand, minus the 5 minutes spent at that run's gate.
    await expect(saved.locator('.flows-dashboard-value')).toHaveText('1h 25m');
    // And it says what it is based on, rather than presenting itself as measured.
    await expect(saved).toContainText('your own baseline');
    await expect(saved).toContainText('1 run');
  });

  test('breaks the numbers down per flow', async () => {
    const row = flows.page.locator('[data-dashboard-flow="seeded"]');

    await expect(row).toBeVisible();
    await expect(row.locator('.flows-dashboard-row-stat').first()).toHaveText('4 runs');
    await expect(row.locator('[data-failed="true"]')).toHaveText('1 failed');
    await expect(row.locator('[data-stat="average"]')).toHaveText('46s');
  });

  test('merges absolute and relative run paths into one flow row', async () => {
    const rows = flows.page.locator('[data-dashboard-flow="mixed"]');

    await expect(rows).toHaveCount(1);
    await expect(rows.locator('[data-stat="runs"]')).toHaveText('2 runs');
  });

  test('lists a flow that has never run, which run records alone cannot show', async () => {
    const row = flows.page.locator('[data-dashboard-flow="quiet"]');

    await expect(row).toHaveAttribute('data-flow-state', 'never-run');
    await expect(row).toContainText('Never run');
  });

  test('a flow whose last run failed is called out', async () => {
    const row = flows.page.locator('[data-dashboard-flow="seeded"]');

    await expect(row).toHaveAttribute('data-flow-state', 'failing');
    await expect(row.locator('.flows-dashboard-status')).toHaveText('Failed');
  });

  test('a recent in-flight run is called running, never green', async () => {
    const row = flows.page.locator('[data-dashboard-flow="active"]');

    await expect(row).toHaveAttribute('data-flow-state', 'running');
    await expect(row.locator('.flows-dashboard-status')).toHaveText('Running');
  });

  test('shows an actual persisted next due time for a scheduled flow', async () => {
    const row = flows.page.locator('[data-dashboard-flow="quiet"]');

    await expect(row.locator('[data-pill="schedule"]')).toHaveText(/in (29|30)m/);
    await expect(row.locator('[data-pill="schedule"]')).toHaveAttribute('title', 'Every 30m');
  });

  test('keeps an invalid flow visible and explains damaged local history', async () => {
    const broken = flows.page.locator('[data-dashboard-flow="broken-dashboard"]');
    const notice = flows.page.locator('.flows-dashboard-notice[data-tone="attention"]');

    await expect(broken).toHaveAttribute('data-flow-state', 'invalid');
    await expect(broken.locator('.flows-dashboard-status')).toHaveText('Needs repair');
    await expect(broken.locator('[data-pill="invalid"]')).toHaveText('1 problem');
    await expect(notice).toContainText('1 invalid flow');
    await expect(notice).toContainText('1 damaged run record was skipped');
  });

  test('refresh discovers an on-disk flow without reopening the panel', async () => {
    fs.writeFileSync(
      path.join(flows.workspace, 'refreshed.flow.json'),
      `${JSON.stringify({ ...flow, name: 'refreshed' }, null, 2)}\n`
    );

    await flows.page.getByRole('button', { name: 'Refresh flows' }).click();

    await expect(flows.page.locator('[data-dashboard-flow="refreshed"]')).toBeVisible();
    await expect(flows.page.locator('.flows-dashboard-updated')).toContainText('Updated just now');
  });

  test('compact layout keeps health and action visible', async ({}, testInfo) => {
    await flows.page.setViewportSize({ width: 620, height: 760 });

    const seeded = flows.page.locator('[data-dashboard-flow="seeded"]');
    await expect(seeded.locator('.flows-dashboard-status')).toBeVisible();
    await expect(seeded.locator('[data-pill]')).toBeVisible();
    await expect(seeded.locator('[data-stat="average"]')).toBeHidden();
    await flows.page.screenshot({
      path: testInfo.outputPath('dashboard-compact.png'),
      fullPage: true,
    });

    await flows.page.setViewportSize({ width: 1200, height: 800 });
    await flows.page.screenshot({
      path: testInfo.outputPath('dashboard-desktop.png'),
      fullPage: true,
    });
  });

  test('only rows that could actually run offer a Run button', async () => {
    const rows = flows.page.locator('[data-flow-state]');
    const buttons = flows.page.locator('[data-testid="flows-dashboard-run"]');

    // Present on ok / failing / never-run; absent on invalid, archived and
    // running rows, where it could only mislead.
    const eligible = await flows.page
      .locator('[data-flow-state="ok"], [data-flow-state="failing"], [data-flow-state="never-run"]')
      .count();
    expect(await buttons.count()).toBe(eligible);
    expect(await rows.count()).toBeGreaterThan(eligible);
  });

  // Last in this block: it navigates away from the panel.
  test('a row opens its flow', async () => {
    await flows.page.locator('[data-dashboard-flow="quiet"]').click();

    await expect(flows.page.locator('[data-testid="flow-editor"]')).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe('a flow that will not open', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        // Two mistakes on purpose: the editor used to report only the first,
        // so repairing a flow cost one reload per problem.
        'broken.flow.json': {
          version: 1,
          name: 'broken',
          nodes: [
            { id: 'a', type: 'shell' },
            { id: 'b', type: 'human-gate' },
          ],
          edges: [],
        },
      })
    );
    // Not `openFlow`: that waits for the canvas, and a flow this broken never
    // renders one — the error screen stands in its place.
    await flows.page.getByText('broken.flow.json', { exact: false }).first().click();
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('lists every problem at once, not just the first', async () => {
    const error = flows.page.locator('[data-testid="flow-load-error"]');

    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText('2 problems');
    await expect(error.locator('li')).toHaveCount(2);
    await expect(error).toContainText('nodes[0].run');
    await expect(error).toContainText('nodes[1].message');
  });

  test('offers a way into the file rather than being a dead end', async () => {
    await flows.page.locator('[data-testid="flow-edit-as-text"]').click();

    // Source mode hands the file to the host's text editor, so the flow's own
    // error screen stands down.
    await expect(flows.page.locator('[data-testid="flow-load-error"]')).toBeHidden({
      timeout: 30_000,
    });
  });
});

test.describe('guards that only fire in the editor', () => {
  let flows: FlowsApp;

  /** A gate in front of a command is exactly what must not be auto-approved. */
  const risky = {
    version: 1,
    name: 'risky',
    nodes: [
      { id: 'ok', type: 'human-gate', message: 'Deploy?' },
      { id: 'ship', type: 'shell', run: 'npm test' },
    ],
    edges: [{ from: 'ok', to: 'ship' }],
    variables: {},
    schedule: { type: 'daily', time: '02:00', enabled: true, onGate: 'skip' },
  };

  test.beforeAll(async () => {
    flows = await launchFlowsApp(createWorkspace({ 'risky.flow.json': risky }));
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('refuses to open a flow that would auto-approve a gate before a command', async () => {
    await flows.page.getByText('risky.flow.json', { exact: false }).first().click();

    // The validator rejects it, so the editor reports it rather than showing a
    // canvas that could be run.
    const error = flows.page.locator('[data-testid="flow-editor-error"], .flow-editor-error');
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText('onGate');
  });
});

test.describe('nodes link in both directions', () => {
  let flows: FlowsApp;

  const stacked = {
    version: 1,
    name: 'stacked',
    nodes: [
      { id: 'a', type: 'shell', run: 'ls', position: { x: 0, y: 0 } },
      { id: 'b', type: 'shell', run: 'pwd', position: { x: 0, y: 260 } },
    ],
    edges: [{ from: 'a', to: 'b' }],
    variables: {},
  };

  test.beforeAll(async () => {
    flows = await launchFlowsApp(createWorkspace({ 'stacked.flow.json': stacked }));
    await openFlow(flows.page, 'stacked.flow.json');
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('every node offers a top and bottom port, so a top-down layout connects', async () => {
    const node = flows.page.locator('.flow-node[data-node-id="a"]');

    // Without these, an edge between vertically stacked nodes loops out to the
    // right and back, because the only ports were on the sides.
    await expect(node.locator('.flow-node-handle-vertical')).toHaveCount(2);
    await expect(node.locator('.flow-node-handle')).toHaveCount(4);
  });
});

test.describe('pickers offer what the repository actually has', () => {
  let flows: FlowsApp;

  const skillFlow = {
    version: 1,
    name: 'uses-a-skill',
    // A valid flow: the schema requires a skill name, so the step starts on one
    // and the test changes it through the picker.
    nodes: [{ id: 'review', type: 'skill', skill: 'placeholder', position: { x: 0, y: 0 } }],
    edges: [],
    variables: {},
  };

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        'skilled.flow.json': skillFlow,
        // A project skill the host's own scan does not report; flows finds it by
        // reading the workspace directly.
        '.claude/skills/release-notes/SKILL.md':
          '---\nname: release-notes\ndescription: Draft release notes from the git log\n---\n\nDo it.\n',
      })
    );
    await openFlow(flows.page, 'skilled.flow.json');
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('a skill step lists a skill from this repo, rather than asking you to type it', async () => {
    const node = flows.page.locator('.flow-node[data-node-type="skill"]');
    await node.locator('[data-expand="review"]').click();

    // The step names a skill the workspace does not have, so the field starts in
    // "type it" mode; this is the toggle back to choosing from the workspace.
    // The catalog is fetched after mount; give it a moment to arrive.
    await flows.page.waitForTimeout(3_000);

    await node.locator('button[title="Choose from this workspace"]').click();
    // Now showing the current choice; this opens the search over the catalog.
    await node.getByLabel('Change Skill').click();

    const list = node.locator('.flow-picker-list button');
    await expect.poll(() => list.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await node.locator('.flow-picker input').fill('release-notes');

    // Read out of the workspace by the extension's own scan — the host does not
    // report project skills unless a compatibility flag is on.
    const option = node.locator('.flow-picker-list button', { hasText: 'release-notes' }).first();
    await expect(option).toBeVisible({ timeout: 30_000 });
    // Sourced from this repository, not from the host's own list.
    await expect(option).toContainText('project');

    await option.click();
    await expect(node.locator('.flow-picker-value')).toContainText('release-notes');
  });
});

/**
 * The Flows home is a launcher, not just a report: Run on a row opens the flow
 * and starts it, with no click on the editor's own Run button. Proven by the
 * artifact the run writes.
 */
test.describe('running a flow from the Flows home', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        'hands-free.flow.json': {
          version: 1,
          name: 'hands-free',
          variables: { text: 'launched-from-the-panel' },
          nodes: [{ id: 'save', type: 'write-file', path: 'launched.md', content: '{{text}}' }],
          edges: [],
        },
      })
    );
    await flows.page.locator('[title="Flows"], [aria-label="Flows"]').first().click();
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('Run on a row starts the run in the editor and the artifact lands', async () => {
    const row = flows.page.locator('[data-dashboard-flow="hands-free"]');
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.locator('[data-testid="flows-dashboard-run"]').click();

    // The editor takes over...
    await expect(flows.page.locator('[data-testid="flow-editor"]')).toBeVisible({
      timeout: 30_000,
    });
    // ...and the run happens without the editor's Run button being touched.
    await expect
      .poll(() => nodeStatuses(flows.page).then((statuses) => statuses.save), { timeout: 60_000 })
      .toBe('done');
    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(path.join(flows.workspace, 'launched.md'), 'utf8');
          } catch {
            return null;
          }
        },
        { timeout: 15_000 }
      )
      .toBe('launched-from-the-panel');
  });
});

/**
 * Fan-out's isolated branches were invisible the moment a run finished.
 * The record now carries them, and the run detail names each one.
 */
test.describe('worktree branches on the run record', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(workspaceWithRuns());
    await openFlow(flows.page, 'seeded.flow.json');
    await flows.page.locator('[data-testid="flow-runs-toggle"]').click();
    await flows.page.locator('[data-past-run="run-finished"]').click();
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('each isolated sub-agent shows its branch', async () => {
    const chips = flows.page.locator('[data-run-detail="run-finished"] .flow-worktree-chip');

    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toContainText('flow/review-0-ab12');
    await expect(chips.nth(1)).toContainText('flow/review-1-cd34');
  });

  test('each sub-agent shows what it produced in the run detail', async () => {
    const detail = flows.page.locator('[data-run-detail="run-finished"]');

    await expect(detail.locator('[data-run-child="a"]')).toContainText('two nits');
    await expect(detail.locator('[data-run-child="b"]')).toContainText('clean');
  });

  test('a checkout that no longer exists says so instead of pretending', async () => {
    const chip = flows.page
      .locator('[data-worktree-branch="flow/review-0-ab12"]')
      .first();

    await chip.click();

    await expect(chip).toContainText('status unavailable', { timeout: 30_000 });
  });
});

/** The manifest binds ctrl+shift+l to the Flows panel toggle. */
test.describe('opening Flows from anywhere', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(createWorkspace({ 'plain.flow.json': flow }));
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('the keyboard shortcut toggles the panel', async () => {
    const dash = flows.page.locator('[data-testid="flows-dashboard"]');
    await expect(dash).toBeHidden();

    await flows.page.keyboard.press('Control+Shift+L');
    await expect(dash).toBeVisible({ timeout: 30_000 });

    await flows.page.keyboard.press('Control+Shift+L');
    await expect(dash).toBeHidden({ timeout: 30_000 });
  });
});

/**
 * A gate exists so a person reviews work before it proceeds — so the approval
 * card must show that work. Blind approval is the thing gates are against.
 */
test.describe('the gate shows the work it gates', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        'gated.flow.json': {
          version: 1,
          name: 'gated',
          variables: { body: 'The quarterly report body' },
          nodes: [
            { id: 'save', type: 'write-file', label: 'Draft the file', path: 'report.md', content: '{{body}}' },
            { id: 'approve', type: 'human-gate', message: 'Ship the report?' },
          ],
          edges: [{ from: 'save', to: 'approve' }],
        },
      })
    );
    await openFlow(flows.page, 'gated.flow.json');
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('the pending gate presents the upstream output, then honors the decision', async () => {
    await flows.page.locator('[data-testid="flow-run"]').click();

    const work = flows.page.locator('[data-gate-work="save"]');
    await expect(work).toBeVisible({ timeout: 60_000 });
    // The parent's label heads the panel; its live output fills it.
    await expect(work.locator('summary')).toHaveText('Draft the file');
    await expect(work).toContainText('wrote report.md');

    await flows.page.locator('[data-testid="flow-gate-approve"]').click();
    await expect
      .poll(() => nodeStatuses(flows.page).then((statuses) => statuses.approve), { timeout: 60_000 })
      .toBe('done');
  });

  // Runs after the gate test on purpose: the run has finished, and each card
  // should still be wearing what its step produced.
  test('each card shows its live output on the canvas, expandable in place', async () => {
    const strip = flows.page.locator('[data-node-result="save"]');

    await expect(strip).toBeVisible();
    await expect(strip).toContainText('wrote report.md');
    await expect(strip).toHaveAttribute('data-kind', 'output');

    await strip.click();
    await expect(strip).toHaveAttribute('data-expanded', 'true');
    await strip.click();
    await expect(strip).toHaveAttribute('data-expanded', 'false');
  });
});

/**
 * A conditional fork that meets again — the shape joins exist for.
 *
 * The shell backend is absent in these runs, so `test` fails deterministically:
 * the failure arm repairs, and the any-join takes whichever arm produced
 * output via a fallback chain. All proven on disk.
 */
test.describe('a fork that rejoins at an any-join', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        'rejoin.flow.json': {
          version: 1,
          name: 'rejoin',
          variables: {},
          nodes: [
            { id: 'test', type: 'shell', run: 'npm test', output: 'out' },
            {
              id: 'repair',
              type: 'write-file',
              label: 'Repair',
              path: 'FIX.md',
              content: 'patched',
              output: 'note',
            },
            {
              id: 'final',
              type: 'write-file',
              join: 'any',
              path: 'RESULT.md',
              content: 'came via: {{test.out ?? repair.note}}',
            },
          ],
          edges: [
            { from: 'test', to: 'final' },
            { from: 'test', to: 'repair', on: 'failure' },
            { from: 'repair', to: 'final' },
          ],
        },
      })
    );
    await openFlow(flows.page, 'rejoin.flow.json');
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('the failure arm repairs, the join runs once, the chain picks the live arm', async () => {
    await flows.page.locator('[data-testid="flow-run"]').click();

    await expect
      .poll(() => nodeStatuses(flows.page).then((statuses) => statuses.final), { timeout: 60_000 })
      .toBe('done');

    const statuses = await nodeStatuses(flows.page);
    expect(statuses.test).toBe('failed');
    expect(statuses.repair).toBe('done');

    const result = fs.readFileSync(path.join(flows.workspace, 'RESULT.md'), 'utf8');
    expect(result).toBe('came via: wrote FIX.md (7 characters)');
  });
});

/**
 * Data-driven routing: the same flow takes different branches depending on
 * what a step actually said — no human router, no failure hack.
 */
test.describe('when-conditions route on output', () => {
  let flows: FlowsApp;

  const routed = {
    version: 1,
    name: 'routed-verdict',
    variables: { decision: 'approve' },
    nodes: [
      {
        id: 'verdict',
        type: 'write-file',
        label: 'Publish the verdict',
        path: 'verdict-{{decision}}.md',
        content: 'decided',
        output: 'note',
      },
      { id: 'accepted', type: 'write-file', path: 'ACCEPTED.md', content: 'shipped' },
      { id: 'declined', type: 'write-file', path: 'DECLINED.md', content: 'held back' },
    ],
    edges: [
      { from: 'verdict', to: 'accepted', when: '{{verdict.note}} contains "approve"' },
      { from: 'verdict', to: 'declined', when: '{{verdict.note}} contains "reject"' },
    ],
  };

  test.beforeAll(async () => {
    flows = await launchFlowsApp(createWorkspace({ 'routed.flow.json': routed }));
    await openFlow(flows.page, 'routed.flow.json');
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('the matching branch runs; the other dies; the file proves it', async () => {
    await flows.page.locator('[data-testid="flow-run"]').click();

    await expect
      .poll(() => nodeStatuses(flows.page).then((statuses) => statuses.accepted), {
        timeout: 60_000,
      })
      .toBe('done');

    const statuses = await nodeStatuses(flows.page);
    expect(statuses.declined).toBe('skipped');
    expect(fs.existsSync(path.join(flows.workspace, 'ACCEPTED.md'))).toBe(true);
    expect(fs.existsSync(path.join(flows.workspace, 'DECLINED.md'))).toBe(false);
  });

  test('changing the variable flips the route, same flow, no edits to edges', async () => {
    await flows.page.locator('[data-testid="flow-variables-toggle"]').click();
    await flows.page.getByLabel('Value of decision').fill('reject');
    await flows.page.locator('[data-testid="flow-run"]').click();

    await expect
      .poll(() => nodeStatuses(flows.page).then((statuses) => statuses.declined), {
        timeout: 60_000,
      })
      .toBe('done');

    expect(fs.existsSync(path.join(flows.workspace, 'DECLINED.md'))).toBe(true);
  });
});

/**
 * Run-from-here: the iteration loop. Upstream is seeded from the latest run;
 * only the chosen node and its descendants execute. Proven on disk: the
 * upstream artifact is deleted and must NOT come back.
 */
test.describe('run from a node', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        'iterate.flow.json': {
          version: 1,
          name: 'iterate',
          variables: { text: 'v1' },
          nodes: [
            { id: 'first', type: 'write-file', path: 'FIRST.md', content: '{{text}}', output: 'note' },
            { id: 'second', type: 'write-file', path: 'SECOND.md', content: 'built on {{first.note}}' },
          ],
          edges: [{ from: 'first', to: 'second', port: 'note' }],
        },
      })
    );
    await openFlow(flows.page, 'iterate.flow.json');
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('no button before any run exists — there is nothing to seed from', async () => {
    await expect(flows.page.locator('[data-run-from="second"]')).toHaveCount(0);
  });

  test('after a run, running from the second step reuses the first', async () => {
    await flows.page.locator('[data-testid="flow-run"]').click();
    await expect
      .poll(() => nodeStatuses(flows.page).then((statuses) => statuses.second), { timeout: 60_000 })
      .toBe('done');

    // The proof surface: delete the upstream artifact.
    fs.rmSync(path.join(flows.workspace, 'FIRST.md'));
    fs.rmSync(path.join(flows.workspace, 'SECOND.md'));

    await flows.page.locator('[data-run-from="second"]').click();
    await expect
      .poll(() => nodeStatuses(flows.page).then((statuses) => statuses.second), { timeout: 60_000 })
      .toBe('done');

    // Upstream was seeded, not re-executed; downstream really ran.
    expect(fs.existsSync(path.join(flows.workspace, 'FIRST.md'))).toBe(false);
    expect(fs.readFileSync(path.join(flows.workspace, 'SECOND.md'), 'utf8')).toContain(
      'built on wrote FIRST.md'
    );

    const records = flows
      .runRecords()
      .map((name) =>
        JSON.parse(fs.readFileSync(path.join(flows.workspace, '.flow-runs', name), 'utf8'))
      )
      .sort((a, b) => b.startedAt - a.startedAt);
    expect(records[0].resumedFrom).toBe(records[1].runId);
    expect(records[0].nodes.first).toMatchObject({ status: 'done', reused: true });
  });
});

/**
 * Dry run: the rehearsal. The whole graph executes with effects stubbed —
 * proven by what does NOT appear on disk afterwards.
 */
test.describe('dry run', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        'rehearse.flow.json': {
          version: 1,
          name: 'rehearse',
          variables: {},
          nodes: [
            { id: 'check', type: 'shell', run: 'npm test', output: 'log' },
            { id: 'gate', type: 'human-gate', message: 'Looks right?' },
            { id: 'save', type: 'write-file', path: 'REHEARSED.md', content: '{{check.log}}' },
          ],
          edges: [
            { from: 'check', to: 'gate' },
            { from: 'gate', to: 'save' },
          ],
        },
      })
    );
    await openFlow(flows.page, 'rehearse.flow.json');
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('walks the graph free of effects: gate asks, disk stays clean', async () => {
    await flows.page.locator('[data-testid="flow-dry-run"]').click();

    // The gate is real — deciding is part of the rehearsal — and it shows the
    // stubbed upstream work.
    const gate = flows.page.locator('[data-testid="flow-gate"]');
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(gate).toContainText('[dry-run] would run: npm test');
    await flows.page.locator('[data-testid="flow-gate-approve"]').click();

    await expect
      .poll(() => nodeStatuses(flows.page).then((statuses) => statuses.save), { timeout: 60_000 })
      .toBe('done');

    // The strips say what would have happened...
    await expect(flows.page.locator('[data-node-result="save"]')).toContainText(
      'would write REHEARSED.md'
    );
    await expect(flows.page.locator('[data-testid="flow-dry-indicator"]')).toBeVisible();

    // ...and nothing did: no artifact, no run record.
    expect(fs.existsSync(path.join(flows.workspace, 'REHEARSED.md'))).toBe(false);
    expect(flows.runRecords()).toEqual([]);
  });
});

/**
 * Draft with AI, at the seam CI can prove: the form exists, and with no
 * provider behind the host the failure is a message — never a broken canvas.
 */
test.describe('draft with AI', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        'blank.flow.json': { version: 1, name: 'blank', nodes: [], edges: [], variables: {} },
      })
    );
    await openFlow(flows.page, 'blank.flow.json');
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('the empty canvas offers describe-it beside the templates', async () => {
    await expect(flows.page.locator('[data-testid="flow-draft"]')).toBeVisible();
    await expect(flows.page.locator('[data-testid="flow-empty"]')).toContainText(
      'describe it'
    );
  });

  // The draft/repair loop's failure paths are covered by the aiDraft unit
  // tests; exercising them here would depend on whether the machine happens to
  // hold provider auth, which is exactly what an e2e must not depend on.
  test('edit-with-AI appears only once there is something to edit', async () => {
    await expect(flows.page.locator('[data-testid="flow-ai-edit-toggle"]')).toHaveCount(0);

    await flows.page.locator('[data-add-node="agent"]').click();
    await expect(flows.page.locator('[data-testid="flow-ai-edit-toggle"]')).toBeVisible();

    await flows.page.locator('[data-testid="flow-ai-edit-toggle"]').click();
    await expect(flows.page.locator('[data-testid="flow-ai-edit"]')).toBeVisible();
  });
});

/**
 * Durable runs: an interrupted run greets the user with a resume offer.
 * The record is seeded — a real interruption would mean killing the app
 * mid-run, which no CI retry could reproduce twice the same way.
 */
test.describe('resuming an interrupted run', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    const durableFlow = {
      version: 1,
      name: 'durable',
      nodes: [
        { id: 'first', type: 'write-file', path: 'FIRST.md', content: 'hello', output: 'note' },
        { id: 'second', type: 'write-file', path: 'SECOND.md', content: 'built on {{first.note}}' },
      ],
      edges: [{ from: 'first', to: 'second', port: 'note' }],
      variables: {},
    };
    const firstOutput = 'wrote FIRST.md (5 characters)';
    const started = Date.now() - HOUR;
    const workspace = createWorkspace({
      'durable.flow.json': durableFlow,
      '.flow-runs/run-cut-short.json': {
        runId: 'run-cut-short',
        flowName: 'durable',
        status: 'interrupted',
        startedAt: started,
        updatedAt: started + 5_000,
        nodes: {
          first: {
            nodeId: 'first',
            type: 'write-file',
            status: 'done',
            output: firstOutput,
            definitionHash: nodeDefinitionHash(durableFlow.nodes[0] as never),
          },
        },
        outputs: { first: { note: firstOutput } },
        usage: { inputTokens: 0, outputTokens: 0 },
        sessionIds: [],
      },
    });
    const recordFile = path.join(workspace, '.flow-runs', 'run-cut-short.json');
    const parsed = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    parsed.flowPath = path.join(workspace, 'durable.flow.json');
    fs.writeFileSync(recordFile, JSON.stringify(parsed, null, 2));

    flows = await launchFlowsApp(workspace);
    await openFlow(flows.page, 'durable.flow.json');
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('the flow opens with the offer, not a bare canvas', async () => {
    const banner = flows.page.locator('[data-testid="flow-resume-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('1 finished step will be kept');
  });

  test('Resume keeps the finished step and runs the rest', async () => {
    // The proof surface: the finished step's artifact never existed on disk.
    expect(fs.existsSync(path.join(flows.workspace, 'FIRST.md'))).toBe(false);

    await flows.page.locator('[data-testid="flow-resume-banner-go"]').click();
    await expect
      .poll(() => nodeStatuses(flows.page).then((statuses) => statuses.second), { timeout: 60_000 })
      .toBe('done');

    // Seeded, not re-executed — a re-run would have written FIRST.md.
    expect(fs.existsSync(path.join(flows.workspace, 'FIRST.md'))).toBe(false);
    expect(fs.readFileSync(path.join(flows.workspace, 'SECOND.md'), 'utf8')).toContain(
      'built on wrote FIRST.md'
    );

    // The offer is settled: the latest run is now a finished one.
    await expect(flows.page.locator('[data-testid="flow-resume-banner"]')).toHaveCount(0);

    const records = flows
      .runRecords()
      .map((name) =>
        JSON.parse(fs.readFileSync(path.join(flows.workspace, '.flow-runs', name), 'utf8'))
      )
      .sort((a, b) => b.startedAt - a.startedAt);
    expect(records[0].resumedFrom).toBe('run-cut-short');
    expect(records[0].nodes.first).toMatchObject({ status: 'done', reused: true });
  });

  test('clicking the wire shows what travelled it', async () => {
    await flows.page.locator('.react-flow__edge[data-id="first->second"]').click();

    const panel = flows.page.locator('[data-testid="flow-edge-payload"]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('first → second');
    await expect(panel).toContainText('{{first.note}}');
    // The seeded output from the resumed run — the actual hand-off value.
    await expect(panel.locator('.flow-edge-payload-value')).toContainText('wrote FIRST.md');

    await flows.page.locator('[data-testid="flow-edge-payload-close"]').click();
    await expect(panel).toHaveCount(0);
  });
});

/**
 * Event triggers: a file change runs the flow — the editor is open but Run is
 * never pressed. Opening the flow doubles as the arming barrier: triggers arm
 * in activate(), which strictly precedes any extension component mounting, and
 * a write that lands before arming is missed forever (nothing re-emits it).
 * CI's slow first paint hit exactly that race when nothing was opened at all.
 */
test.describe('a flow triggered by a file change', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        'watcher.flow.json': {
          version: 1,
          name: 'watcher',
          trigger: { type: 'file-change', glob: 'notes/*.md', debounceSeconds: 1, enabled: true },
          nodes: [
            { id: 'mark', type: 'write-file', path: 'TRIGGERED.md', content: 'the watcher ran' },
          ],
          edges: [],
          variables: {},
        },
        // The watched directory exists from the start; the test only adds a file.
        'notes/.gitkeep': '',
      })
    );
    await openFlow(flows.page, 'watcher.flow.json');

    // A second, test-owned subscription to the same broadcast the trigger
    // adapter uses. When the flow does not run, this names the broken layer:
    // events absent → the workspace watcher; events present → the extension.
    await flows.page.evaluate(() => {
      const w = window as unknown as {
        __fileEvents: string[];
        electronAPI?: { on(event: string, cb: (d: unknown) => void): void };
      };
      w.__fileEvents = [];
      w.electronAPI?.on?.('file-changed-on-disk', (d) =>
        w.__fileEvents.push(String((d as { path?: unknown } | undefined)?.path))
      );
    });
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('a matching save runs the flow; a non-matching one never did', async () => {
    // The non-matching write goes first and gets a full debounce period of
    // silence — if it were ever going to fire, it would fire now.
    fs.writeFileSync(path.join(flows.workspace, 'unrelated.txt'), 'noise');
    await flows.page.waitForTimeout(2_500);
    expect(fs.existsSync(path.join(flows.workspace, 'TRIGGERED.md'))).toBe(false);

    fs.writeFileSync(path.join(flows.workspace, 'notes', 'todo.md'), '- buy milk');

    // The renderer must see the broadcast before the flow can possibly run.
    await expect
      .poll(
        () =>
          flows.page.evaluate(() =>
            (window as unknown as { __fileEvents: string[] }).__fileEvents.filter((p) =>
              p.endsWith('todo.md')
            )
          ),
        { timeout: 30_000, message: 'file-changed-on-disk never reached the renderer' }
      )
      .not.toEqual([]);

    await expect
      .poll(() => fs.existsSync(path.join(flows.workspace, 'TRIGGERED.md')), { timeout: 60_000 })
      .toBe(true);

    expect(fs.readFileSync(path.join(flows.workspace, 'TRIGGERED.md'), 'utf8')).toBe(
      'the watcher ran'
    );

    // Exactly one run: the matching save fired, the noise never did.
    await expect.poll(() => flows.runRecords().length, { timeout: 15_000 }).toBe(1);
    const record = JSON.parse(
      fs.readFileSync(path.join(flows.workspace, '.flow-runs', flows.runRecords()[0]), 'utf8')
    );
    expect(record.status).toBe('done');
    expect(record.flowPath.endsWith('watcher.flow.json')).toBe(true);
  });
});
