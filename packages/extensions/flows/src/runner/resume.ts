import type { Flow, FlowNode } from '../schema/types';
import type { NodeExecution } from './types';
import type { RunRecord } from './runStore';

/**
 * Decide which of a failed run's results are still trustworthy.
 *
 * A run that fails at step 8 of 10 should not re-pay for the seven steps that
 * worked: agents re-bill, gates re-ask a person, write-file steps re-write.
 * The record already holds every finished node's output; what it lacks is the
 * rule for when that output can be believed. The rule:
 *
 *   reuse a node iff the record shows it done, its definition is unchanged,
 *   and every direct parent is itself reused.
 *
 * The parent condition cascades in topological order, so editing one node
 * re-runs everything downstream of it — a re-run node's output may differ, and
 * anything built on it must be rebuilt too. Siblings on other branches stand.
 */

export interface ResumePlan {
  /** Executions to pre-complete, keyed by node id. */
  reused: Map<string, NodeExecution>;
  /** The interpolation map entries belonging to reused nodes. */
  outputs: Record<string, Record<string, string>>;
  /** The run being resumed, for the new record's `resumedFrom`. */
  resumedFrom: string;
}

/** Fields that do not change what a node *does*. */
const COSMETIC_FIELDS = new Set(['position', 'label']);

/**
 * A stable fingerprint of what a node would do if run.
 *
 * Not cryptographic — this detects edits, it does not defend against them.
 * Key order is normalised so hand-edited JSON hashes the same as saved JSON.
 */
export function nodeDefinitionHash(node: FlowNode): string {
  const functional = Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !COSMETIC_FIELDS.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
  );
  return fnv1a(JSON.stringify(functional));
}

export function planResume(flow: Flow, record: RunRecord): ResumePlan {
  const parents = new Map<string, string[]>();
  for (const node of flow.nodes) parents.set(node.id, []);
  for (const edge of flow.edges) parents.get(edge.to)?.push(edge.from);

  const reused = new Map<string, NodeExecution>();

  for (const node of topological(flow)) {
    const recorded = record.nodes?.[node.id];
    if (recorded?.status !== 'done') continue;
    // Records from before hashes existed reuse nothing — honest, and it
    // self-corrects the next time the flow runs.
    if (!recorded.definitionHash || recorded.definitionHash !== nodeDefinitionHash(node)) continue;
    if (!(parents.get(node.id) ?? []).every((parent) => reused.has(parent))) continue;

    reused.set(node.id, {
      nodeId: node.id,
      type: recorded.type,
      status: 'done',
      // The result is carried; the cost is not. Old timings and usage would
      // double-count the original run's work on the dashboard.
      output: recorded.output,
      sessionId: recorded.sessionId,
      childSessionIds: recorded.childSessionIds,
      warning: recorded.warning,
      definitionHash: recorded.definitionHash,
      reused: true,
    });
  }

  const outputs: Record<string, Record<string, string>> = {};
  for (const [nodeId, published] of Object.entries(record.outputs ?? {})) {
    if (reused.has(nodeId)) outputs[nodeId] = published;
  }

  return { reused, outputs, resumedFrom: record.runId };
}

/** Parent-before-child order; the flow is a validated DAG, so this terminates. */
function topological(flow: Flow): FlowNode[] {
  const pending = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const node of flow.nodes) {
    pending.set(node.id, 0);
    children.set(node.id, []);
  }
  for (const edge of flow.edges) {
    pending.set(edge.to, (pending.get(edge.to) ?? 0) + 1);
    children.get(edge.from)?.push(edge.to);
  }

  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const queue = flow.nodes.filter((node) => pending.get(node.id) === 0).map((node) => node.id);
  const ordered: FlowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const child of children.get(id) ?? []) {
      pending.set(child, (pending.get(child) ?? 1) - 1);
      if (pending.get(child) === 0) queue.push(child);
    }
  }
  return ordered;
}

/** FNV-1a, 32-bit: tiny, deterministic, and dependency-free. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
