import type { Flow } from '../schema/types';

export type ScheduledGatePolicy =
  /** No gates, or the schedule says to approve them. */
  | { kind: 'runnable'; autoApprove: boolean }
  /** Gates that need a person, with nobody to be that person. */
  | { kind: 'needs-a-person'; reason: string };

/**
 * Whether a scheduled run can proceed through this flow's gates.
 *
 * A scheduled run has no editor open, so a gate set to `pause` would hold the
 * run open forever and keep the flow's in-flight lock with it. Rather than
 * hang, the scheduler declines the run and says why — the author can set
 * `onGate: "skip"` (which the validator only allows where no shell node
 * follows) or run the flow themselves.
 */
export function scheduledGatePolicy(flow: Flow): ScheduledGatePolicy {
  const gates = flow.nodes.filter((node) => node.type === 'human-gate');
  if (gates.length === 0) return { kind: 'runnable', autoApprove: false };

  if (flow.schedule?.onGate === 'skip') return { kind: 'runnable', autoApprove: true };

  return {
    kind: 'needs-a-person',
    reason:
      `${flow.name} waits for a person at ${gates.map((gate) => gate.id).join(', ')}. ` +
      `A scheduled run has nobody to approve that — set the schedule's onGate to "skip", ` +
      `or run it yourself.`,
  };
}
