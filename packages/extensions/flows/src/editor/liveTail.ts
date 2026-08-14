/**
 * The one line a running card shows about what its agent is doing right now.
 *
 * Walks the transcript tail backwards: a tool still running beats prose, and
 * the last spoken line beats silence. Clipped hard — this is a heartbeat, not
 * a transcript viewer.
 */
const MAX_LINE = 120;

export function tailLine(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      type?: string;
      text?: string;
      toolCall?: { toolName?: string; status?: string };
    };
    if (message?.type === 'tool_call' && message.toolCall?.status === 'running') {
      return `${message.toolCall.toolName ?? 'tool'}…`;
    }
    if (message?.type === 'assistant_message' && typeof message.text === 'string') {
      const lines = message.text.split('\n').map((line) => line.trim()).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last) continue;
      return last.length > MAX_LINE ? `${last.slice(0, MAX_LINE)}…` : last;
    }
  }
  return null;
}
