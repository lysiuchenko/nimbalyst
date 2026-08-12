import type { RunRecord } from '../runner/runStore';
import type { RunStatus } from '../runner/types';
import { isStale } from '../runner/staleRuns';
import type { WorkspaceFiles } from '../host/workspaceScan';
import { flowBasename } from './flowPath';

export interface RunRecordProblem {
  /** Path only: never echo the possibly sensitive record contents. */
  path: string;
}

export interface LoadedRuns {
  records: RunRecord[];
  problems: RunRecordProblem[];
}

const RUN_STATUSES = new Set<RunStatus>(['running', 'done', 'failed', 'cancelled', 'interrupted']);

/**
 * Every run record in the workspace.
 *
 * `findFiles` walks from a glob's literal prefix, so the pattern has to start
 * with the directory name; a leading `**` finds nothing.
 */
export async function loadAllRuns(
  files: WorkspaceFiles,
  now: number = Date.now()
): Promise<LoadedRuns> {
  // A scan failure is an infrastructure problem, not an empty history. Let the
  // dashboard distinguish it and offer Retry.
  const paths = (await files.findFiles('.flow-runs/*.json')) ?? [];

  const loaded = await Promise.all(
    paths
      // Schedule state lives beside the runs but is not one.
      .filter((path) => !path.endsWith('.schedule.json'))
      .map(async (path) => {
        try {
          return {
            path,
            record: toRunRecord(JSON.parse(await files.readFile(path))),
          };
        } catch {
          return { path, record: null };
        }
      })
  );

  const problems = loaded.filter(({ record }) => record === null).map(({ path }) => ({ path }));
  const records = loaded
    .flatMap(({ record }) => (record ? [record] : []))
    // The dashboard has no writer, but it must not call an abandoned run
    // healthy. The editor persists the same repair when that flow is opened.
    .map((record) =>
      isStale(record, null, now)
        ? ({
            ...record,
            status: 'interrupted',
            updatedAt: now,
          } satisfies RunRecord)
        : record
    )
    .sort((a, b) => b.startedAt - a.startedAt);

  return { records, problems };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Normalise compatible old records while rejecting fields needed for identity. */
function toRunRecord(value: unknown): RunRecord | null {
  if (!isObject(value)) return null;
  if (!nonEmptyString(value.runId) || !nonEmptyString(value.flowPath)) return null;
  if (!RUN_STATUSES.has(value.status as RunStatus) || !Number.isFinite(value.startedAt))
    return null;
  if (!isObject(value.nodes) || !Object.values(value.nodes).every(isObject)) return null;

  const usage = isObject(value.usage) ? value.usage : {};
  const inputTokens = Number.isFinite(usage.inputTokens) ? (usage.inputTokens as number) : 0;
  const outputTokens = Number.isFinite(usage.outputTokens) ? (usage.outputTokens as number) : 0;
  const baseline =
    Number.isFinite(value.manualBaselineMinutes) && (value.manualBaselineMinutes as number) > 0
      ? (value.manualBaselineMinutes as number)
      : undefined;

  return {
    runId: value.runId,
    flowName: nonEmptyString(value.flowName) ? value.flowName : flowBasename(value.flowPath),
    flowPath: value.flowPath,
    status: value.status as RunStatus,
    startedAt: value.startedAt as number,
    ...(Number.isFinite(value.finishedAt) ? { finishedAt: value.finishedAt as number } : {}),
    ...(Number.isFinite(value.updatedAt) ? { updatedAt: value.updatedAt as number } : {}),
    ...(baseline !== undefined ? { manualBaselineMinutes: baseline } : {}),
    nodes: value.nodes as unknown as RunRecord['nodes'],
    outputs: isObject(value.outputs) ? (value.outputs as RunRecord['outputs']) : {},
    usage: {
      inputTokens,
      outputTokens,
      ...(Number.isFinite(usage.costUsd) ? { costUsd: usage.costUsd as number } : {}),
    },
    sessionIds: Array.isArray(value.sessionIds)
      ? value.sessionIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}
