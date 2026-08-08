import type { Flow, FlowNode } from '../schema/types';
import type { FlowCanvasNode } from './flowGraph';

/** `agent`, `agent-2`, `agent-3`… readable and unique. */
export function uniqueNodeId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const DUPLICATE_OFFSET = 40;

/**
 * Copy a node, keeping its work but not its identity.
 *
 * The output port is deliberately dropped: two nodes publishing the same port
 * name is ambiguous, and the validator would be right to complain.
 */
export function duplicateNode(
  original: FlowCanvasNode,
  existing: FlowCanvasNode[]
): FlowCanvasNode {
  const id = uniqueNodeId(original.id, new Set(existing.map((node) => node.id)));
  const { output: _dropped, ...rest } = original.data.node as FlowNode & { output?: string };

  return {
    ...original,
    id,
    // Derived, never copied: the canvas type must always mirror the flow node's
    // type, and deriving it removes any chance of the two drifting apart.
    type: (original.data.node as FlowNode).type,
    selected: false,
    position: {
      x: original.position.x + DUPLICATE_OFFSET,
      y: original.position.y + DUPLICATE_OFFSET,
    },
    data: { node: { ...rest, id } as FlowNode },
  };
}

/** Why a variable name is unusable, or undefined when it is fine. */
export function validVariableName(name: string): string | undefined {
  if (name.trim() === '') return 'a variable needs a name';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return 'use letters, digits and underscores — a dot would look like a node output';
  }
  return undefined;
}

/**
 * Rename a variable and rewrite every `{{…}}` that used it.
 *
 * Renaming without rewriting would silently break every prompt referencing the
 * old name, and the breakage would only surface at run time.
 */
export function renameVariable(flow: Flow, from: string, to: string): Flow {
  const pattern = new RegExp(`\\{\\{\\s*${escapeRegExp(from)}\\s*\\}\\}`, 'g');

  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(flow.variables)) {
    variables[key === from ? to : key] = value;
  }

  return {
    ...flow,
    variables,
    nodes: flow.nodes.map((node) => {
      const next: Record<string, unknown> = { ...node };
      for (const [key, value] of Object.entries(next)) {
        if (typeof value === 'string') next[key] = value.replace(pattern, `{{${to}}}`);
      }
      return next as unknown as FlowNode;
    }),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
