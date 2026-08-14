/**
 * The references a `when:` on this edge may name. The grammar (and the validator)
 * require the condition to test the edge's own `from` node, so the choices are
 * that node's output port — when the wire carries one — and its always-present
 * `error` port.
 */
export function conditionReferences(from: string, port?: string): string[] {
  const references = port ? [`${from}.${port}`] : [];
  references.push(`${from}.error`);
  return references;
}
