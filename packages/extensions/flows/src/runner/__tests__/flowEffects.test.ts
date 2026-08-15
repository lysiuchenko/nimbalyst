// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { resolveTemplate } from '../flowEffects';

describe('resolveTemplate', () => {
  test('a literal resolves concrete', () => {
    expect(resolveTemplate('out/report.md', {})).toEqual({ text: 'out/report.md', resolved: true });
  });
  test('a variable resolves concrete', () => {
    expect(resolveTemplate('{{dir}}/report.md', { dir: 'out' })).toEqual({ text: 'out/report.md', resolved: true });
  });
  test('a node.port reference stays symbolic — raw template, resolved false', () => {
    expect(resolveTemplate('{{plan.outfile}}', {})).toEqual({ text: '{{plan.outfile}}', resolved: false });
  });
});
