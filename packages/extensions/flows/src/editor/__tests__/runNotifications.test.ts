// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { gateNotification, runNotification } from '../runNotifications';
import type { RunRecord } from '../../runner/runStore';

const record = (over: Partial<RunRecord>): RunRecord =>
  ({
    runId: 'r',
    flowName: 'PR review',
    flowPath: 'pr.flow.json',
    status: 'done',
    startedAt: 0,
    finishedAt: 60_000,
    nodes: {},
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    sessionIds: [],
    ...over,
  }) as RunRecord;

describe('gateNotification', () => {
  it('says which flow is waiting, where, and what it is asking', () => {
    const n = gateNotification('PR review', 'Ship it?', 'The report is drafted. Publish?');

    expect(n.title).toBe('Flow "PR review" is waiting at "Ship it?"');
    expect(n.body).toBe('The report is drafted. Publish?');
  });

  it('keeps the body to one clean line', () => {
    const n = gateNotification('f', 'g', `line one\nline two   spaced\n\n${'x'.repeat(300)}`);

    expect(n.body).not.toContain('\n');
    expect(n.body.length).toBeLessThanOrEqual(141);
    expect(n.body.endsWith('…')).toBe(true);
  });
});

describe('runNotification', () => {
  it('a finished run counts its steps and names its artifacts', () => {
    const n = runNotification(
      record({
        nodes: {
          a: { nodeId: 'a', type: 'agent', status: 'done' },
          save: { nodeId: 'save', type: 'write-file', status: 'done', output: 'wrote PR_REVIEW.md (2140 characters)' },
          skipped: { nodeId: 'skipped', type: 'write-file', status: 'skipped' },
        } as unknown as RunRecord['nodes'],
      })
    );

    expect(n.title).toBe('Flow "PR review" finished');
    expect(n.body).toBe('2 steps · wrote PR_REVIEW.md');
  });

  it('a failed run names the step and the reason, sanitized', () => {
    const n = runNotification(
      record({
        status: 'failed',
        nodes: {
          test: {
            nodeId: 'test',
            type: 'shell',
            status: 'failed',
            error: '`npm test` exited 1:\nassertion **failed**',
          },
        } as unknown as RunRecord['nodes'],
      })
    );

    expect(n.title).toBe('Flow "PR review" failed at "test"');
    expect(n.body).toBe('npm test exited 1: assertion failed');
  });

  it('a cancelled run says so plainly', () => {
    expect(runNotification(record({ status: 'cancelled' })).title).toBe(
      'Flow "PR review" was cancelled'
    );
  });
});
