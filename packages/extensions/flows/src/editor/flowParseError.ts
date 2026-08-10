import { parseFlowFile } from '../schema/validate';
import type { Flow, ValidationError } from '../schema/types';

/** What a brand-new `.flow.json` means before anyone has drawn anything. */
export const EMPTY_FLOW: Flow = {
  version: 1,
  name: 'untitled',
  nodes: [],
  edges: [],
  variables: {},
};

/**
 * A load failure that still knows everything that was wrong.
 *
 * `validateFlow` deliberately collects every problem rather than stopping at
 * the first, so that the editor can list them. The editor used to take
 * `errors[0]` and discard the rest, which turned fixing a flow into one
 * reload per mistake.
 */
export class FlowParseError extends Error {
  constructor(readonly errors: ValidationError[]) {
    super(summarise(errors));
    this.name = 'FlowParseError';
  }
}

/** The validated flow, or a `FlowParseError` carrying every problem. */
export function parseFlowOrThrow(raw: string): Flow {
  const parsed = parseFlowFile(raw.trim() === '' ? JSON.stringify(EMPTY_FLOW) : raw);
  if (!parsed.valid) throw new FlowParseError(parsed.errors);
  return parsed.flow;
}

/** The problems behind a load failure, where there are any to show. */
export function flowErrorsOf(error: unknown): ValidationError[] | null {
  return error instanceof FlowParseError ? error.errors : null;
}

/**
 * The one-line form, for anything that shows only `error.message`.
 *
 * A single problem reads as itself; several are counted, because a paragraph
 * of concatenated messages is worse than a number plus the list below it.
 */
function summarise(errors: ValidationError[]): string {
  const [first] = errors;
  if (errors.length === 1) {
    return first.path ? `${first.path}: ${first.message}` : first.message;
  }
  return `${errors.length} problems in this flow`;
}
