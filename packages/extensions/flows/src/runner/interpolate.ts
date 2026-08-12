/**
 * `{{name}}`, `{{nodeId.port}}`, or a fallback chain
 * `{{test.out ?? repair.out ?? "nothing"}}`.
 *
 * Chains exist for rejoined branches: after a conditional fork meets at a
 * `join: "any"` node, exactly one arm ran — the node's input is whichever
 * output exists. Arms resolve left to right; a double-quoted literal may stand
 * last as the value of last resort.
 */
const REFERENCE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** The strict single-reference token shape references had before chains. */
const SINGLE = /^[^{}\s]+$/;

export interface InterpolationScope {
  variables: Record<string, string>;
  /** Outputs published so far, keyed by node id then port name. */
  outputs: Record<string, Record<string, string>>;
}

export class UnresolvedReferenceError extends Error {
  constructor(
    readonly reference: string,
    reason: string
  ) {
    super(`unknown reference {{${reference}}}: ${reason}`);
    this.name = 'UnresolvedReferenceError';
  }
}

/**
 * Substitute every `{{…}}` reference in `template`.
 *
 * Throws rather than leaving a reference in place: a prompt that still contains
 * `{{plan.plan_md}}` would be sent to the model verbatim, which is worse than a
 * clear failure.
 *
 * Braced prose with spaces and no `??` — `{{ handlebars snippet }}` — is left
 * verbatim, exactly as it was before chains widened the brace pattern.
 */
export function interpolate(template: string, scope: InterpolationScope): string {
  return template.replace(REFERENCE, (match, expression: string) => {
    if (!isExpression(expression)) return match;
    return resolveExpression(expression, scope);
  });
}

/** A chain, or the strict token form. Spaced prose is neither. */
function isExpression(expression: string): boolean {
  return expression.includes('??') || SINGLE.test(expression);
}

/** The arms of an expression: its references, plus a trailing literal if any. */
export function referenceArms(expression: string): {
  references: string[];
  literal: string | undefined;
} {
  const arms = expression.split('??').map((arm) => arm.trim());
  const literalArm = arms.find((arm) => /^".*"$/.test(arm));
  return {
    references: arms.filter((arm) => !/^".*"$/.test(arm)),
    literal: literalArm === undefined ? undefined : literalArm.slice(1, -1),
  };
}

function resolveExpression(expression: string, scope: InterpolationScope): string {
  const arms = expression.split('??').map((arm) => arm.trim());

  for (const arm of arms) {
    const literal = /^".*"$/.test(arm);
    if (literal) return arm.slice(1, -1);
    const value = lookup(arm, scope);
    if (value !== undefined) return value;
  }

  // Single references keep their precise diagnosis; a chain names itself whole
  // — which arm failed matters less than that all of them did.
  if (arms.length === 1) {
    lookupOrThrow(arms[0], scope);
  }
  throw new UnresolvedReferenceError(expression, 'no arm of the chain resolved');
}

function lookup(reference: string, scope: InterpolationScope): string | undefined {
  const dot = reference.indexOf('.');
  if (dot === -1) return scope.variables[reference];
  return scope.outputs[reference.slice(0, dot)]?.[reference.slice(dot + 1)];
}

function lookupOrThrow(reference: string, scope: InterpolationScope): string {
  const dot = reference.indexOf('.');

  if (dot === -1) {
    const value = scope.variables[reference];
    if (value === undefined) {
      throw new UnresolvedReferenceError(reference, 'no variable or node output by that name');
    }
    return value;
  }

  const nodeId = reference.slice(0, dot);
  const port = reference.slice(dot + 1);
  const nodeOutputs = scope.outputs[nodeId];

  if (nodeOutputs === undefined) {
    throw new UnresolvedReferenceError(
      reference,
      `no node ${JSON.stringify(nodeId)} has produced output`
    );
  }
  const value = nodeOutputs[port];
  if (value === undefined) {
    throw new UnresolvedReferenceError(
      reference,
      `node ${JSON.stringify(nodeId)} published no output named ${JSON.stringify(port)}`
    );
  }
  return value;
}

/** Every reference expression in `template`, in order. Spaced prose is skipped. */
export function listReferences(template: string): string[] {
  return [...template.matchAll(REFERENCE)]
    .map((match) => match[1])
    .filter((expression) => isExpression(expression));
}
