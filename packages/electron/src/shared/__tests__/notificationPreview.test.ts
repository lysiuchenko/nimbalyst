// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { notificationPreview } from '../notificationPreview';

describe('notificationPreview', () => {
  it('strips the markdown that reads as noise in a notification', () => {
    expect(
      notificationPreview('`src/auth.ts:13` — token = `sha256(userId:secret:now)` with **both** inputs')
    ).toBe('src/auth.ts:13 — token = sha256(userId:secret:now) with both inputs');
  });

  it('collapses newlines and heading markers into prose', () => {
    expect(notificationPreview('## Verdict\n\n- fix the login\n- add a test')).toBe(
      'Verdict fix the login add a test'
    );
  });

  it('cuts at a word boundary with an ellipsis, never mid-word', () => {
    const long = 'word '.repeat(60).trim();
    const preview = notificationPreview(long, 100);

    expect(preview.length).toBeLessThanOrEqual(101);
    expect(preview.endsWith('word…')).toBe(true);
  });

  it('keeps underscores — they are load-bearing in filenames', () => {
    expect(notificationPreview('wrote `PR_REVIEW.md` cleanly')).toBe('wrote PR_REVIEW.md cleanly');
  });

  it('leaves short clean text untouched', () => {
    expect(notificationPreview('Response complete')).toBe('Response complete');
  });

  it('has a fallback for empty input', () => {
    expect(notificationPreview('   ')).toBe('Response complete');
  });
});
