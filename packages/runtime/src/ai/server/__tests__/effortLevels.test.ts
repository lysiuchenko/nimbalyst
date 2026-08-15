import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EFFORT_LEVEL,
  DEFAULT_THINKING_MODE,
  EFFORT_LEVELS,
  effortLevelsForProvider,
  parseThinkingMode,
  resolveEffortLevel,
  resolveThinkingMode,
} from '../effortLevels';

describe('effortLevelsForProvider', () => {
  it('offers the full effort scale to claude-code', () => {
    expect(effortLevelsForProvider('claude-code')).toEqual(EFFORT_LEVELS);
  });

  it('drops max for openai-codex, whose transport aliases max to xhigh', () => {
    // Codex has no distinct 'max' (the protocol maps max -> xhigh), so offering
    // both would be two picker entries that do the same thing.
    expect(effortLevelsForProvider('openai-codex').map((e) => e.key)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('offers no effort for providers that ignore it', () => {
    // Copilot CLI has no effort slider; the picker should hide the control.
    expect(effortLevelsForProvider('copilot-cli')).toEqual([]);
    expect(effortLevelsForProvider('claude')).toEqual([]);
  });
});

describe('resolveEffortLevel', () => {
  it('uses the explicit per-session effort when set', () => {
    expect(resolveEffortLevel('low', 'max')).toBe('low');
    expect(resolveEffortLevel('high', 'max')).toBe('high');
  });

  it('falls back to the app default when the session has no effort', () => {
    // The selector displays the app default but never writes it to session
    // metadata; the effective effort must follow that default (GitHub #546).
    expect(resolveEffortLevel(undefined, 'max')).toBe('max');
    expect(resolveEffortLevel(null, 'xhigh')).toBe('xhigh');
    expect(resolveEffortLevel('', 'max')).toBe('max');
  });

  it('returns undefined when neither session nor app default is set', () => {
    expect(resolveEffortLevel(undefined, undefined)).toBeUndefined();
    expect(resolveEffortLevel(null, undefined)).toBeUndefined();
  });

  it('coerces an invalid stored session value to the default level', () => {
    expect(resolveEffortLevel('bogus', 'max')).toBe(DEFAULT_EFFORT_LEVEL);
  });
});

describe('thinking mode parsing', () => {
  it('defaults to enabled (preserving the SDK adaptive-thinking default)', () => {
    expect(DEFAULT_THINKING_MODE).toBe('enabled');
    expect(parseThinkingMode(undefined)).toBe('enabled');
    expect(parseThinkingMode(null)).toBe('enabled');
  });

  it('accepts enabled and disabled modes', () => {
    expect(parseThinkingMode('enabled')).toBe('enabled');
    expect(parseThinkingMode('disabled')).toBe('disabled');
  });

  it('falls back to the default for unknown values', () => {
    expect(parseThinkingMode('on')).toBe('enabled');
    expect(parseThinkingMode('off')).toBe('enabled');
    expect(parseThinkingMode('')).toBe('enabled');
  });
});

describe('resolveThinkingMode', () => {
  it('uses the explicit per-session mode when set', () => {
    expect(resolveThinkingMode('disabled', 'enabled')).toBe('disabled');
    expect(resolveThinkingMode('enabled', 'disabled')).toBe('enabled');
  });

  it('falls back to the app default when the session has no mode', () => {
    expect(resolveThinkingMode(undefined, 'disabled')).toBe('disabled');
    expect(resolveThinkingMode(null, 'disabled')).toBe('disabled');
    expect(resolveThinkingMode('', 'disabled')).toBe('disabled');
  });

  it('falls back to enabled when neither is set', () => {
    expect(resolveThinkingMode(undefined, undefined)).toBe('enabled');
    expect(resolveThinkingMode(null, undefined)).toBe('enabled');
  });

  it('sanitizes an invalid session value instead of trusting it', () => {
    expect(resolveThinkingMode('off', 'disabled')).toBe(DEFAULT_THINKING_MODE);
  });
});
