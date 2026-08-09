// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../../runner/runStore';
import { displayStatus, historySummary, relativeWhen, runOutcome, tokensLabel } from '../runSummary';

const record = (over: Partial<RunRecord> = {}): RunRecord =>
  ({
    runId: 'run-1',
    flowName: 'f',
    flowPath: '/f.flow.json',
    status: 'done',
    startedAt: 1_000,
    finishedAt: 2_000,
    nodes: {},
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    sessionIds: [],
    ...over,
  }) as RunRecord;

const nodes = (statuses: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(statuses).map(([nodeId, status]) => [nodeId, { nodeId, status }])
  ) as RunRecord['nodes'];

describe('displayStatus', () => {
  it('calls a run running only while this editor is the one running it', () => {
    const live = record({ runId: 'run-7', status: 'running' });

    expect(displayStatus(live, 'run-7')).toBe('running');
  });

  it('calls a stranded run interrupted rather than leaving it running forever', () => {
    // The app closed mid-run: the record still says running, but nothing is.
    const stranded = record({ runId: 'run-7', status: 'running' });

    expect(displayStatus(stranded, null)).toBe('interrupted');
    expect(displayStatus(stranded, 'run-9')).toBe('interrupted');
  });

  it('leaves a settled run alone', () => {
    expect(displayStatus(record({ status: 'failed' }), null)).toBe('failed');
    expect(displayStatus(record({ status: 'done' }), 'run-1')).toBe('done');
  });
});

describe('runOutcome', () => {
  it('names the step a run failed at, which is what a reader needs first', () => {
    const failed = record({
      status: 'failed',
      nodes: nodes({ plan: 'done', review: 'failed', ship: 'skipped' }),
    });

    expect(runOutcome(failed, 'failed')).toBe('1 of 3 steps · failed at review');
  });

  it('reports a finished run as complete', () => {
    const done = record({ status: 'done', nodes: nodes({ a: 'done', b: 'done' }) });

    expect(runOutcome(done, 'done')).toBe('2 of 2 steps');
  });

  it('says how far an interrupted run got', () => {
    const stranded = record({
      status: 'running',
      nodes: nodes({ a: 'done', b: 'running', c: 'queued' }),
    });

    expect(runOutcome(stranded, 'interrupted')).toBe('1 of 3 steps · stopped at b');
  });

  it('has nothing to say about a run with no recorded steps', () => {
    expect(runOutcome(record({ nodes: {} }), 'done')).toBe('');
  });
});

describe('tokensLabel', () => {
  it('reports real usage', () => {
    expect(tokensLabel(record({ usage: { inputTokens: 900, outputTokens: 120 } }))).toBe('1,020');
  });

  it('admits it does not know rather than claiming a run was free', () => {
    // The host leaves tokenUsage null on this path, so zero means unrecorded.
    expect(tokensLabel(record({ usage: { inputTokens: 0, outputTokens: 0 } }))).toBe('—');
  });
});

describe('relativeWhen', () => {
  const now = new Date('2026-08-09T12:00:00Z').getTime();

  it('reads as elapsed time for a recent run', () => {
    expect(relativeWhen(now - 45_000, now)).toBe('just now');
    expect(relativeWhen(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(relativeWhen(now - 3 * 3_600_000, now)).toBe('3 hr ago');
  });

  it('falls back to a date once elapsed time stops being useful', () => {
    expect(relativeWhen(now - 8 * 86_400_000, now)).toMatch(/\d/);
    expect(relativeWhen(now - 8 * 86_400_000, now)).not.toContain('ago');
  });
});

describe('historySummary', () => {
  it('orients the reader before they scan the rows', () => {
    const records = [
      record({ runId: 'a', status: 'done' }),
      record({ runId: 'b', status: 'failed' }),
      record({ runId: 'c', status: 'running' }),
      record({ runId: 'd', status: 'running' }),
    ];

    expect(historySummary(records, 'c')).toBe('4 runs · 1 failed · 1 interrupted');
  });

  it('says nothing extra when every run simply worked', () => {
    expect(historySummary([record({ status: 'done' })], null)).toBe('1 run');
  });
});
