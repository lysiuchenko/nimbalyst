// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseViewState, viewStateKey } from '../viewState';

describe('viewStateKey', () => {
  it('namespaces per flow file', () => {
    expect(viewStateKey('/w/a.flow.json')).toBe('flow-view:/w/a.flow.json');
    expect(viewStateKey('/w/b.flow.json')).not.toBe(viewStateKey('/w/a.flow.json'));
  });
});

describe('parseViewState', () => {
  it('reads a well-formed blob', () => {
    expect(parseViewState({ viewport: { x: 12, y: -4, zoom: 1.5 }, minimap: false })).toEqual({
      viewport: { x: 12, y: -4, zoom: 1.5 },
      minimap: false,
    });
  });

  it('is empty for a missing or non-object blob', () => {
    expect(parseViewState(undefined)).toEqual({});
    expect(parseViewState(null)).toEqual({});
    expect(parseViewState('nope')).toEqual({});
  });

  it('drops a viewport with a non-finite or non-positive-zoom value', () => {
    expect(parseViewState({ viewport: { x: NaN, y: 0, zoom: 1 } })).toEqual({});
    expect(parseViewState({ viewport: { x: 0, y: 0, zoom: 0 } })).toEqual({});
    expect(parseViewState({ viewport: { x: 0, y: 0, zoom: '2' } })).toEqual({});
  });

  it('keeps the minimap flag independent of a bad viewport', () => {
    expect(parseViewState({ viewport: { x: 0 }, minimap: true })).toEqual({ minimap: true });
  });

  it('ignores a non-boolean minimap', () => {
    expect(parseViewState({ minimap: 'yes' })).toEqual({});
  });
});
