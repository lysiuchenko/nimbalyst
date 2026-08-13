// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resumeOffer } from '../resumeOffer';
import type { RunRecord } from '../../runner/runStore';

const record = (over: Partial<RunRecord>): RunRecord =>
  ({
    runId: 'r1',
    flowName: 'f',
    flowPath: '/w/f.flow.json',
    status: 'done',
    startedAt: 1000,
    nodes: {},
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    sessionIds: [],
    ...over,
  }) as RunRecord;

describe('resumeOffer', () => {
  it('offers the latest interrupted run with its finished-step count', () => {
    const interrupted = record({
      runId: 'r2',
      status: 'interrupted',
      startedAt: 2000,
      nodes: {
        a: { nodeId: 'a', type: 'shell', status: 'done' },
        b: { nodeId: 'b', type: 'shell', status: 'done' },
        c: { nodeId: 'c', type: 'agent', status: 'running' },
      },
    });
    const offer = resumeOffer([interrupted, record({ startedAt: 1000 })]);
    expect(offer).toEqual({ record: interrupted, finished: 2 });
  });

  it('stays quiet unless the LATEST run is the interrupted one', () => {
    // An older interruption was superseded by a newer complete run.
    const offer = resumeOffer([
      record({ runId: 'r3', status: 'done', startedAt: 3000 }),
      record({ runId: 'r2', status: 'interrupted', startedAt: 2000 }),
    ]);
    expect(offer).toBeNull();
  });

  it('does not offer for failed or cancelled runs — those had a witness', () => {
    expect(resumeOffer([record({ status: 'failed' })])).toBeNull();
    expect(resumeOffer([record({ status: 'cancelled' })])).toBeNull();
  });

  it('does not offer while the latest record is still running, or with no history', () => {
    expect(resumeOffer([record({ status: 'running' })])).toBeNull();
    expect(resumeOffer([])).toBeNull();
  });
});
