import type { Flow } from '../schema/types';
import { decideNextAction } from './decide';
import type { ScheduleState } from './types';

/** A scheduled flow as the headless scheduler sees it. */
export interface ScheduledEntry {
  flowPath: string;
  flow: Flow;
  state: ScheduleState;
}

export interface DueFlow extends ScheduledEntry {
  due: number;
}

export interface BlockedFlow extends ScheduledEntry {
  reason: string;
}

export interface DueClassification {
  /** Due, and runnable without the app. */
  runnable: DueFlow[];
  /** Due, but containing work only the app can do. */
  needsApp: BlockedFlow[];
  /** Not due yet. */
  waiting: ScheduledEntry[];
  /** Due so long ago that running now would be surprising. */
  missed: DueFlow[];
}

/** Node types whose work goes through the host's agent, which needs the app. */
const AGENT_NODE_TYPES = new Set(['agent', 'fan-out', 'skill', 'slash-command']);

/**
 * Why a flow cannot run outside the app, or null if it can.
 *
 * Agent work goes through the host's own Claude Code provider, which owns the
 * credentials and the binary resolution this extension deliberately does not
 * re-implement. Shell and gate flows have no such dependency, and those are
 * exactly the ones worth running on a timer while nobody is looking.
 */
export function needsTheApp(flow: Flow): string | null {
  const agentNodes = flow.nodes.filter((node) => AGENT_NODE_TYPES.has(node.type));
  if (agentNodes.length === 0) return null;

  return (
    `${flow.name} runs ${agentNodes.map((node) => node.id).join(', ')} through an agent, ` +
    `which only works with Nimbalyst open`
  );
}

/** Sort scheduled flows into what can be run now, later, or not here at all. */
export function classifyDue(
  entries: ScheduledEntry[],
  now: number = Date.now()
): DueClassification {
  const result: DueClassification = { runnable: [], needsApp: [], waiting: [], missed: [] };

  for (const entry of entries) {
    const schedule = entry.flow.schedule;
    if (!schedule) continue;

    const action = decideNextAction(schedule, entry.state, false, now);

    if (action.kind === 'idle') continue;
    if (action.kind === 'wait') {
      result.waiting.push(entry);
      continue;
    }
    if (action.kind === 'skip') {
      result.missed.push({ ...entry, due: action.due });
      continue;
    }
    if (action.kind !== 'run') continue;

    const blocked = needsTheApp(entry.flow);
    if (blocked) result.needsApp.push({ ...entry, reason: blocked });
    else result.runnable.push({ ...entry, due: action.due });
  }

  return result;
}
