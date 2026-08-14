/**
 * The `when:` grammar, whole: `{{from.port}} (contains | == | !=) "literal"`.
 *
 * Deliberately this small. No chains, no numbers, no boolean operators — an
 * expression language inside a flow file is how flows stop being reviewable.
 * The reference must name the edge's own `from` node (the validator enforces
 * that); a condition on an edge is about the step it leaves.
 */

const CONDITION =
  /^\s*\{\{\s*([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*\}\}\s+(contains|==|!=)\s+"([^"]*)"\s*$/;

export interface EdgeCondition {
  /** `nodeId.port` — the implicit `error` port included. */
  reference: string;
  op: 'contains' | '==' | '!=';
  literal: string;
}

export function parseEdgeCondition(expression: string): EdgeCondition {
  const match = expression.match(CONDITION);
  if (!match) {
    throw new Error(
      `a when condition must be {{node.port}} contains|==|!= "literal", got ${JSON.stringify(expression)}`
    );
  }
  return { reference: match[1], op: match[2] as EdgeCondition['op'], literal: match[3] };
}

/** The `when:` string for a condition — the inverse of `parseEdgeCondition`. */
export function formatEdgeCondition(condition: EdgeCondition): string {
  return `{{${condition.reference}}} ${condition.op} "${condition.literal}"`;
}

/**
 * Parse without throwing, for the editor: an existing `when:` is loaded into the
 * form, and a value that no longer parses simply starts the form empty rather
 * than crashing the panel.
 */
export function tryParseEdgeCondition(expression: string): EdgeCondition | null {
  try {
    return parseEdgeCondition(expression);
  } catch {
    return null;
  }
}

/**
 * True only when the reference resolves and the comparison holds.
 *
 * An unresolvable reference is false, not an error: at evaluation time the
 * step has completed with *some* outcome, and a port it did not publish simply
 * cannot match — the edge is dead, exactly like an unmatched `on`.
 */
export function evaluateEdgeCondition(
  condition: EdgeCondition,
  outputs: Record<string, Record<string, string>>
): boolean {
  const dot = condition.reference.indexOf('.');
  const value = outputs[condition.reference.slice(0, dot)]?.[condition.reference.slice(dot + 1)];
  if (value === undefined) return false;

  switch (condition.op) {
    case 'contains':
      return value.includes(condition.literal);
    case '==':
      return value === condition.literal;
    case '!=':
      return value !== condition.literal;
  }
}
