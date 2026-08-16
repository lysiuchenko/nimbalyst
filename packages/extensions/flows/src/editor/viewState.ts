/**
 * Per-flow canvas view state: where the canvas is panned/zoomed and whether the
 * minimap is showing. Kept in host storage keyed by the flow's file path — it is
 * a view preference, not document content, so it never touches the `.flow.json`.
 */

export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FlowViewState {
  viewport?: FlowViewport;
  minimap?: boolean;
}

export const VIEW_STATE_PREFIX = 'flow-view:';

export function viewStateKey(filePath: string): string {
  return `${VIEW_STATE_PREFIX}${filePath}`;
}

/**
 * Read a stored blob back into a view state, discarding anything malformed so a
 * corrupt or partially-written entry can never throw or restore a broken
 * viewport (which would leave the canvas blank or at an absurd zoom). Each field
 * is validated on its own — a bad viewport does not cost you the minimap flag.
 */
export function parseViewState(raw: unknown): FlowViewState {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const state: FlowViewState = {};

  const vp = value.viewport;
  if (vp && typeof vp === 'object') {
    const { x, y, zoom } = vp as Record<string, unknown>;
    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof zoom === 'number' &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(zoom) &&
      zoom > 0
    ) {
      state.viewport = { x, y, zoom };
    }
  }

  if (typeof value.minimap === 'boolean') state.minimap = value.minimap;

  return state;
}
