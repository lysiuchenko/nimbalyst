// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../validate';

/** Built rather than written out, so no complete key literal exists in source. */
const ANTHROPIC = `sk-ant-api03-${'A'.repeat(44)}`;

const flow = (node: Record<string, unknown>) => ({
  version: 1,
  name: 'saves something',
  nodes: [node],
  edges: [],
});

function errorsFor(node: Record<string, unknown>): string[] {
  const result = validateFlow(flow(node));
  return result.valid ? [] : result.errors.map((error) => `${error.path}: ${error.message}`);
}

describe('the write-file node', () => {
  it('accepts a path and content', () => {
    expect(
      errorsFor({ id: 'save', type: 'write-file', path: 'NOTES.md', content: '{{a.b}}' })
    ).toEqual([]);
  });

  it('accepts empty content, because an empty file is a real outcome', () => {
    expect(errorsFor({ id: 'save', type: 'write-file', path: 'NOTES.md', content: '' })).toEqual([]);
  });

  it('requires a path', () => {
    expect(errorsFor({ id: 'save', type: 'write-file', content: 'x' })).toContainEqual(
      expect.stringContaining('nodes[0].path')
    );
  });

  // Absent content would silently truncate a file to nothing, so it has to be
  // stated even when it is empty.
  it('requires content to be present, not merely non-empty', () => {
    expect(errorsFor({ id: 'save', type: 'write-file', path: 'NOTES.md' })).toContainEqual(
      expect.stringContaining('nodes[0].content')
    );
  });

  it('rejects content that is not a string', () => {
    expect(
      errorsFor({ id: 'save', type: 'write-file', path: 'NOTES.md', content: 42 })
    ).toContainEqual(expect.stringContaining('nodes[0].content'));
  });

  it('keeps both fields when it parses the node', () => {
    const result = validateFlow(
      flow({ id: 'save', type: 'write-file', path: 'NOTES.md', content: 'hello' })
    );

    expect(result.valid).toBe(true);
    expect(result.valid && result.flow.nodes[0]).toMatchObject({
      type: 'write-file',
      path: 'NOTES.md',
      content: 'hello',
    });
  });

  // The credential scanner walks every string field of every node; a new field
  // must not be a hole in it.
  it('still refuses a credential pasted into content', () => {
    expect(
      errorsFor({ id: 'save', type: 'write-file', path: 'NOTES.md', content: ANTHROPIC })
    ).not.toEqual([]);
  });
});
