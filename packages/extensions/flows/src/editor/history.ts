/**
 * Undo/redo for the canvas.
 *
 * The host's document history covers what was *saved*; this covers what is on
 * the canvas right now, which is where a mis-drag or an accidental delete
 * actually hurts. States are compared before recording so an undo is never a
 * no-op the user has to press twice.
 */
export interface History<T> {
  record(state: T): void;
  undo(current: T): T | undefined;
  redo(current: T): T | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  reset(): void;
}

const DEFAULT_LIMIT = 50;

export function createHistory<T>(limit: number = DEFAULT_LIMIT): History<T> {
  let past: T[] = [];
  let future: T[] = [];

  const same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

  return {
    record(state) {
      if (past.length > 0 && same(past[past.length - 1], state)) return;
      past.push(state);
      if (past.length > limit) past = past.slice(past.length - limit);
      // A new edit invalidates anything that was undone — the timeline forked.
      future = [];
    },

    undo(current) {
      const previous = past.pop();
      if (previous === undefined) return undefined;
      future.push(current);
      return previous;
    },

    redo(current) {
      const next = future.pop();
      if (next === undefined) return undefined;
      past.push(current);
      return next;
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    reset() {
      past = [];
      future = [];
    },
  };
}
