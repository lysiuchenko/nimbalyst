/**
 * The typing half of reference insertion: as an author types inside a text
 * field, an open `{{` turns the field into a small completer over the inputs
 * that node may legally use. The always-visible chips stay for browsing; this
 * is for the author who knows the name and wants it without reaching for a
 * mouse. Pure so the caret arithmetic is tested without a DOM.
 */

/** Characters that make up a reference name — `nodeId.port`, or a variable. */
const REF_CHAR = /[A-Za-z0-9_.-]/;

/**
 * The partial reference the caret is editing, or null when it is not inside an
 * open `{{`. "Open" means the nearest `{{` before the caret has no `}}` between
 * it and the caret — a closed token is finished, not being typed.
 */
export function activeRefQuery(
  value: string,
  caret: number
): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const start = before.lastIndexOf('{{');
  if (start === -1) return null;

  const query = before.slice(start + 2);
  // A `}` in the partial means the token is (being) closed, not typed into.
  if (query.includes('}')) return null;
  return { start, query };
}

/**
 * Insert `reference` for the open token the caret is in, returning the new
 * value and where to put the caret. Any braces the token already had are
 * consumed rather than duplicated, so completing `{{fo|}}` yields `{{foo}}`,
 * not `{{foo}}}}`.
 */
export function applyRef(
  value: string,
  caret: number,
  reference: string
): { value: string; caret: number } {
  const active = activeRefQuery(value, caret);
  if (!active) return { value, caret };

  let end = caret;
  while (end < value.length && REF_CHAR.test(value[end])) end++;
  if (value.slice(end, end + 2) === '}}') end += 2;

  const token = `{{${reference}}}`;
  return {
    value: value.slice(0, active.start) + token + value.slice(end),
    caret: active.start + token.length,
  };
}

/** The references worth offering for `query` — case-insensitive substring. */
export function suggestRefs(references: string[], query: string): string[] {
  const needle = query.toLowerCase();
  return references.filter((reference) => reference.toLowerCase().includes(needle));
}
