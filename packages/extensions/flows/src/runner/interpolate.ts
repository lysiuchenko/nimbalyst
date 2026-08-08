/** `{{name}}` or `{{nodeId.port}}`, tolerant of surrounding whitespace. */
const REFERENCE = /\{\{\s*([^{}\s]+)\s*\}\}/g;

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
 */
export function interpolate(template: string, scope: InterpolationScope): string {
  return template.replace(REFERENCE, (_match, reference: string) => resolve(reference, scope));
}

function resolve(reference: string, scope: InterpolationScope): string {
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

/** Every reference in `template`, in the order they appear. */
export function listReferences(template: string): string[] {
  return [...template.matchAll(REFERENCE)].map((match) => match[1]);
}
