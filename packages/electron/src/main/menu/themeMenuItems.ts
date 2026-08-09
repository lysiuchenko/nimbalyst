import type { MenuItemConstructorOptions } from 'electron';

/**
 * Fork-owned brand themes shipped as files under
 * `packages/runtime/src/themes/builtin/<id>/theme.json`.
 *
 * The Theme submenu hardcodes one block per built-in theme, so file-based
 * themes are discoverable (`theme:list`) but not selectable anywhere in the
 * UI. These entries give the brand themes a home without touching the
 * existing built-in blocks.
 */
export const BRAND_THEMES = [
  { id: 'globallogic', label: 'GlobalLogic', isDark: false },
  { id: 'globallogic-dark', label: 'GlobalLogic Dark', isDark: true },
] as const;

/** Applies a brand theme: persist it, then broadcast and restyle the chrome. */
export type ApplyBrandTheme = (themeId: string, isDark: boolean) => void;

export function buildBrandThemeMenuItems(
  currentTheme: string,
  apply: ApplyBrandTheme
): MenuItemConstructorOptions[] {
  return BRAND_THEMES.map(theme => ({
    label: theme.label,
    type: 'radio' as const,
    checked: currentTheme === theme.id,
    click: () => apply(theme.id, theme.isDark),
  }));
}
