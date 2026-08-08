import { createContext, useContext } from 'react';
import type { ChildProgress, NodeStatus } from '../runner/types';

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
