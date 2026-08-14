// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pickSessionForNode } from '../sessionMatch';

const sessions = [
  { id: 'old', title: 'Yesterday work', updatedAt: 1_000 },
  { id: 's1', title: 'Count the files in this repository, then report.', updatedAt: 9_000 },
  { id: 's2', title: 'Summarize the log below and keep it short.', updatedAt: 8_000 },
];

describe('pickSessionForNode', () => {
  it('matches the session whose title carries the prompt prefix', () => {
    expect(
      pickSessionForNode(sessions, { prompt: 'Summarize the log below and keep it short. {{log.log}}' }, 5_000)
    ).toBe('s2');
  });

  it('stops the prefix at the first reference — interpolation rewrites the rest', () => {
    expect(
      pickSessionForNode(sessions, { prompt: 'Count the files in this repository, then report. Extra: {{x.y}}' }, 5_000)
    ).toBe('s1');
  });

  it('falls back to the newest session updated since the run started', () => {
    expect(pickSessionForNode(sessions, { prompt: 'Completely different words' }, 5_000)).toBe('s1');
  });

  it('never reaches back before the run', () => {
    expect(pickSessionForNode([sessions[0]], { prompt: 'Anything' }, 5_000)).toBeUndefined();
  });

  it('a too-short static prefix is no evidence — fallback applies', () => {
    expect(pickSessionForNode(sessions, { prompt: '{{a.b}} then more' }, 5_000)).toBe('s1');
  });
});
