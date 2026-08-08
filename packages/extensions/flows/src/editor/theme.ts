import type { EditorHost } from '@nimbalyst/extension-sdk';

export type FlowThemeId = 'host' | 'globallogic';

export interface FlowTheme {
  id: FlowThemeId;
  label: string;
  description: string;
}

/**
 * Canvas themes.
 *
 * `host` is the default and inherits every `--nim-*` token, so the canvas keeps
 * following the app's light/dark/Crystal themes. A brand theme overrides only
 * the `--flow-*` layer, which is why switching is reversible and never leaks
 * into the rest of the app.
 */
export const FLOW_THEMES: FlowTheme[] = [
  {
    id: 'host',
    label: 'App theme',
    description: 'Follow Nimbalyst’s own colours.',
  },
  {
    id: 'globallogic',
    label: 'GlobalLogic',
    description: 'GlobalLogic brand palette.',
  },
];

export const THEME_STORAGE_KEY = 'canvas-theme';

export function readTheme(storage: Pick<EditorHost['storage'], 'get'>): FlowThemeId {
  const stored = storage.get<string>(THEME_STORAGE_KEY);
  return FLOW_THEMES.some((theme) => theme.id === stored) ? (stored as FlowThemeId) : 'host';
}

export function nextTheme(current: FlowThemeId): FlowThemeId {
  const index = FLOW_THEMES.findIndex((theme) => theme.id === current);
  return FLOW_THEMES[(index + 1) % FLOW_THEMES.length].id;
}
