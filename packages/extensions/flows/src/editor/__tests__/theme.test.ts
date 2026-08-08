// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FLOW_THEMES, nextTheme, readTheme, THEME_STORAGE_KEY } from '../theme';

function storage(initial?: string) {
  const store = new Map<string, unknown>();
  if (initial !== undefined) store.set(THEME_STORAGE_KEY, initial);
  return {
    get: <T,>(key: string) => store.get(key) as T | undefined,
    set: (key: string, value: unknown) => {
      store.set(key, value);
    },
    calls: store,
  };
}

describe('FLOW_THEMES', () => {
  it('offers the host theme and the GlobalLogic one', () => {
    expect(FLOW_THEMES.map((theme) => theme.id)).toEqual(['host', 'globallogic']);
  });

  it('describes each theme so the toggle can label itself', () => {
    expect(FLOW_THEMES.every((theme) => theme.label.length > 0)).toBe(true);
  });
});

describe('readTheme', () => {
  it('follows the host theme until the user picks otherwise', () => {
    expect(readTheme(storage())).toBe('host');
  });

  it('remembers a stored choice', () => {
    expect(readTheme(storage('globallogic'))).toBe('globallogic');
  });

  it('falls back to the host theme when the stored value is not one we know', () => {
    expect(readTheme(storage('neon-hotdog'))).toBe('host');
  });
});

describe('nextTheme', () => {
  it('cycles through the themes', () => {
    expect(nextTheme('host')).toBe('globallogic');
    expect(nextTheme('globallogic')).toBe('host');
  });
});
