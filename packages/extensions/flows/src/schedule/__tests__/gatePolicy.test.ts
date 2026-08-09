// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { scheduledGatePolicy } from '../gatePolicy';
import type { Flow } from '../../schema/types';

const flowOf = (nodes: unknown[], schedule?: unknown) =>
  ({ version: 1, name: 'nightly', nodes, edges: [], variables: {}, schedule }) as unknown as Flow;

describe('scheduledGatePolicy', () => {
  it('lets a gateless flow run', () => {
    expect(scheduledGatePolicy(flowOf([{ id: 'a', type: 'agent', prompt: 'p' }]))).toEqual({
      kind: 'runnable',
      autoApprove: false,
    });
  });

  it('approves gates when the schedule says to', () => {
    const policy = scheduledGatePolicy(
      flowOf([{ id: 'g', type: 'human-gate', message: 'ok?' }], {
        type: 'daily',
        time: '02:00',
        enabled: true,
        onGate: 'skip',
      })
    );

    expect(policy).toEqual({ kind: 'runnable', autoApprove: true });
  });

  it('declines rather than hanging on a gate nobody can answer', () => {
    // A paused run would hold the flow's in-flight lock forever.
    const policy = scheduledGatePolicy(
      flowOf([{ id: 'approve', type: 'human-gate', message: 'ok?' }], {
        type: 'daily',
        time: '02:00',
        enabled: true,
      })
    );

    expect(policy.kind).toBe('needs-a-person');
    expect(policy.kind === 'needs-a-person' && policy.reason).toContain('approve');
  });
});
