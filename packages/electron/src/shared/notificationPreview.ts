/**
 * The body of an OS notification, made readable.
 *
 * Agent responses are markdown: backticks, headings, list markers, links. A
 * notification renders none of that — it showed up verbatim, hard-cut
 * mid-word at 100 characters ("lets an a..."). Strip the syntax, collapse the
 * whitespace, cut at a word boundary.
 */
export function notificationPreview(text: string, limit = 140): string {
  const plain = text
    // Backticks, asterisks and strikethrough only: underscores are
    // load-bearing in filenames like PR_REVIEW.md.
    .replace(/[`*~]/g, '')
    // Headings and list markers at line starts.
    .replace(/^[#>\-+]+\s*/gm, '')
    // Links keep their label.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length === 0) return 'Response complete';
  if (plain.length <= limit) return plain;

  const cut = plain.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
