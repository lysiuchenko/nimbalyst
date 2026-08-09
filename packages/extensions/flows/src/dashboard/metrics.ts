import type { RunRecord } from '../runner/runStore';
import type { NodeExecution } from '../runner/types';

export interface FlowMetrics {
  flowName: string;
  flowPath: string;
  runs: number;
  failed: number;
  agentMs: number;
  humanMs: number;
}

export interface RunsSummary {
  totals: { runs: number; done: number; failed: number; interrupted: number };
  /** Time nodes worked, excluding time a person was deciding. */
  agentMs: number;
  /** Time spent waiting at human gates — literally how long people blocked flows. */
  humanMs: number;
  /** Sub-agents spawned by fan-out nodes. */
  subAgents: number;
  /** Null when no run recorded any usage; see docs — zero would be a lie. */
  tokens: number | null;
  /**
   * Estimated time saved, from the baselines flow authors supplied.
   *
   * Null when no run carried one. This is the only figure here that is not
   * measured, which is why it depends on someone having stated a baseline
   * rather than on a multiplier chosen for them.
   */
  savedMs: number | null;
  /** How many runs the estimate is based on, so it can be qualified. */
  baselineRuns: number;
  byFlow: FlowMetrics[];
}

function durationOf(node: NodeExecution): number {
  if (node.startedAt === undefined || node.finishedAt === undefined) return 0;
  return Math.max(0, node.finishedAt - node.startedAt);
}

/** A gate's duration is a person deciding; everything else is the machine. */
function isHumanNode(node: NodeExecution & { type?: string }): boolean {
  return node.type === 'human-gate';
}

/**
 * What a workspace's runs add up to.
 *
 * Every figure here is measured from run records rather than estimated. The one
 * number people ask for and cannot have — hours *saved* — is deliberately
 * absent: nothing in a run record knows how long the work would have taken by
 * hand, and inventing a multiplier would make the rest untrustworthy too.
 */
export function summariseRuns(records: RunRecord[]): RunsSummary {
  const totals = { runs: records.length, done: 0, failed: 0, interrupted: 0 };
  const byFlow = new Map<string, FlowMetrics>();
  let agentMs = 0;
  let humanMs = 0;
  let subAgents = 0;
  let tokens = 0;
  let sawUsage = false;
  let savedMs = 0;
  let baselineRuns = 0;

  for (const record of records) {
    if (record.status === 'done') totals.done += 1;
    if (record.status === 'failed') totals.failed += 1;
    if (record.status === 'interrupted') totals.interrupted += 1;

    const flow = byFlow.get(record.flowPath) ?? {
      flowName: record.flowName,
      flowPath: record.flowPath,
      runs: 0,
      failed: 0,
      agentMs: 0,
      humanMs: 0,
    };
    flow.runs += 1;
    if (record.status === 'failed') flow.failed += 1;

    for (const node of Object.values(record.nodes ?? {})) {
      const typed = node as NodeExecution & { type?: string };
      const ms = durationOf(node);
      if (isHumanNode(typed)) {
        humanMs += ms;
        flow.humanMs += ms;
      } else {
        agentMs += ms;
        flow.agentMs += ms;
      }
      subAgents += node.childSessionIds?.length ?? 0;
    }

    if (record.manualBaselineMinutes !== undefined) {
      baselineRuns += 1;
      const humanForRun = Object.values(record.nodes ?? {})
        .filter((node) => isHumanNode(node as NodeExecution & { type?: string }))
        .reduce((total, node) => total + durationOf(node), 0);
      // Never negative: a run where the people took longer than the manual
      // baseline saved nothing, it did not cost time back.
      savedMs += Math.max(0, record.manualBaselineMinutes * 60_000 - humanForRun);
    }

    const used = (record.usage?.inputTokens ?? 0) + (record.usage?.outputTokens ?? 0);
    if (used > 0) sawUsage = true;
    tokens += used;

    byFlow.set(record.flowPath, flow);
  }

  return {
    totals,
    agentMs,
    humanMs,
    subAgents,
    tokens: sawUsage ? tokens : null,
    savedMs: baselineRuns > 0 ? savedMs : null,
    baselineRuns,
    byFlow: [...byFlow.values()].sort((a, b) => b.runs - a.runs),
  };
}
