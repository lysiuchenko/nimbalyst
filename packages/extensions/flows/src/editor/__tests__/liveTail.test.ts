// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tailLine } from '../liveTail';

describe('tailLine', () => {
  it('reports the tool the agent is using right now', () => {
    expect(
      tailLine([
        { type: 'assistant_message', text: 'Let me check.' },
        { type: 'tool_call', toolCall: { toolName: 'Bash', status: 'running' } },
      ])
    ).toBe('Bash…');
  });

  it('falls back to the last line the agent said', () => {
    expect(
      tailLine([
        { type: 'tool_call', toolCall: { toolName: 'Read', status: 'completed' } },
        { type: 'assistant_message', text: 'Found it.\nThe expiry check uses <= instead of <.' },
      ])
    ).toBe('The expiry check uses <= instead of <.');
  });

  it('clips a rambling line so the card stays a card', () => {
    const line = tailLine([{ type: 'assistant_message', text: 'x'.repeat(300) }]);
    expect(line).toHaveLength(121);
    expect(line?.endsWith('…')).toBe(true);
  });

  it('says nothing when the transcript has nothing to show', () => {
    expect(tailLine([])).toBeNull();
    expect(tailLine([{ type: 'user_message', text: 'prompt' }])).toBeNull();
  });
});
