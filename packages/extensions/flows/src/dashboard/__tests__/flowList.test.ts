// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { buildFlowRows, type FlowFile } from '../flowList';
import type { FlowMetrics } from '../metrics';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

function file(path: string, extra: Partial<FlowFile> = {}): FlowFile {
  return {
    flowPath: path,
    flowName: path.replace('.flow.json', ''),
    schedule: null,
    nextRunAt: null,
    valid: true,
    problems: [],
    ...extra,
  };
}

function metrics(path: string, extra: Partial<FlowMetrics> = {}): FlowMetrics {
  return {
    flowPath: path,
    pathKey: path,
    flowName: path.replace('.flow.json', ''),
    runs: 1,
    failed: 0,
    agentMs: 60_000,
    humanMs: 0,
    lastRunAt: NOW - HOUR,
    lastStatus: 'done',
    ...extra,
  };
}

describe('buildFlowRows', () => {
  test('lists a flow that has never run', () => {
    const [row] = buildFlowRows([file('nightly.flow.json')], []);

    expect(row.state).toBe('never-run');
    expect(row.runs).toBe(0);
    expect(row.lastRunAt).toBeNull();
  });

  test('joins a flow file to the runs recorded against its path', () => {
    const rows = buildFlowRows(
      [file('nightly.flow.json')],
      [metrics('nightly.flow.json', { runs: 4, failed: 1 })]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runs: 4, failed: 1, state: 'ok' });
  });

  test('keeps runs whose flow file is gone, marked archived', () => {
    const rows = buildFlowRows([], [metrics('deleted.flow.json')]);

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('archived');
  });

  test('a flow whose last run failed is marked failing', () => {
    const rows = buildFlowRows(
      [file('nightly.flow.json')],
      [metrics('nightly.flow.json', { lastStatus: 'failed', failed: 1 })]
    );

    expect(rows[0].state).toBe('failing');
  });

  test('carries the schedule from the flow file', () => {
    const rows = buildFlowRows(
      [
        file('nightly.flow.json', {
          schedule: { type: 'daily', time: '02:00', enabled: true },
          nextRunAt: NOW + HOUR,
        }),
      ],
      []
    );

    expect(rows[0].schedule).toEqual({
      type: 'daily',
      time: '02:00',
      enabled: true,
    });
    expect(rows[0].nextRunAt).toBe(NOW + HOUR);
  });

  test.each([
    ['running', 'running'],
    ['cancelled', 'cancelled'],
    ['interrupted', 'interrupted'],
    ['failed', 'failing'],
    ['done', 'ok'],
  ] as const)('maps a %s last run to a %s row', (lastStatus, state) => {
    const rows = buildFlowRows(
      [file('nightly.flow.json')],
      [metrics('nightly.flow.json', { lastStatus })]
    );

    expect(rows[0].state).toBe(state);
  });

  test('an invalid flow is never presented as healthy because an old run succeeded', () => {
    const rows = buildFlowRows(
      [
        file('nightly.flow.json', {
          valid: false,
          problems: [{ path: 'nodes[0].run', message: 'shell node requires run' }],
        }),
      ],
      [metrics('nightly.flow.json')]
    );

    expect(rows[0]).toMatchObject({ state: 'invalid', problemCount: 1 });
  });

  test('shows average agent time per run rather than the cumulative total', () => {
    const [row] = buildFlowRows(
      [file('nightly.flow.json')],
      [metrics('nightly.flow.json', { runs: 4, agentMs: 10_000 })]
    );

    expect(row.averageAgentMs).toBe(2_500);
  });

  test('orders failing first, then recent, then never-run, then archived', () => {
    const rows = buildFlowRows(
      [
        file('quiet.flow.json'),
        file('recent.flow.json'),
        file('broken.flow.json'),
        file('older.flow.json'),
      ],
      [
        metrics('older.flow.json', { lastRunAt: NOW - 10 * HOUR }),
        metrics('recent.flow.json', { lastRunAt: NOW - HOUR }),
        metrics('broken.flow.json', { lastStatus: 'failed' }),
        metrics('gone.flow.json'),
      ]
    );

    expect(rows.map((row) => row.flowPath)).toEqual([
      'broken.flow.json',
      'recent.flow.json',
      'older.flow.json',
      'quiet.flow.json',
      'gone.flow.json',
    ]);
  });

  test('a never-run flow sorts by name so the list is stable', () => {
    const rows = buildFlowRows([file('b.flow.json'), file('a.flow.json')], []);

    expect(rows.map((row) => row.flowPath)).toEqual(['a.flow.json', 'b.flow.json']);
  });

  test('a scheduled flow sorts before an otherwise equivalent manual flow', () => {
    const rows = buildFlowRows(
      [
        file('manual.flow.json'),
        file('scheduled.flow.json', {
          schedule: { type: 'interval', intervalMinutes: 30, enabled: true },
          nextRunAt: NOW + HOUR,
        }),
      ],
      []
    );

    expect(rows.map((row) => row.flowPath)).toEqual(['scheduled.flow.json', 'manual.flow.json']);
  });

  test('a scheduled never-run flow sorts before a healthy manual flow', () => {
    const rows = buildFlowRows(
      [
        file('manual.flow.json'),
        file('scheduled.flow.json', {
          schedule: {
            type: 'interval',
            intervalMinutes: 30,
            enabled: true,
          },
          nextRunAt: NOW + HOUR,
        }),
      ],
      [metrics('manual.flow.json')]
    );

    expect(rows.map((row) => row.flowPath)).toEqual(['scheduled.flow.json', 'manual.flow.json']);
  });

  // The editor records an absolute path (`host.filePath`) and the headless CLI
  // records whatever was typed on the command line. Joining on the raw string
  // showed one flow as two rows, one of them wrongly "archived".
  test('joins a run recorded under an absolute path to the same flow file', () => {
    const rows = buildFlowRows(
      [file('/repo/nightly.flow.json')],
      [metrics('nightly.flow.json', { runs: 2 })],
      '/repo'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runs: 2, state: 'ok' });
  });

  test('shows a workspace-relative path rather than the absolute one', () => {
    const rows = buildFlowRows([file('/repo/deep/nightly.flow.json')], [], '/repo');

    expect(rows[0].displayPath).toBe('deep/nightly.flow.json');
  });

  test('keeps the absolute path, because opening the file needs it', () => {
    const rows = buildFlowRows([file('/repo/nightly.flow.json')], [], '/repo');

    expect(rows[0].flowPath).toBe('/repo/nightly.flow.json');
  });

  test('joins Windows absolute and relative paths regardless of drive casing', () => {
    const rows = buildFlowRows(
      [file('C:\\Repo\\deep\\nightly.flow.json')],
      [metrics('DEEP\\NIGHTLY.flow.json', { runs: 2 })],
      'c:\\repo'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      runs: 2,
      displayPath: 'deep/nightly.flow.json',
    });
  });

  test('defensively merges duplicate metric entries with one canonical key', () => {
    const rows = buildFlowRows(
      [file('/repo/nightly.flow.json')],
      [
        metrics('/repo/nightly.flow.json', {
          pathKey: 'nightly.flow.json',
          runs: 2,
        }),
        metrics('nightly.flow.json', {
          pathKey: 'nightly.flow.json',
          runs: 3,
          failed: 1,
          agentMs: 120_000,
          lastRunAt: NOW,
          lastStatus: 'failed',
        }),
      ],
      '/repo'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      runs: 5,
      failed: 1,
      agentMs: 180_000,
      state: 'failing',
    });
  });
});
