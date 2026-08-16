# Eliminate the flows canvas re-render storm during runs

**Date:** 2026-08-16
**Status:** design
**Scope:** `packages/extensions/flows` only. `useFlowRun` untouched.

## Problem

`src/editor/runContext.ts` exposes five whole-map React contexts —
`RunStatusContext`, `NodeChildrenContext`, `NodeResultsContext`,
`LiveTailContext`, `NodeReliabilityContext` — each a `Record<string, …>`.
Every card reads its own slice through a hook that indexes the whole map
(`useContext(LiveTailContext)[nodeId]`). During a run, one node's update
rebuilds the whole map into a new object identity, so the context value
changes and **every** `FlowNodeCard` re-renders. `React.memo` cannot help:
a context value change bypasses memo. With N nodes, one slice change costs
N card renders. Goal: a card re-renders only when its own slice changes.

Confirmed readers of the five per-node hooks: only `FlowNodeCard`
(`src/editor/nodes/nodeTypes.tsx`). The whole-map values are also read by
non-card consumers in `FlowEditor.tsx` — `progress` (aggregate over
`run.statuses`), the `canvasStatuses` replay override, `gateContext(…,
run.liveNodes)`, `SubAgentLayer subAgents={run.children}`, and `reliability`
derived from `pastRuns`. Each has exactly one consumer in the god-component;
they legitimately need whole maps and are not the storm.

## Approach: a diffing per-id broadcast bus (`NodeRunStore`)

A new pure module `src/editor/nodeRunStore.ts` sits between the derived
maps and the cards. `FlowEditor` **feeds** it the maps it already derives
(via effects); each card **subscribes per-id** through
`useSyncExternalStore`. The store's only job is to turn a whole-map identity
change into notifications for **just the ids whose slice actually changed**.

Chosen over "`useFlowRun` writes slices directly" because it is the minimal,
contained diff:

- `useFlowRun` stays untouched — the replay override, reliability-from-
  `pastRuns`, and every non-card reader keep reading whole maps unchanged.
- The change is: delete the five map contexts, add one store context, feed
  the store from five effects, rewrite the five card hooks.

Cost: one extra render tick (FlowEditor renders new map → effect → store
notifies → the one affected card renders). Imperceptible for a status dot,
and the card render is now O(1), not O(N). FlowEditor re-rendering does not
re-render cards — xyflow is uncontrolled and renders nodes from its own
store; today's storm is purely the five contexts.

## `NodeRunStore` interface

```ts
type Kind = 'status' | 'result' | 'children' | 'tail' | 'reliability';

interface NodeRunStore {
  // writes — called from FlowEditor effects; each diffs newMap vs cached
  // by per-id reference and notifies only the ids whose value changed.
  setStatuses(map: Record<string, NodeStatus>): void;
  setResults(map: Record<string, NodeExecution>): void;
  setChildren(map: Record<string, ChildProgress[]>): void;
  setTails(map: Record<string, string>): void;
  setReliability(map: Record<string, { ok: number; total: number }>): void;

  // per-id reads — return the last ACCEPTED value for that id (see the
  // equality contract). A card's getSnapshot is therefore referentially
  // stable across ticks that did not change its slice, so it never wakes.
  getStatus(id: string): NodeStatus | undefined;
  getResult(id: string): NodeExecution | undefined;
  getChildren(id: string): ChildProgress[];
  getTail(id: string): string | undefined;
  getReliability(id: string): { ok: number; total: number } | undefined;

  // per-id subscribe for useSyncExternalStore
  subscribe(kind: Kind, id: string, listener: () => void): () => void;
}

function createNodeRunStore(): NodeRunStore;
```

**Equality contract (the core correctness point).** `useFlowRun` rebuilds
these maps every run tick — `run.liveNodes[id]` is a fresh `{ ...node }`
spread *every* tick even when unchanged, and `run.children[id]` is an array
the runner mutates in place. A reference diff would therefore either wake
every card every tick (storm returns) or miss an in-place mutation (stale
card). So the store diffs by a **per-kind equality function**, not by
reference:

| kind | slice type | equality |
| --- | --- | --- |
| `status` | `NodeStatus` (string) | `Object.is` |
| `tail` | `string` | `Object.is` |
| `result` | `NodeExecution` | shallow-equal over own keys |
| `children` | `ChildProgress[]` | equal length + per-element shallow-equal |
| `reliability` | `{ ok, total }` | shallow-equal |

On each `setX(newMap)`, for every id in either the incoming map or the
cache, compare `newMap[id]` to the last accepted value with that kind's
equality function. If unequal, store `newMap[id]` as the new accepted value
and notify that id's listeners; if equal, keep the old reference (do **not**
adopt the new one) so `getX(id)` stays referentially stable. Ids that drop
out go to `undefined` and notify. This is strictly no worse than today
(which re-rendered every card every tick) and never yields a false
"unchanged": the card renders only top-level primitive fields
(`status`, `output`), which the shallow spread copies by value, so a real
change always differs under shallow-equal. `getChildren` returns a shared
frozen empty-array constant when absent (never a fresh `[]`), matching
today's `useNodeChildren` default.

## `runContext.ts` rewrite

Delete the five map contexts and their hooks. Add one context holding the
store instance; `useRunFrom` (a callback, never a map) is unchanged.

```ts
const NodeRunStoreContext = createContext<NodeRunStore | null>(null);

function useNodeRunStore(): NodeRunStore {
  const store = useContext(NodeRunStoreContext);
  if (!store) throw new Error('NodeRunStoreContext missing');
  return store;
}

export function useNodeStatus(id: string) {
  const s = useNodeRunStore();
  return useSyncExternalStore(
    (cb) => s.subscribe('status', id, cb),
    () => s.getStatus(id),
  );
}
// useNodeResult / useNodeChildren / useNodeReliability / useLiveTail: same shape.
```

## FlowEditor wiring

- Build the store once: `const runStore = useMemo(createNodeRunStore, [])`.
- Replace the five `Context.Provider`s (lines ~1836–1841 / closers ~1947–
  1952) with a single `<NodeRunStoreContext.Provider value={runStore}>`.
- Feed it from five effects, each keyed on the same derived value the old
  provider passed:
  ```ts
  useEffect(() => runStore.setStatuses(canvasStatuses), [canvasStatuses]);
  useEffect(() => runStore.setResults(run.liveNodes), [run.liveNodes]);
  useEffect(() => runStore.setChildren(run.children), [run.children]);
  useEffect(() => runStore.setTails(run.liveTails), [run.liveTails]);
  useEffect(() => runStore.setReliability(reliability), [reliability]);
  ```
- Non-card readers (`progress`, `canvasStatuses`, `gateContext`,
  `SubAgentLayer`, `reliability`) — no change.

## Verification

1. **Store-level render-budget unit test** (`nodeRunStore.test.ts`, no React,
   `// @vitest-environment node`). Seed 50 ids. `setStatuses` changing one
   id → assert exactly one subscribed listener fired, that id's `getStatus`
   returns the new value, and every other id's `getStatus` returns the
   identical reference it returned before (the no-wake proof). Repeat for
   results / children / tails / reliability. **The trap test:** call
   `setResults` twice with maps that are deep-equal but built from fresh
   `{ ...node }` spreads (the real `useFlowRun` shape) → assert *no* listener
   fired and `getResult(id)` returned the *same reference* both times. Do the
   equivalent for `setChildren` with a mutated-in-place array whose contents
   are unchanged. Also: an id dropping out notifies and reads `undefined`;
   `getChildren` absent returns the shared frozen empty-array constant.
2. **React mount render-budget test** (project pattern: `act` from `react`
   + `createRoot` from `react-dom/client`, jsdom). Mount N tiny consumers,
   each `useSyncExternalStore`-wired to one id via the real hooks, each
   incrementing a render counter. Push one slice through the store; assert
   only that id's counter incremented. This is the literal "card re-renders
   only on its own slice" proof at the React boundary.
3. **Live CDP spot-check** during a real run of a demo flow: instrument card
   render counts, confirm per-node updates do not fan out. Guarded per the
   `flows-cdp-verify-hazards` memo — no destructive keys, filter DOM by
   `getBoundingClientRect().width > 0`.

## Out of scope

Decomposing `FlowEditor` (separate improvement B), accessibility passes
(C), Goal 4/5 gap survey (D). `useFlowRun`'s internal state shape. The
`RunFromContext` callback. Any core (non-extension) file.
