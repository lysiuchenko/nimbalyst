/**
 * The one-slot bridge between the Flows home and the editor.
 *
 * The panel launches a run; the editor owns it — gates, statuses, sub-agent
 * cards and cancel all live there, and a second run surface in the panel would
 * be a second thing to keep honest. So the panel records an intent, opens the
 * flow, and the editor consumes the intent when the flow finishes loading.
 *
 * Both surfaces are the same extension bundle in the same renderer, so a
 * module variable is the whole transport. For an editor that is *already*
 * mounted (openFile only focuses its tab), the panel also fires
 * `RUN_INTENT_EVENT` on `window`, which that editor listens for.
 */

export const RUN_INTENT_EVENT = 'flows:run-intent';

/**
 * An intent that never found its editor must not start a run the next time the
 * flow happens to be opened. A minute is far beyond any tab-open latency.
 */
export const RUN_INTENT_MAX_AGE_MS = 60_000;

let pending: { flowPath: string; at: number } | null = null;

export function requestRun(flowPath: string): void {
  pending = { flowPath, at: Date.now() };
}

/** True at most once, and only for the path the intent was recorded for. */
export function consumeRun(flowPath: string): boolean {
  if (!pending) return false;
  if (Date.now() - pending.at > RUN_INTENT_MAX_AGE_MS) {
    pending = null;
    return false;
  }
  if (pending.flowPath !== flowPath) return false;
  pending = null;
  return true;
}
