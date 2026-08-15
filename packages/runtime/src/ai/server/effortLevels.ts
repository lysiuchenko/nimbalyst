/**
 * Effort level constants for adaptive reasoning (Opus 4.6 and Sonnet 4.6).
 * Matches the Claude Code CLI's /model effort slider and CLAUDE_CODE_EFFORT_LEVEL env var.
 *
 * Levels: low, medium, high (default), xhigh, max
 */

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ThinkingMode = 'enabled' | 'disabled';

export const EFFORT_LEVELS: { key: EffortLevel; label: string }[] = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'xhigh', label: 'xHigh' },
  { key: 'max', label: 'Max' },
];

/**
 * Providers whose agents honor the effort slider. Claude Code and OpenAI Codex
 * both read a session's effort level at init; other providers ignore it, so a
 * picker should hide the control for them. Kept here, beside the levels, so the
 * "does this provider have effort" answer lives in one place.
 */
const EFFORT_SUPPORTING_PROVIDERS = new Set<string>(['claude-code', 'openai-codex']);

/** The effort choices for a provider, or `[]` when the provider ignores effort. */
export function effortLevelsForProvider(provider: string): { key: EffortLevel; label: string }[] {
  return EFFORT_SUPPORTING_PROVIDERS.has(provider) ? EFFORT_LEVELS : [];
}

export const DEFAULT_EFFORT_LEVEL: EffortLevel = 'high';
// Default to 'enabled' so the app omits the SDK thinking option and preserves
// the SDK's default adaptive thinking (Claude decides depth) on supported
// Opus/Sonnet models. Users can opt into 'disabled' (Extended: Off) per session.
export const DEFAULT_THINKING_MODE: ThinkingMode = 'enabled';

const VALID_EFFORT_LEVELS = new Set<string>(['low', 'medium', 'high', 'xhigh', 'max']);
const VALID_THINKING_MODES = new Set<string>(['enabled', 'disabled']);

/**
 * Validate and return a valid EffortLevel, or the default if invalid.
 */
export function parseEffortLevel(value: unknown): EffortLevel {
  if (typeof value === 'string' && VALID_EFFORT_LEVELS.has(value)) {
    return value as EffortLevel;
  }
  return DEFAULT_EFFORT_LEVEL;
}

/**
 * Resolve the effective effort level for a session.
 *
 * An explicit per-session value wins; otherwise we fall back to the app-wide
 * default that the UI effort selector displays. Without this fallback the
 * selector showed the app default (e.g. "Max") while the session silently ran
 * at the CLI's built-in "high", because the default was never written into
 * session metadata (GitHub #546).
 *
 * Returns undefined only when neither is set, so callers leave the CLI on its
 * own built-in default rather than forcing one.
 */
export function resolveEffortLevel(
  sessionEffortLevel: unknown,
  appDefaultEffortLevel: EffortLevel | undefined
): EffortLevel | undefined {
  if (sessionEffortLevel != null && sessionEffortLevel !== '') {
    return parseEffortLevel(sessionEffortLevel);
  }
  return appDefaultEffortLevel;
}

/**
 * Validate and return a valid ThinkingMode, or the default if invalid.
 */
export function parseThinkingMode(value: unknown): ThinkingMode {
  if (typeof value === 'string' && VALID_THINKING_MODES.has(value)) {
    return value as ThinkingMode;
  }
  return DEFAULT_THINKING_MODE;
}

/**
 * Resolve the effective thinking mode for a session.
 *
 * An explicit per-session value wins; otherwise we fall back to the app-wide
 * default the composer's Extended selector last wrote. Without this the toggle
 * reset to "Extended: On" at the start of every session because nothing
 * persisted the user's choice beyond the session row (GitHub #1034).
 *
 * Unlike effort level this always returns a mode, since 'enabled' is itself
 * the "leave the SDK on its adaptive default" value.
 */
export function resolveThinkingMode(
  sessionThinkingMode: unknown,
  appDefaultThinkingMode: ThinkingMode | undefined
): ThinkingMode {
  if (sessionThinkingMode != null && sessionThinkingMode !== '') {
    return parseThinkingMode(sessionThinkingMode);
  }
  return appDefaultThinkingMode ?? DEFAULT_THINKING_MODE;
}
