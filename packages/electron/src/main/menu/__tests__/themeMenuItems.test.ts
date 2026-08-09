// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { BRAND_THEMES, buildBrandThemeMenuItems } from '../themeMenuItems';

describe('buildBrandThemeMenuItems', () => {
  it('offers every brand theme as a radio item', () => {
    const items = buildBrandThemeMenuItems('light', vi.fn());

    expect(items.map(item => item.label)).toEqual(BRAND_THEMES.map(theme => theme.label));
    expect(items.every(item => item.type === 'radio')).toBe(true);
  });

  it('checks the item matching the active theme', () => {
    const items = buildBrandThemeMenuItems('globallogic-dark', vi.fn());

    const checked = items.filter(item => item.checked).map(item => item.label);
    expect(checked).toEqual(['GlobalLogic Dark']);
  });

  it('applies the theme id and its darkness when clicked', () => {
    const apply = vi.fn();
    const items = buildBrandThemeMenuItems('light', apply);

    items[1]?.click?.(undefined as never, undefined as never, undefined as never);

    expect(apply).toHaveBeenCalledWith('globallogic-dark', true);
  });
});
