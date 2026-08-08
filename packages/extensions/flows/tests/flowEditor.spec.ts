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

  test('every toolbar control stays reachable in a narrow pane', async () => {
    const buttons = flows.page.locator('.flow-toolbar button');
    const count = await buttons.count();
    // boundingBox is viewport-absolute, so compare against the pane's right
    // edge rather than its width.
    const paneRight = await flows.page.evaluate(
      () => document.querySelector('.flow-editor')!.getBoundingClientRect().right
    );

    for (let index = 0; index < count; index++) {
      const box = await buttons.nth(index).boundingBox();
      expect(box, `toolbar button ${index} has no box`).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(paneRight + 2);
    }
  });

  test('the canvas theme can be switched and is remembered', async () => {
    const editor = flows.page.locator('[data-testid="flow-editor"]');
    await expect(editor).toHaveAttribute('data-flow-theme', 'host');

    await flows.page.locator('[data-testid="flow-theme"]').click();
    await expect(editor).toHaveAttribute('data-flow-theme', 'globallogic');

    // The brand theme must actually repaint, not just set an attribute.
    const painted = await flows.page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.flow-editor')!);
      return {
        accent: style.getPropertyValue('--flow-accent').trim(),
        second: style.getPropertyValue('--flow-accent-2').trim(),
        dot: style.getPropertyValue('--flow-dot').trim(),
      };
    });
    // The brand orange is sourced from GlobalLogic's own aiarrow/aiglyph SVGs
    // and is the accent in both the light and dark variants.
    expect(painted.accent.toLowerCase()).toBe('#ff5f2d');
    // Structure is neutral, never a second hue: r, g and b stay close together.
    const [r, g, b] = (painted.second.match(/\w\w/g) ?? []).map((h) => parseInt(h, 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24);
    // Orange leads, purple is the second colour — not two shades of one hue.
    expect(painted.accent.toLowerCase()).not.toBe(painted.second.toLowerCase());
    expect(painted.dot).toMatch(/^#|rgb/);
  });

  test('canvas chrome is themed, not left on xyflow defaults', async () => {
    const painted = await flows.page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.flow-editor')!);
      const edge = document.querySelector('.react-flow__edge-path');
      const miniNode = document.querySelector('.react-flow__minimap-node');
      const mask = document.querySelector('.react-flow__minimap-mask');
      return {
        text: cs.getPropertyValue('--flow-text').trim(),
        edge: edge ? getComputedStyle(edge).stroke : 'none',
        miniNode: miniNode ? getComputedStyle(miniNode).fill : 'none',
        mask: mask ? getComputedStyle(mask).fill : 'none',
      };
    });

    // Edges were painting near-white, which reads as glare on a dark canvas.
    expect(painted.edge).not.toBe('none');
    expect(painted.edge).not.toBe(painted.text);
    // The minimap shipped with a light mask — a bright slab in the corner. What
    // matters is that it is translucent and derived from the canvas colour;
    // computed form varies (rgba(...) or color(srgb ... / a)).
    expect(painted.miniNode).not.toBe('none');
    expect(painted.mask).toMatch(/\/\s*0?\.\d|rgba\([^)]*,\s*0?\.\d\s*\)/);
  });

  test('the canvas actually draws a dot grid', async () => {
    // The pattern is an SVG circle per dot; a missing grid means no circles.
    const dots = flows.page.locator('.react-flow__background pattern circle');
    await expect(dots.first()).toBeAttached();

    const fill = await dots.first().evaluate((circle) => getComputedStyle(circle).fill);
    const canvasBg = await flows.page.evaluate(() =>
      getComputedStyle(document.querySelector('.flow-editor')!).getPropertyValue('--flow-bg').trim()
    );
    expect(fill).not.toBe('none');
    // A dot the same colour as the canvas is a dot nobody can see.
    expect(fill.replace(/\s/g, '')).not.toBe(canvasBg.replace(/\s/g, ''));
  });

  test('undo takes back a canvas edit, redo puts it back', async () => {
    await expect(flows.page.locator('.flow-node[data-node-id="plan-2"]')).toBeVisible();

    await flows.page.locator('[data-testid="flow-undo"]').click();
    await expect(flows.page.locator('.flow-node[data-node-id="plan-2"]')).toHaveCount(0);

    await flows.page.locator('[data-testid="flow-redo"]').click();
    await expect(flows.page.locator('.flow-node[data-node-id="plan-2"]')).toBeVisible();
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

test.describe('fan-out sub-agents', () => {
  let flows: FlowsApp;

  /** Gate feeds a fixed list; the fan-out spawns one sub-agent per line. */
  const fanFlow = {
    version: 1,
    name: 'fan',
    nodes: [
      {
        id: 'gate',
        type: 'human-gate',
        label: 'Start',
        message: 'Fan out?',
        output: 'items',
        position: { x: 0, y: 0 },
      },
      {
        id: 'review',
        type: 'fan-out',
        label: 'Review each',
        prompt: 'Look at {{item}}',
        over: 'alpha\nbeta\ngamma',
        position: { x: 320, y: 0 },
      },
    ],
    edges: [{ from: 'gate', to: 'review' }],
    variables: {},
  };

  test.beforeAll(async () => {
    flows = await launchFlowsApp(createWorkspace({ 'fan.flow.json': fanFlow }));
  });

  test.afterAll(async () => {
    await flows?.close();
  });

  test('a fan-out node shows the list it will spread over', async () => {
    await openFlow(flows.page, 'fan.flow.json');

    const card = flows.page.locator('.flow-node[data-node-type="fan-out"]');
    await expect(card).toBeVisible();
    await expect(card.getByLabel('Fan out over')).toHaveValue('alpha\nbeta\ngamma');
    // Nothing is wrong with it: {{item}} is a real input inside a fan-out.
    await expect(flows.page.locator('.flow-node-invalid')).toHaveCount(0);
  });

  test('the canvas shows one sub-agent per item once it runs', async () => {
    await flows.page.locator('[data-testid="flow-run"]').click();
    await flows.page.locator('[data-testid="flow-gate-approve"]').click();

    // Agent nodes need a live provider, so the sub-agents will fail here — what
    // matters is that all three appear individually and are tracked separately.
    const chips = flows.page.locator('[data-testid="flow-children-review"] .flow-child');
    await expect(chips).toHaveCount(3, { timeout: 60_000 });
    await expect(chips.first()).toContainText('alpha');
    await expect(chips.nth(2)).toContainText('gamma');
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

  test('a finished run shows up in this flow\'s history', async () => {
    await flows.page.locator('[data-testid="flow-runs-toggle"]').click();

    const history = flows.page.locator('[data-testid="flow-run-history"]');
    await expect(history).toBeVisible();
    await expect(history.locator('[data-past-run]')).toHaveCount(1);
    await expect(history).toContainText('done');
  });

  test('reports the finished run without opening a session', async () => {
    const panel = flows.page.locator('[data-testid="flow-run-panel"]');

    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Run total');
    await expect(panel.locator('[data-run-node="first"]')).toContainText('done');
    await expect(panel.locator('[data-run-node="second"]')).toContainText('done');
  });
});
