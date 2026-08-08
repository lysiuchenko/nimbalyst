import { expect, test } from '@playwright/test';
import { createWorkspace, launchFlowsApp, nodeStatuses, openFlow, type FlowsApp } from './helpers';

/** Two agent nodes and a gate, with a port carrying output between them. */
const pipeline = {
  version: 1,
  name: 'review-pipeline',
  nodes: [
    { id: 'plan', type: 'agent', label: 'Draft plan', prompt: 'Plan it', output: 'plan_md' },
    { id: 'gate', type: 'human-gate', message: 'Approve the plan?' },
  ],
  edges: [{ from: 'plan', to: 'gate', port: 'plan_md' }],
  variables: {},
};

test.describe.configure({ mode: 'serial' });

test.describe('flow editor', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(createWorkspace({ 'review.flow.json': pipeline }));
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('opens *.flow.json on the canvas instead of in Monaco', async () => {
    await openFlow(flows.page, 'review.flow.json');

    await expect(flows.page.locator('.flow-node')).toHaveCount(2);
    await expect(flows.page.locator('.flow-node[data-node-type="agent"]')).toHaveCount(1);
    await expect(flows.page.locator('.flow-node[data-node-type="human-gate"]')).toHaveCount(1);
    await expect(flows.page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('edits made on the canvas reach the file', async () => {
    await flows.page.locator('[data-add-node="shell"]').click();
    const shell = flows.page.locator('.flow-node[data-node-type="shell"]');
    await shell.getByLabel('Run').fill('npm test');
    await shell.getByLabel('Node label').fill('Verify');

    await expect(flows.page.locator('.flow-toolbar-status')).toHaveText('Unsaved changes');

    await flows.save();
    await expect(flows.page.locator('.flow-toolbar-status')).toHaveText('Saved', { timeout: 30_000 });

    const saved = flows.readFlow('review.flow.json') as {
      nodes: { id: string; run?: string; label?: string; position?: unknown }[];
      edges: { from: string; to: string; port?: string }[];
    };
    const shellNode = saved.nodes.find((node) => node.id === 'shell');
    expect(shellNode).toMatchObject({ run: 'npm test', label: 'Verify' });
    expect(saved.nodes.every((node) => node.position !== undefined)).toBe(true);
    // The port on the pre-existing edge survives a canvas round-trip.
    expect(saved.edges).toContainEqual({ from: 'plan', to: 'gate', port: 'plan_md' });
  });

  test('refuses to save a flow that could not be reopened', async () => {
    const before = JSON.stringify(flows.readFlow('review.flow.json'));

    await flows.page
      .locator('.flow-node[data-node-type="shell"]')
      .getByLabel('Run')
      .fill('');
    await flows.save();

    const banner = flows.page.locator('[data-testid="flow-save-error"]');
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText('shell node requires a non-empty run');
    expect(JSON.stringify(flows.readFlow('review.flow.json'))).toBe(before);
  });
});

test.describe('starting from empty', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(
      createWorkspace({
        'blank.flow.json': { version: 1, name: 'blank', nodes: [], edges: [], variables: {} },
      })
    );
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('an empty flow offers starter templates instead of a blank grid', async () => {
    await openFlow(flows.page, 'blank.flow.json');

    await expect(flows.page.locator('[data-testid="flow-empty"]')).toBeVisible();
    await expect(flows.page.locator('.flow-template-card')).not.toHaveCount(0);
  });

  test('picking a template fills the canvas with a wired, valid flow', async () => {
    await flows.page.locator('[data-template="plan-implement-review"]').click();

    await expect(flows.page.locator('[data-testid="flow-empty"]')).toBeHidden();
    await expect(flows.page.locator('.flow-node')).toHaveCount(5);
    // Wired, not just placed: edges exist and nothing is flagged as broken.
    await expect(flows.page.locator('.react-flow__edge')).toHaveCount(4);
    await expect(flows.page.locator('.flow-node-invalid')).toHaveCount(0);
  });

  test('the templated flow saves without needing a single edit', async () => {
    await flows.save();
    await expect(flows.page.locator('.flow-toolbar-status')).toHaveText('Saved', { timeout: 30_000 });

    const saved = flows.readFlow('blank.flow.json') as { nodes: unknown[]; edges: unknown[] };
    expect(saved.nodes).toHaveLength(5);
    expect(saved.edges).toHaveLength(4);
  });
});

test.describe('canvas actions', () => {
  let flows: FlowsApp;

  test.beforeAll(async () => {
    flows = await launchFlowsApp(createWorkspace({ 'actions.flow.json': pipeline }));
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('duplicating a node copies its work but not its identity', async () => {
    await openFlow(flows.page, 'actions.flow.json');
    await flows.page.locator('[data-duplicate="plan"]').click();

    await expect(flows.page.locator('.flow-node[data-node-id="plan-2"]')).toBeVisible();
    // The copy keeps the prompt but drops the output port, which cannot be shared.
    await expect(
      flows.page.locator('.flow-node[data-node-id="plan-2"]').getByLabel('Prompt')
    ).toHaveValue('Plan it');
    await expect(
      flows.page.locator('.flow-node[data-node-id="plan-2"]').getByLabel('Output port')
    ).toHaveValue('');
  });

  test('variables are editable without dropping into source mode', async () => {
    await flows.page.locator('[data-testid="flow-variables-toggle"]').click();
    await expect(flows.page.locator('[data-testid="flow-variables"]')).toBeVisible();

    await flows.page.locator('[data-testid="flow-add-variable"]').click();
    await flows.page.locator('[data-variable="input"] input').nth(1).fill('src/');
    await flows.save();
    await expect(flows.page.locator('.flow-toolbar-status')).toHaveText('Saved', { timeout: 30_000 });

    const saved = flows.readFlow('actions.flow.json') as { variables: Record<string, string> };
    expect(saved.variables).toMatchObject({ input: 'src/' });
  });
});

test.describe('running a flow', () => {
  let flows: FlowsApp;

  /** Gate-only: exercises the whole runner without spending tokens. */
  const approvals = {
    version: 1,
    name: 'approvals',
    nodes: [
      { id: 'first', type: 'human-gate', label: 'Step one', message: 'Start?', output: 'one' },
      { id: 'second', type: 'human-gate', label: 'Step two', message: 'Confirm?' },
    ],
    edges: [{ from: 'first', to: 'second', port: 'one' }],
    variables: {},
  };

  test.beforeAll(async () => {
    flows = await launchFlowsApp(createWorkspace({ 'approvals.flow.json': approvals }));
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('pauses at each gate, resumes on approval, and records the run', async () => {
    await openFlow(flows.page, 'approvals.flow.json');
    await flows.page.locator('[data-testid="flow-run"]').click();

    const gate = flows.page.locator('[data-testid="flow-gate"]');
    await expect(gate).toBeVisible({ timeout: 60_000 });
    await expect(gate).toContainText('Start?');

    await flows.page.locator('[data-testid="flow-gate-approve"]').click();
    await expect(gate).toContainText('Confirm?', { timeout: 30_000 });

    // The approved gate is done while the next one is still waiting.
    expect(await nodeStatuses(flows.page)).toEqual({ first: 'done', second: 'running' });

    await flows.page.locator('[data-testid="flow-gate-approve"]').click();
    await expect(gate).toBeHidden({ timeout: 30_000 });
    await expect
      .poll(async () => (await nodeStatuses(flows.page)).second, { timeout: 30_000 })
      .toBe('done');

    const records = flows.runRecords();
    expect(records).toHaveLength(1);
  });

  test('reports the finished run without opening a session', async () => {
    const panel = flows.page.locator('[data-testid="flow-run-panel"]');

    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Run total');
    await expect(panel.locator('[data-run-node="first"]')).toContainText('done');
    await expect(panel.locator('[data-run-node="second"]')).toContainText('done');
  });
});
