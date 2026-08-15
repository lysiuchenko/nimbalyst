import { createContext, useContext } from 'react';
import type { Catalog } from '../host/catalog';
import { EMPTY_AGENT_CAPABILITIES, TOOL_CHOICES } from '../host/catalog';

export const EMPTY_CATALOG: Catalog = {
  skills: [],
  commands: [],
  agentCapabilities: EMPTY_AGENT_CAPABILITIES,
  tools: TOOL_CHOICES,
};

/** What the node pickers offer. Loaded once per editor, read by every node. */
export const CatalogContext = createContext<Catalog>(EMPTY_CATALOG);

export function useCatalog(): Catalog {
  return useContext(CatalogContext);
}

/**
 * The `{{…}}` references a node may legally use: flow variables, plus the
 * outputs published by nodes upstream of it.
 */
export const ReferencesContext = createContext<Record<string, string[]>>({});

export function useReferences(nodeId: string): string[] {
  return useContext(ReferencesContext)[nodeId] ?? [];
}

/** Per-node validation messages, keyed by node id. */
export const NodeIssuesContext = createContext<Record<string, string[]>>({});

export function useNodeIssues(nodeId: string): string[] {
  return useContext(NodeIssuesContext)[nodeId] ?? [];
}
