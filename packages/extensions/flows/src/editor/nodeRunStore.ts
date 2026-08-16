import type { ChildProgress, NodeExecution, NodeStatus } from '../runner/types';

export type NodeRunKind = 'status' | 'result' | 'children' | 'tail' | 'reliability';

export interface Reliability {
  ok: number;
  total: number;
}

export interface NodeRunStore {
  setStatuses(map: Record<string, NodeStatus>): void;
  setResults(map: Record<string, NodeExecution>): void;
  setChildren(map: Record<string, ChildProgress[]>): void;
  setTails(map: Record<string, string>): void;
  setReliability(map: Record<string, Reliability>): void;
  getStatus(id: string): NodeStatus | undefined;
  getResult(id: string): NodeExecution | undefined;
  getChildren(id: string): readonly ChildProgress[];
  getTail(id: string): string | undefined;
  getReliability(id: string): Reliability | undefined;
  subscribe(kind: NodeRunKind, id: string, listener: () => void): () => void;
}

const EMPTY_CHILDREN: readonly ChildProgress[] = Object.freeze([]);

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

function objectEq<T extends object>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return shallowEqual(a as Record<string, unknown>, b as Record<string, unknown>);
}

function childrenEq(a: ChildProgress[] | undefined, b: ChildProgress[] | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!objectEq(a[i], b[i])) return false;
  }
  return true;
}

interface Slice<T> {
  values: Map<string, T>;
  listeners: Map<string, Set<() => void>>;
  eq: (a: T | undefined, b: T | undefined) => boolean;
}

function createSlice<T>(eq: (a: T | undefined, b: T | undefined) => boolean): Slice<T> {
  return { values: new Map(), listeners: new Map(), eq };
}

function setSlice<T>(slice: Slice<T>, map: Record<string, T>): void {
  const ids = new Set<string>([...slice.values.keys(), ...Object.keys(map)]);
  for (const id of ids) {
    const next = map[id]; // undefined when the id has dropped out of the map
    const prev = slice.values.get(id);
    if (slice.eq(prev, next)) continue; // equal: keep the old reference, no notify
    if (next === undefined) slice.values.delete(id);
    else slice.values.set(id, next);
    const listeners = slice.listeners.get(id);
    if (listeners) for (const listener of listeners) listener();
  }
}

function subscribeSlice<T>(slice: Slice<T>, id: string, listener: () => void): () => void {
  let set = slice.listeners.get(id);
  if (!set) {
    set = new Set();
    slice.listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) slice.listeners.delete(id);
  };
}

export function createNodeRunStore(): NodeRunStore {
  const status = createSlice<NodeStatus>((a, b) => Object.is(a, b));
  const tail = createSlice<string>((a, b) => Object.is(a, b));
  const result = createSlice<NodeExecution>((a, b) => objectEq(a, b));
  const children = createSlice<ChildProgress[]>((a, b) => childrenEq(a, b));
  const reliability = createSlice<Reliability>((a, b) => objectEq(a, b));

  const sliceFor = (kind: NodeRunKind): Slice<unknown> => {
    switch (kind) {
      case 'status':
        return status as Slice<unknown>;
      case 'tail':
        return tail as Slice<unknown>;
      case 'result':
        return result as Slice<unknown>;
      case 'children':
        return children as Slice<unknown>;
      case 'reliability':
        return reliability as Slice<unknown>;
    }
  };

  return {
    setStatuses: (map) => setSlice(status, map),
    setResults: (map) => setSlice(result, map),
    setChildren: (map) => setSlice(children, map),
    setTails: (map) => setSlice(tail, map),
    setReliability: (map) => setSlice(reliability, map),
    getStatus: (id) => status.values.get(id),
    getResult: (id) => result.values.get(id),
    getChildren: (id) => children.values.get(id) ?? EMPTY_CHILDREN,
    getTail: (id) => tail.values.get(id),
    getReliability: (id) => reliability.values.get(id),
    subscribe: (kind, id, listener) => subscribeSlice(sliceFor(kind), id, listener),
  };
}
