// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown';

describe('parseMarkdown', () => {
  it('splits headings, paragraphs and code fences', () => {
    const blocks = parseMarkdown('# Verdict\n\nApprove with one minor.\n\n```ts\nconst x = 1;\n```');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Verdict' },
      { kind: 'paragraph', text: 'Approve with one minor.' },
      { kind: 'code', text: 'const x = 1;' },
    ]);
  });

  it('groups list items into one list block', () => {
    expect(parseMarkdown('- first\n- second\n* third')).toEqual([
      { kind: 'list', items: ['first', 'second', 'third'] },
    ]);
  });

  it('joins consecutive prose lines into one paragraph', () => {
    expect(parseMarkdown('one line\nand its continuation')).toEqual([
      { kind: 'paragraph', text: 'one line and its continuation' },
    ]);
  });

  it('an unclosed fence still renders as code, not as swallowed text', () => {
    expect(parseMarkdown('```\nleft open')).toEqual([{ kind: 'code', text: 'left open' }]);
  });

  it('plain text stays one honest paragraph', () => {
    expect(parseMarkdown('no markdown here')).toEqual([
      { kind: 'paragraph', text: 'no markdown here' },
    ]);
  });
});
