import type { Flow } from '../schema/types';

export type ScheduledGatePolicy =
  /** No gates, or the schedule says to approve them. */
  | { kind: 'runnable'; autoApprove: boolean }
  /** Gates that need a person, with nobody to be that person. */
  | { kind: 'needs-a-person'; reason: string };

/**
 * Whether an unattended run — scheduled or triggered — can proceed through
 * this flow's gates.
 *
 * Nobody is watching, so a gate set to `pause` would hold the run open forever
 * and keep the flow's in-flight lock with it. Rather than hang, the run is
 * declined with the reason — the author can set `onGate: "skip"` (which the
 * validator only allows where no shell node follows) or run the flow
 * themselves.
 */
export function unattendedGatePolicy(
  flow: Flow,
  onGate: 'pause' | 'skip' | undefined,
  how: 'scheduled' | 'triggered'
): ScheduledGatePolicy {
  const gates = flow.nodes.filter((node) => node.type === 'human-gate');
  if (gates.length === 0) return { kind: 'runnable', autoApprove: false };

  if (onGate === 'skip') return { kind: 'runnable', autoApprove: true };

  const owner = how === 'scheduled' ? 'schedule' : 'trigger';
  return {
    kind: 'needs-a-person',
    reason:
      `${flow.name} waits for a person at ${gates.map((gate) => gate.id).join(', ')}. ` +
      `A ${how} run has nobody to approve that — set the ${owner}'s onGate to "skip", ` +
      `or run it yourself.`,
  };
}

export function scheduledGatePolicy(flow: Flow): ScheduledGatePolicy {
  return unattendedGatePolicy(flow, flow.schedule?.onGate, 'scheduled');
}
