import type { Flow, ValidationError } from '../schema/types';
import { serializeFlow, validateFlow } from '../schema/validate';
import { graphToFlow, type FlowGraph } from './flowGraph';

export type PrepareSaveResult =
  | { ok: true; text: string; flow: Flow }
  | { ok: false; errors: ValidationError[]; summary: string };

/** How many errors the one-line summary names before it starts counting. */
const SUMMARY_LIMIT = 3;

/**
 * Turn the live canvas into the text to write, refusing invalid flows.
 *
 * The editor never writes a `.flow.json` the validator would reject — a broken
 * file would fail to reopen, so the canvas is the last place to catch it.
 */
export function prepareSave(base: Flow, graph: FlowGraph): PrepareSaveResult {
  const candidate = graphToFlow(base, graph);
  const result = validateFlow(candidate);

  if (!result.valid) {
    return { ok: false, errors: result.errors, summary: summarize(result.errors) };
  }

  return { ok: true, text: serializeFlow(result.flow), flow: result.flow };
}

function summarize(errors: ValidationError[]): string {
  const shown = errors
    .slice(0, SUMMARY_LIMIT)
    .map((error) => (error.path ? `${error.path}: ${error.message}` : error.message))
    .join('; ');
  const remaining = errors.length - SUMMARY_LIMIT;
  const tail = remaining > 0 ? ` (and ${remaining} more)` : '';

  return `Flow is invalid and was not saved: ${shown}${tail}`;
}
