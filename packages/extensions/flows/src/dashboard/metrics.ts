import type { RunRecord } from '../runner/runStore';
import type { NodeExecution } from '../runner/types';
import { flowPathKey } from './flowPath';

export interface FlowMetrics {
  flowName: string;
  flowPath: string;
  /** Canonical workspace-relative identity shared by all path spellings. */
  pathKey: string;
  runs: number;
  failed: number;
  agentMs: number;
  humanMs: number;
  /** When this flow last started. Zero only when it has no runs at all. */
  lastRunAt: number;
  /** How that last run ended, which is what a reader scans the list for. */
  lastStatus: RunRecord['status'];
}

export interface RunsSummary {
  totals: {
    runs: number;
    done: number;
    failed: number;
    interrupted: number;
    running: number;
    cancelled: number;
  };
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
  if (!Number.isFinite(node.startedAt) || !Number.isFinite(node.finishedAt)) return 0;
  return Math.max(0, (node.finishedAt as number) - (node.startedAt as number));
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
export function summariseRuns(records: RunRecord[], workspaceRoot = ''): RunsSummary {
  const totals = {
    runs: records.length,
    done: 0,
    failed: 0,
    interrupted: 0,
    running: 0,
    cancelled: 0,
  };
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
    if (record.status === 'running') totals.running += 1;
    if (record.status === 'cancelled') totals.cancelled += 1;

    const pathKey = flowPathKey(record.flowPath, workspaceRoot);
    const flow = byFlow.get(pathKey) ?? {
      flowName: record.flowName,
      flowPath: record.flowPath,
      pathKey,
      runs: 0,
      failed: 0,
      agentMs: 0,
      humanMs: 0,
      lastRunAt: 0,
      lastStatus: record.status,
    };
    flow.runs += 1;
    if (record.status === 'failed') flow.failed += 1;

    // Records arrive newest-first but nothing guarantees it, so the latest wins
    // on its own timestamp rather than on arrival order.
    if (Number.isFinite(record.startedAt) && record.startedAt >= flow.lastRunAt) {
      flow.lastRunAt = record.startedAt;
      flow.lastStatus = record.status;
      flow.flowName = record.flowName;
      flow.flowPath = record.flowPath;
    }

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
      subAgents += Array.isArray(node.childSessionIds) ? node.childSessionIds.length : 0;
    }

    if (
      Number.isFinite(record.manualBaselineMinutes) &&
      (record.manualBaselineMinutes as number) > 0
    ) {
      baselineRuns += 1;
      const humanForRun = Object.values(record.nodes ?? {})
        .filter((node) => isHumanNode(node as NodeExecution & { type?: string }))
        .reduce((total, node) => total + durationOf(node), 0);
      // Never negative: a run where the people took longer than the manual
      // baseline saved nothing, it did not cost time back.
      savedMs += Math.max(0, (record.manualBaselineMinutes as number) * 60_000 - humanForRun);
    }

    const inputTokens = finiteNonNegative(record.usage?.inputTokens);
    const outputTokens = finiteNonNegative(record.usage?.outputTokens);
    const used = inputTokens + outputTokens;
    if (used > 0) sawUsage = true;
    tokens += used;

    byFlow.set(pathKey, flow);
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

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
