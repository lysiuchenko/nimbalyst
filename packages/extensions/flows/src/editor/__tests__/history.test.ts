// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHistory } from '../history';

describe('createHistory', () => {
  it('has nothing to undo until something is recorded', () => {
    const history = createHistory<string>();

    expect(history.canUndo()).toBe(false);
    expect(history.undo('current')).toBeUndefined();
  });

  it('undoes to the previously recorded state', () => {
    const history = createHistory<string>();
    history.record('a');

    expect(history.undo('b')).toBe('a');
  });

  it('walks back through several steps', () => {
    const history = createHistory<string>();
    history.record('a');
    history.record('b');

    expect(history.undo('c')).toBe('b');
    expect(history.undo('b')).toBe('a');
    expect(history.canUndo()).toBe(false);
  });

  it('redoes what was just undone', () => {
    const history = createHistory<string>();
    history.record('a');

    expect(history.undo('b')).toBe('a');
    expect(history.redo('a')).toBe('b');
  });

  it('drops the redo trail once a new edit is recorded', () => {
    const history = createHistory<string>();
    history.record('a');
    history.undo('b');
    history.record('c');

    expect(history.canRedo()).toBe(false);
  });

  it('ignores a record that does not change anything, so undo is never a no-op', () => {
    const history = createHistory<string>();
    history.record('a');
    history.record('a');

    expect(history.undo('a')).toBe('a');
    expect(history.canUndo()).toBe(false);
  });

  it('forgets the oldest states rather than growing without bound', () => {
    const history = createHistory<string>(3);
    ['a', 'b', 'c', 'd', 'e'].forEach((state) => history.record(state));

    let steps = 0;
    let current = 'f';
    while (history.canUndo()) {
      current = history.undo(current)!;
      steps++;
    }

    expect(steps).toBe(3);
    expect(current).toBe('c');
  });

  it('reports what is available so the UI can disable its buttons', () => {
    const history = createHistory<string>();

    expect([history.canUndo(), history.canRedo()]).toEqual([false, false]);
    history.record('a');
    expect([history.canUndo(), history.canRedo()]).toEqual([true, false]);
    history.undo('b');
    expect([history.canUndo(), history.canRedo()]).toEqual([false, true]);
  });

  it('starts clean again when the document is reloaded', () => {
    const history = createHistory<string>();
    history.record('a');
    history.reset();

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
