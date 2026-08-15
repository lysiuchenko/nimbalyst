// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { modelOptionsForProvider } from '../agentModels';

describe('modelOptionsForProvider', () => {
  it('offers the canonical claude-code variants for claude-code', () => {
    expect(modelOptionsForProvider('claude-code')).toEqual([
      { value: 'claude-code:opus', label: 'Opus' },
      { value: 'claude-code:sonnet', label: 'Sonnet' },
      { value: 'claude-code:haiku', label: 'Haiku' },
      { value: 'claude-code:fable', label: 'Fable' },
    ]);
  });

  it('treats an unset provider as claude-code (the node default)', () => {
    expect(modelOptionsForProvider(undefined)).toEqual(modelOptionsForProvider('claude-code'));
  });

  it('offers no models for providers that manage their own selection', () => {
    // Codex and Copilot CLI pick their own model; the picker leaves them on
    // "Host default" rather than offering identifiers the host would reject.
    expect(modelOptionsForProvider('openai-codex')).toEqual([]);
    expect(modelOptionsForProvider('copilot-cli')).toEqual([]);
  });

  it('every claude-code option is a well-formed claude-code:<variant> identifier', () => {
    // The runtime's resolveClaudeCodeModelVariant throws on anything that is
    // not a claude-code:* id, so a malformed value here would fail at run time.
    for (const option of modelOptionsForProvider('claude-code')) {
      expect(option.value).toMatch(/^claude-code:(opus|sonnet|haiku|fable)$/);
    }
  });
});
