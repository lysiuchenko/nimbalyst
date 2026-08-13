import { createContext, useContext } from 'react';
import type { ChildProgress, NodeExecution, NodeStatus } from '../runner/types';

/**
 * Per-node run status, published to the node components.
 *
 * Kept out of the xyflow store on purpose: writing status into node data would
 * look like a document edit, mark the file dirty, and put run state into the
 * saved `.flow.json`.
 */
export const RunStatusContext = createContext<Record<string, NodeStatus>>({});

export function useNodeStatus(nodeId: string): NodeStatus | undefined {
  return useContext(RunStatusContext)[nodeId];
}

/**
 * Sub-agents of a fan-out node, live.
 *
 * Separate from status because they arrive mid-node: a fan-out decides how many
 * sub-agents it needs only once its list resolves.
 */
export const NodeChildrenContext = createContext<Record<string, ChildProgress[]>>({});

export function useNodeChildren(nodeId: string): ChildProgress[] {
  return useContext(NodeChildrenContext)[nodeId] ?? [];
}

/**
 * Each node's live execution — output and error included — as the run
 * progresses. What lets a card answer "what did this step just produce?"
 * without opening a session or waiting for the history table.
 *
 * Same rule as status: never written into the xyflow store, because run state
 * must not dirty the document.
 */
export const NodeResultsContext = createContext<Record<string, NodeExecution>>({});

export function useNodeResult(nodeId: string): NodeExecution | undefined {
  return useContext(NodeResultsContext)[nodeId];
}

/**
 * Per-node outcome counts across the recorded runs, for the reliability chip.
 * A node missing from the map has no recorded outcomes.
 */
export const NodeReliabilityContext = createContext<
  Record<string, { ok: number; total: number }>
>({});

export function useNodeReliability(nodeId: string): { ok: number; total: number } | undefined {
  return useContext(NodeReliabilityContext)[nodeId];
}

/**
 * Run-from-here, when it is available: a callback while the editor has a past
 * record to seed from and no run in flight; null otherwise, and the cards hide
 * the button rather than offering a dead control.
 */
export const RunFromContext = createContext<((nodeId: string) => void) | null>(null);

export function useRunFrom(): ((nodeId: string) => void) | null {
  return useContext(RunFromContext);
}
