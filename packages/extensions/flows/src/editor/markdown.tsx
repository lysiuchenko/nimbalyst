import type { ReactNode } from 'react';

/**
 * Enough markdown for a gate to read agent output comfortably: headings,
 * paragraphs, lists, code fences. Parsed into blocks and rendered as React
 * elements — never injected as HTML, so untrusted model output stays text.
 */

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; items: string[] };

export function parseMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.split('\n');
  let paragraph: string[] = [];
  let code: string[] | null = null;
  let list: string[] | null = null;

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    if (list && list.length > 0) blocks.push({ kind: 'list', items: list });
    paragraph = [];
    list = null;
  };

  for (const line of lines) {
    if (code !== null) {
      if (line.trim().startsWith('```')) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (line.trim().startsWith('```')) {
      flush();
      code = [];
    } else if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
    } else if (item) {
      if (paragraph.length > 0) flush();
      (list ??= []).push(item[1]);
    } else if (line.trim() === '') {
      flush();
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  // An unclosed fence still renders as code, not as swallowed text.
  if (code !== null && code.length > 0) blocks.push({ kind: 'code', text: code.join('\n') });
  flush();
  return blocks;
}

export function Markdown({ text }: { text: string }): ReactNode {
  return (
    <div className="flow-markdown">
      {parseMarkdown(text).map((block, index) => {
        if (block.kind === 'heading') {
          const Tag = (`h${Math.min(block.level + 3, 6)}`) as 'h4';
          return <Tag key={index}>{block.text}</Tag>;
        }
        if (block.kind === 'code') return <pre key={index}>{block.text}</pre>;
        if (block.kind === 'list')
          return (
            <ul key={index}>
              {block.items.map((item, at) => (
                <li key={at}>{item}</li>
              ))}
            </ul>
          );
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}
