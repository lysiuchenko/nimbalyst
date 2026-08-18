import { useEditorLifecycle, type EditorHost, type EditorHostProps } from '@nimbalyst/extension-sdk';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NODE_TYPES, type Flow, type NodeType } from '../schema/types';
import {
  edgeVisual,
  flowToGraph,
  graphToFlow,
  hasDownstreamDependents,
  isValidFlowConnection,
  placeNewNode,
  type FlowCanvasEdge,
  type FlowCanvasNode,
  type FlowGraph,
} from './flowGraph';
import { DisclosureContext, nextDisclosure, type Disclosure } from './disclosure';
import { parseViewState, viewStateKey, type FlowViewState } from './viewState';
import { EdgeConditionEditor } from './EdgeConditionEditor';
import { createNode, createNodeTypes, NODE_TYPE_ICONS, NODE_TYPE_LABELS } from './nodes/nodeTypes';
import { formatDuration, previewOf } from './nodes/entryFilter';
import { applyTemplate, FLOW_TEMPLATES, type FlowTemplate } from './templates';
import { FLOW_THEMES, nextTheme, readTheme, THEME_STORAGE_KEY, type FlowThemeId } from './theme';
import { duplicateNode, renameVariable, uniqueNodeId, validVariableName } from './canvasActions';
import { createHistory } from './history';
import { loadRunHistory, loadRunTimeline } from './runHistory';
import { deleteRunRecord } from './deleteRunRecord';
import { openSession } from './openSession';
import type { HostIpc } from '../host/nimbalystSessionHost';
import { WEEKDAYS, type FlowSchedule } from '../schedule/types';
import type { FlowTrigger } from '../trigger/types';
import { scheduleLabel } from '../schedule/label';
import { displayStatus, historySummary, relativeWhen, runOutcome, tokensLabel } from './runSummary';
import type { RunRecord } from '../runner/runStore';
import type { RunTimeline } from '../runner/runTimeline';
import { CatalogContext, EMPTY_CATALOG, NodeIssuesContext, ReferencesContext } from './catalogContext';
import { SubAgentLayer } from './SubAgentLayer';
import { WorktreeDiffPanel } from './WorktreeDiffPanel';
import type { ChildProgress } from '../runner/types';
import { issuesByNode, referencesByNode } from './references';
import { loadCatalog, type Catalog } from '../host/catalog';
import { scanWorkspaceCatalog } from '../host/workspaceScan';
import { getHostServices } from '../host/hostServices';
import { NodeRunStoreContext, RunFromContext } from './runContext';
import { createNodeRunStore } from './nodeRunStore';
import { prepareSave } from './saveFlow';
import { useFlowRun, SHELL_ALLOWLIST } from './useFlowRun';
import { flowEffects } from '../runner/flowEffects';
import { FlowRunGate } from './FlowRunGate';
import { EMPTY_FLOW, flowErrorsOf, parseFlowOrThrow } from './flowParseError';
import { consumeRun, RUN_INTENT_EVENT } from './runIntent';
import { resumeOffer } from './resumeOffer';
import { edgePayload, nodeReliability } from './observability';
import { Markdown } from './markdown';
import { advanceReplay, REPLAY_SPEED, replayDuration, replaySlicesFor, replayStatuses, replayTimelineDuration } from './replay';
import { runProgress } from './runProgress';
import { stepEtas } from './stepEta';
import { WorktreeChip } from './WorktreeChip';
import { gateContext } from './gateContext';
import { draftFlow, editFlow } from './aiDraft';


/** Changes that mean the user edited the document, as opposed to the canvas measuring itself. */
function isUserChange(change: NodeChange | EdgeChange): boolean {
  return change.type === 'position'
    ? change.dragging === false
    : change.type === 'remove' || change.type === 'add' || change.type === 'replace';
}

export function FlowEditor({ host }: EditorHostProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvas host={host} />
    </ReactFlowProvider>
  );
}

function FlowCanvas({ host }: { host: EditorHost }) {
  const { getNodes, getEdges, addNodes, addEdges, setNodes, setEdges, fitView, setCenter, screenToFlowPosition } = useReactFlow<
    FlowCanvasNode,
    FlowCanvasEdge
  >();
  // True once xyflow has measured the custom nodes' real dimensions. Used to
  // refit only after measurement, since fitting against unmeasured (zero-size)
  // nodes under-frames the graph.
  const nodesInitialized = useNodesInitialized();

  // Document-level fields the canvas does not own (name, variables) plus the
  // ports of edges already on disk. Held in a ref so editing never re-renders
  // the canvas from outside — the xyflow store is the single source of truth
  // for node and edge state.
  const baseRef = useRef<Flow>(EMPTY_FLOW);
  const [saveErrors, setSaveErrors] = useState<string | null>(null);
  // The graph as last read from disk. It seeds the canvas at mount and is
  // replaced only when the file changes underneath us; every edit in between
  // lives in the xyflow store, not here.
  const [loaded, setLoaded] = useState<{ graph: FlowGraph; revision: number } | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  // Recomputed when the canvas changes so a node shows its own problems and its
  // available inputs while it is being edited, not only at save time.
  const [analysis, setAnalysis] = useState<{
    references: Record<string, string[]>;
    issues: Record<string, string[]>;
  }>({ references: {}, issues: {} });
  // Drives the starter gallery. Tracked in state rather than read from the
  // xyflow store so it updates the moment a template or node is added.
  const [isEmpty, setIsEmpty] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [theme, setTheme] = useState<FlowThemeId>(() => readTheme(host.storage));
  // Mirrors baseRef.current.variables for rendering; the ref stays the source
  // of truth so editing a variable never re-renders the canvas.
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [pastRuns, setPastRuns] = useState<RunRecord[]>([]);
  const [showRuns, setShowRuns] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  // Mirrors baseRef.current.schedule for rendering; the ref stays the source of
  // truth so editing a schedule never re-renders the canvas.
  const [schedule, setScheduleState] = useState<FlowSchedule | undefined>(undefined);
  const [trigger, setTriggerState] = useState<FlowTrigger | undefined>(undefined);
  const [baseline, setBaseline] = useState<number | undefined>(undefined);
  const history = useRef(createHistory<FlowGraph>());
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const readGraph = useCallback(
    () => ({ nodes: getNodes(), edges: getEdges() }),
    [getEdges, getNodes]
  );

  const snapshot = useCallback((): FlowGraph => {
    const graph = readGraph();
    return { nodes: structuredClone(graph.nodes), edges: structuredClone(graph.edges) };
  }, [readGraph]);

  // The canvas store applies a change *before* telling us, so the state worth
  // undoing to is the one from before this change — kept here and recorded when
  // the next change lands. One mechanism for every edit, whether the user
  // dragged it or a toolbar action made it, so nothing double-records.
  const previousGraph = useRef<FlowGraph | null>(null);
  // Applying an undo produces canvas changes of its own. Without this they
  // would look like a fresh edit and wipe the redo trail.
  const applyingHistory = useRef(false);

  const remember = useCallback(() => {
    if (applyingHistory.current) return;
    if (previousGraph.current) {
      history.current.record(previousGraph.current);
      setHistoryState({ canUndo: history.current.canUndo(), canRedo: history.current.canRedo() });
    }
    previousGraph.current = snapshot();
  }, [snapshot]);

  const refreshAnalysis = useCallback(() => {
    const candidate = graphToFlow(baseRef.current, readGraph());
    setAnalysis({ references: referencesByNode(candidate), issues: issuesByNode(candidate) });
    setIsEmpty(candidate.nodes.length === 0);
    setVariables(candidate.variables);
    setScheduleState(candidate.schedule);
    setTriggerState(candidate.trigger);
    setBaseline(candidate.manualBaselineMinutes);
  }, [readGraph]);

  const applyContent = useCallback((flow: Flow) => {
    baseRef.current = flow;
    const graph = flowToGraph(flow);
    setLoaded((previous) => ({ graph, revision: (previous?.revision ?? 0) + 1 }));
    // Seed the undo baseline from the graph we just loaded, not from a read of
    // the canvas store: that read can happen before the nodes have mounted, and
    // an empty baseline makes the first undo wipe the whole flow.
    previousGraph.current = { nodes: structuredClone(graph.nodes), edges: structuredClone(graph.edges) };
    setSaveErrors(null);
    // A reload replaces the document; the old canvas history no longer applies.
    history.current.reset();
    previousGraph.current = null;
    setHistoryState({ canUndo: false, canRedo: false });
  }, []);

  const onSave = useCallback(async () => {
    const result = prepareSave(baseRef.current, readGraph());
    if (!result.ok) {
      setSaveErrors(result.summary);
      throw new Error(result.summary);
    }
    setSaveErrors(null);
    baseRef.current = result.flow;
    await host.saveContent(result.text);
  }, [host, readGraph]);

  const { isLoading, error, markDirty, isDirty } = useEditorLifecycle<Flow>(host, {
    parse: parseFlowOrThrow,
    applyContent,
    getCurrentContent: () => graphToFlow(baseRef.current, readGraph()),
    onSave,
    onLoaded: () => {
      refreshAnalysis();
    },
  });

  // Frame the graph once xyflow reports the nodes measured. The `fitView` prop
  // and onLoaded both run before the custom nodes have real dimensions, so they
  // fit against zero-size nodes and under-frame; nodesInitialized flips
  // false->true on each remount (keyed by loaded.revision) after measurement.
  useEffect(() => {
    if (nodesInitialized) {
      fitView({ padding: 0.2, maxZoom: 1 });
    }
  }, [nodesInitialized, fitView]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowCanvasNode>[]) => {
      if (changes.some(isUserChange)) {
        remember();
        markDirty();
      }
      refreshAnalysis();
    },
    [markDirty, refreshAnalysis, remember]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowCanvasEdge>[]) => {
      if (changes.some(isUserChange)) {
        remember();
        markDirty();
      }
      refreshAnalysis();
    },
    [markDirty, refreshAnalysis, remember]
  );

  // The canvas is uncontrolled, so xyflow adds the edge to its own store; this
  // only records that the document changed. Adding it here as well would write
  // the connection to the file twice.
  const onConnect = useCallback(
    (_connection: Connection) => {
      markDirty();
      refreshAnalysis();
    },
    [markDirty, refreshAnalysis]
  );

  // Gate a connection before xyflow commits it: no self-loops, no duplicates,
  // no cycles. Reads live edges so an in-session redraw is judged against the
  // current graph, not a stale snapshot.
  const isValidConnection = useCallback(
    (connection: Connection | FlowCanvasEdge) =>
      isValidFlowConnection(connection, getEdges()),
    [getEdges]
  );

  // Double-click flips an edge between the success path and the failure path.
  // A failure edge cannot carry a port (the validator refuses the pair), so
  // flipping deliberately drops any port label rather than smuggling it along.
  const onEdgeDoubleClick = useCallback(
    (_event: React.MouseEvent, edge: FlowCanvasEdge) => {
      remember();
      setEdges((edges) =>
        edges.map((candidate) => {
          if (candidate.id !== edge.id) return candidate;
          const failure = (candidate.data as { on?: string } | undefined)?.on === 'failure';
          return failure
            ? { ...candidate, data: {}, className: undefined, label: undefined }
            : { ...candidate, data: { on: 'failure' }, className: 'flow-edge-failure', label: 'on failure' };
        })
      );
      markDirty();
      refreshAnalysis();
    },
    [markDirty, refreshAnalysis, remember, setEdges]
  );

  const addNodeOfType = useCallback(
    (type: NodeType) => {
      const existing = getNodes();
      const id = nextNodeId(type, new Set(existing.map((node) => node.id)));
      // Start from what the user is actually looking at, then find free space
      // so a new node never lands buried under an existing one.
      remember();
      const viewportCentre = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      addNodes({
        id,
        type,
        position: placeNewNode(existing, viewportCentre),
        data: { node: createNode(type, id) },
      });
      markDirty();
      refreshAnalysis();
    },
    [addNodes, getNodes, markDirty, refreshAnalysis, remember, screenToFlowPosition]
  );

  useEffect(() => {
    const services = getHostServices();
    const workspace = host.filePath.slice(0, Math.max(host.filePath.lastIndexOf('/'), 0));
    const ipc = (window as unknown as { electronAPI?: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } })
      .electronAPI;
    if (!ipc || !services.ai) return;

    let cancelled = false;
    void loadCatalog(ipc, services.ai, host.workspaceId ?? workspace, () =>
      scanWorkspaceCatalog(services.filesystem)
    ).then((next) => {
      if (!cancelled) setCatalog(next);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  const setVariable = useCallback(
    (name: string, value: string) => {
      baseRef.current = {
        ...baseRef.current,
        variables: { ...baseRef.current.variables, [name]: value },
      };
      markDirty();
      refreshAnalysis();
    },
    [markDirty, refreshAnalysis]
  );

  const removeVariable = useCallback(
    (name: string) => {
      const { [name]: _removed, ...rest } = baseRef.current.variables;
      baseRef.current = { ...baseRef.current, variables: rest };
      markDirty();
      refreshAnalysis();
    },
    [markDirty, refreshAnalysis]
  );

  // Renaming rewrites every {{…}} that used the old name; without that the
  // rename would silently break prompts and only fail at run time.
  const renameVariableAndRefs = useCallback(
    (from: string, to: string) => {
      if (from === to || validVariableName(to) || to in baseRef.current.variables) return;

      const current = graphToFlow(baseRef.current, readGraph());
      const next = renameVariable(current, from, to);
      baseRef.current = { ...baseRef.current, variables: next.variables };
      const graph = flowToGraph(next);
      setNodes(graph.nodes);
      setEdges(graph.edges);
      markDirty();
      refreshAnalysis();
    },
    [markDirty, readGraph, refreshAnalysis, setEdges, setNodes]
  );

  const applyGraph = useCallback(
    (graph: FlowGraph) => {
      applyingHistory.current = true;
      setNodes(graph.nodes);
      setEdges(graph.edges);
      previousGraph.current = { nodes: structuredClone(graph.nodes), edges: structuredClone(graph.edges) };
      markDirty();
      refreshAnalysis();
      setHistoryState({ canUndo: history.current.canUndo(), canRedo: history.current.canRedo() });
      // Released after the store has emitted the changes this apply caused.
      window.setTimeout(() => {
        applyingHistory.current = false;
      }, 0);
    },
    [markDirty, refreshAnalysis, setEdges, setNodes]
  );

  const undo = useCallback(() => {
    const previous = history.current.undo(snapshot());
    if (previous) applyGraph(previous);
  }, [applyGraph, snapshot]);

  const redo = useCallback(() => {
    const next = history.current.redo(snapshot());
    if (next) applyGraph(next);
  }, [applyGraph, snapshot]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [redo, undo]);

  const onDuplicate = useCallback(
    (nodeId: string) => {
      const nodes = getNodes();
      const original = nodes.find((node) => node.id === nodeId);
      if (!original) return;
      remember();
      addNodes(duplicateNode(original, nodes));
      markDirty();
      refreshAnalysis();
    },
    [addNodes, getNodes, markDirty, refreshAnalysis, remember]
  );

  // Collapse-all / expand-all and the Esc/Enter shortcuts reach the cards
  // through a broadcast command rather than by writing their open state into
  // the store — run state and view state must never dirty the document.
  const [disclosure, setDisclosure] = useState<Disclosure>({ epoch: 0, open: false });
  const [bodiesExpanded, setBodiesExpanded] = useState(false);
  const disclose = useCallback((open: boolean, target?: readonly string[]) => {
    setDisclosure((current) => nextDisclosure(current, open, target));
  }, []);
  const toggleAllBodies = useCallback(() => {
    setBodiesExpanded((wasExpanded) => {
      disclose(!wasExpanded);
      return !wasExpanded;
    });
  }, [disclose]);

  const selectedNodeIds = useCallback(
    () => getNodes().filter((node) => node.selected).map((node) => node.id),
    [getNodes]
  );

  // Esc collapses (the selection, or everything when nothing is picked), Enter
  // opens the selection, Cmd/Ctrl+D duplicates it. Skipped while typing or with
  // a control focused so the shortcuts never fight a text field or a button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, button, a, [contenteditable="true"], .flow-gate')
      ) {
        return;
      }
      if (event.key === 'Escape') {
        const selected = selectedNodeIds();
        disclose(false, selected.length > 0 ? selected : undefined);
        return;
      }
      if (event.key === 'Enter') {
        const selected = selectedNodeIds();
        if (selected.length === 0) return;
        event.preventDefault();
        disclose(true, selected);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        const selected = selectedNodeIds();
        if (selected.length === 0) return;
        event.preventDefault();
        for (const nodeId of selected) onDuplicate(nodeId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disclose, onDuplicate, selectedNodeIds]);

  // Deleting a step that still feeds a surviving one strands its output; ask
  // first. A leaf, or a whole sub-graph removed together, deletes silently.
  const onBeforeDelete = useCallback(
    async ({ nodes }: { nodes: FlowCanvasNode[]; edges: FlowCanvasEdge[] }) => {
      if (nodes.length === 0) return true;
      const deletedIds = new Set(nodes.map((node) => node.id));
      if (!hasDownstreamDependents(deletedIds, getEdges())) return true;
      const label = nodes.length === 1 ? 'this step' : `these ${nodes.length} steps`;
      return window.confirm(
        `Delete ${label}? A later step still depends on it and will lose its input.`
      );
    },
    [getEdges]
  );

  // Dropping a connection on empty canvas creates the next node already wired,
  // which is the fastest way to extend a flow.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;

      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const position = screenToFlowPosition({ x: point.clientX, y: point.clientY });
      const id = uniqueNodeId('agent', new Set(getNodes().map((node) => node.id)));

      remember();
      addNodes({ id, type: 'agent', position, data: { node: createNode('agent', id) } });
      addEdges({ id: `${state.fromNode.id}->${id}`, source: state.fromNode.id, target: id });
      markDirty();
      refreshAnalysis();
    },
    [addEdges, addNodes, getNodes, markDirty, refreshAnalysis, remember, screenToFlowPosition]
  );

  const nodeTypes = useMemo(
    () => createNodeTypes(markDirty, onDuplicate),
    [markDirty, onDuplicate]
  );
  const run = useFlowRun(host);
  // Runs that did not reach a clean finish; surfaced on the toolbar so a
  // history full of failures is visible without opening it.
  const unsettledRuns = pastRuns.filter((record) => {
    const status = displayStatus(record, run.runState?.runId ?? null);
    return status === 'failed' || status === 'interrupted';
  }).length;

  // Reload past runs when the editor opens and after each run finishes.
  useEffect(() => {
    if (run.isRunning) return;
    const root = host.workspaceId ?? host.filePath.slice(0, Math.max(host.filePath.lastIndexOf('/'), 0));
    const services = getHostServices();
    // The writer settles records abandoned by an earlier session, so a phantom
    // "running" run does not survive on disk for the next reader.
    void loadRunHistory(services.filesystem, host.filePath, root, run.runState?.runId ?? null, {
      write: (path, content) => services.filesystem.writeFile(path, content),
    }).then(setPastRuns);
  }, [host, run.isRunning]);

  /** Put one of a run's sessions on screen. */
  const showSession = useCallback(
    async (sessionId: string) => {
      const ipc = (window as unknown as { electronAPI?: HostIpc }).electronAPI;
      if (ipc) await openSession(ipc, sessionId, host.workspaceId);
    },
    [host.workspaceId]
  );

  /** Remove one run record, and the row with it. */
  const forgetRun = useCallback(
    async (record: RunRecord) => {
      const ipc = (window as unknown as { electronAPI?: HostIpc }).electronAPI;
      if (!ipc) return;
      await deleteRunRecord(ipc, record.flowPath, record.runId);
      setPastRuns((runs) => runs.filter((past) => past.runId !== record.runId));
      setOpenRun(null);
    },
    []
  );

  /** The author's own estimate of the manual cost of this flow. */
  const patchBaseline = useCallback(
    (raw: string) => {
      const minutes = Number(raw);
      const next = raw.trim() === '' || !Number.isFinite(minutes) || minutes < 1
        ? undefined
        : Math.round(minutes);
      baseRef.current = { ...baseRef.current, manualBaselineMinutes: next };
      setBaseline(next);
      markDirty();
    },
    [markDirty]
  );

  /** Edit the schedule on the document, the way variables are edited. */
  const patchSchedule = useCallback(
    (changes: Partial<Record<string, unknown>>) => {
      const current = (baseRef.current.schedule ?? {
        type: 'daily',
        time: '02:00',
        enabled: false,
      }) as unknown as Record<string, unknown>;
      const next = { ...current, ...changes } as unknown as FlowSchedule;
      baseRef.current = { ...baseRef.current, schedule: next };
      setScheduleState(next);
      markDirty();
    },
    [markDirty]
  );

  /** Edit the trigger on the document, the way the schedule is edited. */
  const patchTrigger = useCallback(
    (changes: Partial<Record<string, unknown>>) => {
      const current = (baseRef.current.trigger ?? {
        type: 'file-change',
        glob: '**/*.md',
        debounceSeconds: 10,
        enabled: false,
      }) as unknown as Record<string, unknown>;
      const next = { ...current, ...changes } as unknown as FlowTrigger;
      baseRef.current = { ...baseRef.current, trigger: next };
      setTriggerState(next);
      markDirty();
    },
    [markDirty]
  );

  const useTemplate = useCallback(
    (template: FlowTemplate) => {
      remember();
      const flow = template.build(baseRef.current.name);
      // Adopt the template's variables too, not just its nodes: its prompts
      // reference them, so without this the flow arrives already invalid.
      baseRef.current = { ...baseRef.current, variables: flow.variables };
      const graph = applyTemplate(template, baseRef.current.name);
      setNodes(graph.nodes);
      setEdges(graph.edges);
      markDirty();
      refreshAnalysis();
      window.setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 0);
    },
    [fitView, markDirty, refreshAnalysis, remember, setEdges, setNodes]
  );

  // Draft-with-AI: intent in, validated flow out, landed exactly as a
  // template lands. The model's JSON never reaches the canvas unvalidated —
  // see aiDraft.ts — so the failure mode here is a message, not a document.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const applyDraft = useCallback(
    (flow: Flow) => {
      remember();
      baseRef.current = { ...flow };
      const graph = flowToGraph(flow);
      setNodes(graph.nodes);
      setEdges(graph.edges);
      markDirty();
      refreshAnalysis();
      window.setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 0);
    },
    [fitView, markDirty, refreshAnalysis, remember, setEdges, setNodes]
  );

  const runDraft = useCallback(
    async (work: () => Promise<import('./aiDraft').DraftResult>) => {
      const ai = getHostServices().ai;
      if (!ai) {
        setAiError('No AI service is available in this host.');
        return;
      }
      setAiBusy(true);
      setAiError(null);
      try {
        const result = await work();
        if ('flow' in result) {
          applyDraft(result.flow);
          setAiOpen(false);
        } else {
          setAiError(
            `The draft did not pass validation: ${result.errors
              .map((error) => (error.path ? `${error.path}: ${error.message}` : error.message))
              .join('; ')}`
          );
        }
      } catch (error) {
        setAiError(error instanceof Error ? error.message : String(error));
      } finally {
        setAiBusy(false);
      }
    },
    [applyDraft]
  );

  // The prepared flow awaiting approval. Run state, never the xyflow store —
  // this must not dirty the document.
  const [pendingRun, setPendingRun] = useState<Flow | null>(null);

  // Run what is on the canvas, not what is on disk, but refuse to run something
  // that would not survive a save.
  const startRun = useCallback(() => {
    const prepared = prepareSave(baseRef.current, readGraph());
    if (!prepared.ok) {
      setSaveErrors(prepared.summary.replace('was not saved', 'cannot be run'));
      return;
    }
    setSaveErrors(null);
    const summary = flowEffects(prepared.flow, { shellAllowlist: SHELL_ALLOWLIST });
    if (summary.empty) {
      void run.start(prepared.flow); // read-only flow: nothing to review
      return;
    }
    setPendingRun(prepared.flow);
  }, [readGraph, run]);

  // Nodes the analysis flagged — the same set the header issue-flags mark. Used
  // to gate Run and to let the toolbar walk the user to each one.
  const invalidNodeIds = useMemo(
    () => Object.entries(analysis.issues).filter(([, list]) => list.length > 0).map(([id]) => id),
    [analysis.issues]
  );

  // Select a node and pan it to the centre. Selection lives in the xyflow store,
  // not the file, so this never dirties the document.
  const focusNode = useCallback(
    (id: string) => {
      const node = getNodes().find((candidate) => candidate.id === id);
      if (!node) return;
      setNodes((nodes) => nodes.map((candidate) => ({ ...candidate, selected: candidate.id === id })));
      const width = node.measured?.width ?? node.width ?? 240;
      const height = node.measured?.height ?? node.height ?? 100;
      setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1, duration: 300 });
    },
    [getNodes, setNodes, setCenter]
  );

  // The toolbar chip walks through the flagged nodes one click at a time, so a
  // long list is reachable without hunting the canvas.
  const invalidCursor = useRef(0);
  const focusNextInvalid = useCallback(() => {
    if (invalidNodeIds.length === 0) return;
    const index = invalidCursor.current % invalidNodeIds.length;
    invalidCursor.current = index + 1;
    focusNode(invalidNodeIds[index]);
  }, [invalidNodeIds, focusNode]);

  // What flowed through a clicked wire. Live outputs win over the record so
  // the panel updates as a run streams; selection survives until closed or
  // replaced. Never in the xyflow store — run state must not dirty the doc.
  const [inspectedEdge, setInspectedEdge] = useState<{
    from: string;
    to: string;
    port?: string;
    on?: string;
    when?: string;
  } | null>(null);

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: FlowCanvasEdge) => {
    const data = edge.data as { on?: string; when?: string } | undefined;
    setInspectedEdge({
      from: edge.source,
      to: edge.target,
      // A condition owns the label, so the port only reads off the label when
      // there is no condition — otherwise the port is carried in data.
      port: data?.when === undefined && typeof edge.label === 'string' ? edge.label : undefined,
      on: data?.on,
      when: data?.when,
    });
  }, []);

  // Apply a routing change (failure branch, condition) to the inspected wire and
  // keep the two decisions independent: setting a condition preserves the
  // success/failure choice, and flipping the branch preserves the condition.
  // One recompute through `edgeVisual` so the live wire matches what a reload
  // would draw.
  const applyEdge = useCallback(
    (patch: { port?: string; on?: string; when?: string }) => {
      if (!inspectedEdge) return;
      const next = { ...inspectedEdge, ...patch };
      remember();
      setEdges((edges) =>
        edges.map((edge) => {
          if (edge.source !== inspectedEdge.from || edge.target !== inspectedEdge.to) return edge;
          const visual = edgeVisual({ port: next.port, on: next.on, when: next.when });
          return { ...edge, data: visual.data, className: visual.className, label: visual.label };
        })
      );
      markDirty();
      refreshAnalysis();
      setInspectedEdge(next);
    },
    [inspectedEdge, markDirty, refreshAnalysis, remember, setEdges]
  );

  const inspectedOutputs = run.runState?.outputs ?? pastRuns[0]?.outputs;
  const inspectedPayload = inspectedEdge ? edgePayload(inspectedEdge, inspectedOutputs) : null;

  const reliability = useMemo(() => nodeReliability(pastRuns), [pastRuns]);

  // The note travelling with the next gate decision; cleared when it lands.
  const [gateComment, setGateComment] = useState('');

  // The sub-agent whose worktree diff is open, and the fan-out's picked
  // winner. Editor-local, never in the xyflow store: winners are a manual,
  // non-destructive marker, not a merge.
  const [diffChild, setDiffChild] = useState<{ parentId: string; child: ChildProgress } | null>(null);
  const [winners, setWinners] = useState<Record<string, string>>({});

  // Where this flow was last panned/zoomed and whether its minimap showed —
  // read once so the canvas reopens where you left it instead of re-fitting.
  const storedView = useMemo(
    () => parseViewState(host.storage.get(viewStateKey(host.filePath))),
    [host.filePath, host.storage]
  );
  const persistView = useCallback(
    (patch: Partial<FlowViewState>) => {
      const key = viewStateKey(host.filePath);
      const current = parseViewState(host.storage.get(key));
      host.storage.set(key, { ...current, ...patch });
    },
    [host.filePath, host.storage]
  );
  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => persistView({ viewport }),
    [persistView]
  );

  const [showMinimap, setShowMinimap] = useState(() => storedView.minimap ?? true);
  const toggleMinimap = useCallback(() => {
    setShowMinimap((was) => {
      persistView({ minimap: !was });
      return !was;
    });
  }, [persistView]);

  // Elapsed ticker for the progress strip; lives outside the canvas store.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!run.isRunning) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [run.isRunning]);
  const progress = run.isRunning ? runProgress(run.statuses) : null;
  const etas = useMemo(() => stepEtas(pastRuns), [pastRuns]);

  // Replay: scrub through a finished run's timeline. Purely a read over the
  // record, so the slider can jump anywhere; a live run always wins the canvas.
  const [replay, setReplay] = useState<{ record: RunRecord; atMs: number; timeline: RunTimeline | null } | null>(null);
  const [playing, setPlaying] = useState(false);
  const replayActive = replay !== null && !run.isRunning;
  const replaySlices = useMemo(
    () => (replayActive ? replaySlicesFor(replay.timeline, replay.atMs) : null),
    [replayActive, replay]
  );
  const canvasStatuses = useMemo(
    () => (replayActive
      ? (replaySlices?.statuses ?? replayStatuses(replay.record, replay.atMs))
      : run.statuses),
    [replayActive, replaySlices, replay, run.statuses]
  );
  // Auto-advance the scrubber while playing, at REPLAY_SPEED over the recorded
  // wall-clock. Stops itself once it reaches the end of the run/timeline.
  useEffect(() => {
    if (!playing || !replayActive || !replay) return;
    const duration = replay.timeline ? replayTimelineDuration(replay.timeline) : replayDuration(replay.record);
    const TICK = 100;
    const id = setInterval(() => {
      setReplay((prev) => {
        if (!prev) return prev;
        const next = advanceReplay(prev.atMs, TICK, REPLAY_SPEED, duration);
        if (next >= duration) setPlaying(false);
        return { ...prev, atMs: next };
      });
    }, TICK);
    return () => clearInterval(id);
  }, [playing, replayActive, replay]);

  // One store, fed from the maps FlowEditor already derives. It fans each
  // change out to only the affected card, replacing five whole-map contexts
  // that re-rendered every card on every per-node update.
  const runStore = useMemo(() => createNodeRunStore(), []);
  useEffect(() => runStore.setStatuses(canvasStatuses), [runStore, canvasStatuses]);
  useEffect(() => runStore.setResults(replaySlices ? replaySlices.results : run.liveNodes), [runStore, replaySlices, run.liveNodes]);
  useEffect(() => runStore.setChildren(replaySlices ? replaySlices.children : run.children), [runStore, replaySlices, run.children]);
  useEffect(() => runStore.setTails(replayActive ? {} : run.liveTails), [runStore, replayActive, run.liveTails]);
  useEffect(() => runStore.setReliability(reliability), [runStore, reliability]);

  // The Flows home launches runs by recording an intent and opening the flow;
  // the editor owns the run itself. Checked when loading ends (a fresh tab)
  // and on the panel's window event (a tab that was already open).
  useEffect(() => {
    if (isLoading) return;
    const runIfIntended = () => {
      if (consumeRun(host.filePath) && !run.isRunning) startRun();
    };
    runIfIntended();
    window.addEventListener(RUN_INTENT_EVENT, runIfIntended);
    return () => window.removeEventListener(RUN_INTENT_EVENT, runIfIntended);
  }, [host.filePath, isLoading, run.isRunning, startRun]);


  // An interruption is the one run ending nobody watched — the app went away
  // mid-run. Offer the resume rather than leaving it to the retry button.
  const offer = !run.isRunning ? resumeOffer(pastRuns) : null;
  const [dismissedResume, setDismissedResume] = useState<string | null>(null);

  // A run that did not finish cleanly can be resumed: its finished steps are
  // carried over (planResume decides which are still trustworthy), so agents
  // do not re-bill and gates do not re-ask for work that already succeeded.
  const resumable =
    !run.isRunning &&
    pastRuns.length > 0 &&
    ['failed', 'interrupted', 'cancelled'].includes(pastRuns[0].status)
      ? pastRuns[0]
      : null;

  const retryRun = useCallback(() => {
    if (!resumable) return;
    const prepared = prepareSave(baseRef.current, readGraph());
    if (!prepared.ok) {
      setSaveErrors(prepared.summary.replace('was not saved', 'cannot be run'));
      return;
    }
    setSaveErrors(null);
    void run.start(prepared.flow, resumable);
  }, [readGraph, resumable, run]);

  // Run from a node: upstream seeded from the latest record, whatever its
  // status — the user is drawing the boundary, not asking for a retry. Null
  // while unavailable, and the cards hide the button.
  const runFrom = useMemo(
    () =>
      !run.isRunning && pastRuns.length > 0
        ? (id: string) => {
            const prepared = prepareSave(baseRef.current, readGraph());
            if (!prepared.ok) {
              setSaveErrors(prepared.summary.replace('was not saved', 'cannot be run'));
              return;
            }
            setSaveErrors(null);
            void run.start(prepared.flow, pastRuns[0], id);
          }
        : null,
    [pastRuns, readGraph, run]
  );

  if (error) {
    return <FlowLoadError error={error} onEditAsText={host.toggleSourceMode} />;
  }

  return (
    <div className="flow-editor" data-testid="flow-editor" data-flow-theme={theme}>
      <div className="flow-toolbar">
        <span className="flow-toolbar-group-label">Add</span>
        {NODE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className="flow-toolbar-button flow-toolbar-icon"
            data-add-node={type}
            title={`Add a ${NODE_TYPE_LABELS[type].toLowerCase()} node`}
            aria-label={`Add a ${NODE_TYPE_LABELS[type].toLowerCase()} node`}
            onClick={() => addNodeOfType(type)}
          >
            <span className="material-symbols-outlined">{NODE_TYPE_ICONS[type]}</span>
          </button>
        ))}
        <span className="flow-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="flow-toolbar-button"
          data-testid="flow-undo"
          disabled={!historyState.canUndo}
          title="Undo (Cmd+Z)"
          onClick={undo}
        >
          <span className="material-symbols-outlined">undo</span>
        </button>
        <button
          type="button"
          className="flow-toolbar-button"
          data-testid="flow-redo"
          disabled={!historyState.canRedo}
          title="Redo (Cmd+Shift+Z)"
          onClick={redo}
        >
          <span className="material-symbols-outlined">redo</span>
        </button>
        <button
          type="button"
          className="flow-toolbar-button"
          data-testid="flow-runs-toggle"
          onClick={() => setShowRuns((previous) => !previous)}
        >
          <span className="material-symbols-outlined">history</span>
          Runs ({pastRuns.length})
          {/* Six healthy runs and six broken ones looked identical here. */}
          {unsettledRuns > 0 && (
            <span className="flow-toolbar-count" title={`${unsettledRuns} did not finish`}>
              {unsettledRuns}
            </span>
          )}
        </button>
        <button
          type="button"
          className="flow-toolbar-button"
          data-testid="flow-schedule-toggle"
          onClick={() => setShowSchedule((previous) => !previous)}
        >
          <span className="material-symbols-outlined">schedule</span>
          {scheduleLabel(baseRef.current.schedule)}
        </button>
        <button
          type="button"
          className="flow-toolbar-button"
          data-testid="flow-variables-toggle"
          onClick={() => setShowVariables((previous) => !previous)}
        >
          <span className="material-symbols-outlined">data_object</span>
          Variables ({Object.keys(variables).length})
        </button>
        <span className="flow-toolbar-spacer" />
        {run.runState?.usage && (
          <span className="flow-toolbar-cost" data-testid="flow-run-cost">
            {run.runState.usage.inputTokens + run.runState.usage.outputTokens} tokens
            {run.runState.usage.costUsd !== undefined
              ? ` · $${run.runState.usage.costUsd.toFixed(4)}`
              : ''}
          </span>
        )}
        <span className="flow-toolbar-status" data-dirty={isDirty}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {isDirty ? 'pending' : 'check_circle'}
          </span>
          {isDirty ? 'Unsaved changes' : 'Saved'}
        </span>
        {!run.isRunning && (
          <button
            type="button"
            className="flow-toolbar-button"
            data-testid="flow-dry-run"
            title="Rehearse without executing: agents, shell and files are stubbed; gates still ask"
            onClick={() => {
              const prepared = prepareSave(baseRef.current, readGraph());
              if (!prepared.ok) {
                setSaveErrors(prepared.summary.replace('was not saved', 'cannot be run'));
                return;
              }
              setSaveErrors(null);
              void run.dryRun(prepared.flow);
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              experiment
            </span>
            Dry run
          </button>
        )}
        {!run.isRunning && !isEmpty && (
          <button
            type="button"
            className="flow-toolbar-button"
            data-testid="flow-ai-edit-toggle"
            title="Describe a change; the agent revises the flow, validator-checked, undoable"
            onClick={() => setAiOpen((was) => !was)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              auto_awesome
            </span>
            Edit with AI
          </button>
        )}
        {run.isDry && (
          <span className="flow-toolbar-status flow-dry-indicator" data-testid="flow-dry-indicator">
            <span className="material-symbols-outlined" aria-hidden="true">
              experiment
            </span>
            Rehearsal — nothing was executed
          </span>
        )}
        {resumable && (
          <button
            type="button"
            className="flow-toolbar-button"
            data-testid="flow-retry"
            title="Re-run only the steps that did not finish; finished steps are reused"
            onClick={retryRun}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              replay
            </span>
            Retry failed steps
          </button>
        )}
        <details className="flow-toolbar-more" data-testid="flow-more">
          <summary className="flow-toolbar-button flow-toolbar-icon" aria-label="More options">
            <span className="material-symbols-outlined">more_horiz</span>
          </summary>
          <div className="flow-toolbar-menu">
            <button
              type="button"
              className="flow-toolbar-button"
              data-testid="flow-theme"
              data-flow-theme-current={theme}
              title={FLOW_THEMES.find((entry) => entry.id === theme)?.description}
              onClick={() => {
                const next = nextTheme(theme);
                setTheme(next);
                host.storage.set(THEME_STORAGE_KEY, next);
              }}
            >
              <span className="material-symbols-outlined">palette</span>
              {FLOW_THEMES.find((entry) => entry.id === theme)?.label}
            </button>
            <button
              type="button"
              className="flow-toolbar-button"
              data-testid="flow-minimap-toggle"
              onClick={toggleMinimap}
            >
              <span className="material-symbols-outlined">map</span>
              {showMinimap ? 'Hide minimap' : 'Show minimap'}
            </button>
            <button
              type="button"
              className="flow-toolbar-button"
              data-testid="flow-collapse-all"
              onClick={toggleAllBodies}
            >
              <span className="material-symbols-outlined">
                {bodiesExpanded ? 'unfold_less' : 'unfold_more'}
              </span>
              {bodiesExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        </details>
        {!run.isRunning && invalidNodeIds.length > 0 && (
          <button
            type="button"
            className="flow-toolbar-button flow-toolbar-invalid"
            data-testid="flow-invalid-count"
            title="Jump to the next node that needs attention before this flow can run"
            onClick={focusNextInvalid}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              error
            </span>
            {invalidNodeIds.length} to fix
          </button>
        )}
        <button
          type="button"
          className="flow-toolbar-run"
          data-testid="flow-run"
          disabled={!run.isRunning && invalidNodeIds.length > 0}
          title={
            !run.isRunning && invalidNodeIds.length > 0
              ? `${invalidNodeIds.length} node${invalidNodeIds.length === 1 ? ' needs' : 's need'} attention before this flow can run`
              : undefined
          }
          onClick={run.isRunning ? run.cancel : startRun}
        >
          <span className="material-symbols-outlined">{run.isRunning ? 'stop' : 'play_arrow'}</span>
          {run.isRunning ? 'Cancel' : 'Run'}
        </button>
      </div>

      {progress && (
        <div className="flow-run-progress" data-testid="flow-run-progress" role="status">
          <span className="material-symbols-outlined flow-run-progress-spin" aria-hidden="true">
            progress_activity
          </span>
          <span>
            step {Math.min(progress.settled + 1, progress.total)} of {progress.total}
          </span>
          {progress.running.map((nodeId) => (
            <button
              key={nodeId}
              type="button"
              className="flow-run-progress-node"
              data-progress-node={nodeId}
              title="Show this step on the canvas"
              onClick={() => fitView({ nodes: [{ id: nodeId }], maxZoom: 1.1, duration: 300 })}
            >
              {nodeId}
              {etas[nodeId] !== undefined && (
                <span className="flow-run-progress-eta"> · usually ~{formatDuration(etas[nodeId])}</span>
              )}
            </button>
          ))}
          {run.runState?.startedAt !== undefined && (
            <span className="flow-run-progress-elapsed">
              {formatDuration(Math.max(nowTick - run.runState.startedAt, 0))}
            </span>
          )}
        </div>
      )}

      {offer && offer.record.runId !== dismissedResume && (
        <div className="flow-resume-banner" data-testid="flow-resume-banner" role="status">
          <span className="material-symbols-outlined" aria-hidden="true">
            history
          </span>
          <span>
            Last run was interrupted —{' '}
            {offer.finished === 1 ? '1 finished step' : `${offer.finished} finished steps`} will be
            kept.
          </span>
          <button
            type="button"
            className="flow-toolbar-button"
            data-testid="flow-resume-banner-go"
            onClick={retryRun}
          >
            Resume
          </button>
          <button
            type="button"
            className="flow-toolbar-button"
            data-testid="flow-resume-banner-dismiss"
            onClick={() => setDismissedResume(offer.record.runId)}
          >
            Dismiss
          </button>
        </div>
      )}

      {inspectedEdge && (
        <div className="flow-edge-payload" data-testid="flow-edge-payload">
          <div className="flow-edge-payload-head">
            <span className="flow-edge-payload-route">
              {inspectedEdge.from} → {inspectedEdge.to}
              {inspectedEdge.on === 'failure' && ' · on failure'}
            </span>
            {inspectedPayload && <code>{`{{${inspectedPayload.label}}}`}</code>}
            <span className="flow-toolbar-spacer" />
            {inspectedOutputs && (
              <span className="flow-node-hint-inline">
                {run.runState?.outputs ? 'from the current run' : 'from the last run'}
              </span>
            )}
            <button
              type="button"
              className="flow-toolbar-button"
              data-testid="flow-edge-toggle-failure"
              title="Route this wire on failure instead of success (also: double-click the wire)"
              onClick={() => applyEdge({ on: inspectedEdge.on === 'failure' ? undefined : 'failure' })}
            >
              {inspectedEdge.on === 'failure' ? 'On failure' : 'On success'}
            </button>
            <button
              type="button"
              className="flow-toolbar-button"
              data-testid="flow-edge-payload-close"
              aria-label="Close the payload panel"
              onClick={() => setInspectedEdge(null)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                close
              </span>
            </button>
          </div>
          <EdgeConditionEditor
            key={`${inspectedEdge.from}->${inspectedEdge.to}`}
            from={inspectedEdge.from}
            port={inspectedEdge.port}
            when={inspectedEdge.when}
            onChange={(when) => applyEdge({ when })}
          />
          {inspectedPayload ? (
            <pre className="flow-edge-payload-value">{inspectedPayload.value}</pre>
          ) : (
            <p className="flow-node-hint">
              Nothing recorded on this wire yet — run the flow to see the hand-off.
            </p>
          )}
        </div>
      )}

      {replayActive && (
        <div className="flow-replay" data-testid="flow-replay">
          <span className="material-symbols-outlined" aria-hidden="true">
            history
          </span>
          <span className="flow-replay-label">
            Replaying {relativeWhen(replay.record.startedAt)} run
          </span>
          <button
            type="button"
            className="flow-toolbar-button flow-replay-play"
            data-testid="flow-replay-play"
            aria-label={playing ? 'Pause replay' : 'Play replay'}
            aria-pressed={playing}
            onClick={() => setPlaying((p) => !p)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {playing ? 'pause' : 'play_arrow'}
            </span>
          </button>
          <input
            className="flow-replay-slider"
            type="range"
            aria-label="Replay position"
            min={0}
            max={replayDuration(replay.record)}
            step={100}
            value={replay.atMs}
            onPointerDown={() => setPlaying(false)}
            onChange={(event) =>
              setReplay(replay && { ...replay, atMs: Number(event.target.value) })
            }
          />
          <span className="flow-replay-time" data-testid="flow-replay-time">
            {formatDuration(replay.atMs)} / {formatDuration(replayDuration(replay.record))}
          </span>
          <button
            type="button"
            className="flow-toolbar-button"
            data-testid="flow-replay-close"
            aria-label="Stop replaying"
            onClick={() => {
              setReplay(null);
              setPlaying(false);
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>
      )}

      {aiOpen && (
        <div className="flow-variables flow-ai-edit" data-testid="flow-ai-edit">
          <form
            className="flow-draft-row"
            onSubmit={(event) => {
              event.preventDefault();
              const input = (event.target as HTMLFormElement).elements.namedItem(
                'instruction'
              ) as HTMLInputElement;
              const instruction = input.value.trim();
              if (instruction === '' || aiBusy) return;
              void runDraft(() =>
                editFlow(
                  getHostServices().ai!,
                  graphToFlow(baseRef.current, readGraph()),
                  instruction
                )
              );
            }}
          >
            <input
              className="flow-node-input"
              name="instruction"
              disabled={aiBusy}
              placeholder="e.g. add a security-review skill step before the gate, fed by the draft"
              aria-label="Describe the change"
            />
            <button type="submit" className="flow-toolbar-button" disabled={aiBusy} data-testid="flow-ai-edit-go">
              {aiBusy ? 'Revising…' : 'Apply'}
            </button>
          </form>
          {aiError && (
            <p className="flow-editor-invalid" role="alert" data-testid="flow-ai-edit-error">
              {aiError}
            </p>
          )}
          <p className="flow-node-hint">
            The revision replaces the whole canvas as one undoable edit; nothing lands unless it
            passes the validator.
          </p>
        </div>
      )}

      {showRuns && (
        <div className="flow-variables flow-run-history" data-testid="flow-run-history">
          {pastRuns.length === 0 ? (
            <p className="flow-node-hint">
              This flow has not run yet. Runs are recorded in <code>.flow-runs/</code>.
            </p>
          ) : (
            <>
              <p className="flow-run-summary" data-testid="flow-run-history-summary">
                {historySummary(pastRuns, run.runState?.runId ?? null)}
              </p>
              <table className="flow-run-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Status</th>
                    <th>Outcome</th>
                    <th className="flow-run-number">Took</th>
                    <th className="flow-run-number flow-run-optional">Tokens</th>
                    <th className="flow-run-number flow-run-optional">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {pastRuns.map((record) => {
                    const status = displayStatus(record, run.runState?.runId ?? null);
                    const expanded = openRun === record.runId;
                    return (
                      <Fragment key={record.runId}>
                      <tr
                        data-past-run={record.runId}
                        data-run-status={status}
                        className="flow-run-row"
                        onClick={() => setOpenRun(expanded ? null : record.runId)}
                      >
                        <td title={new Date(record.startedAt).toLocaleString()}>
                          {relativeWhen(record.startedAt)}
                        </td>
                        <td>
                          <span className={`flow-node-badge flow-node-badge-${status}`}>
                            {status}
                          </span>
                        </td>
                        {/* The run id used to own this column; where a run got to
                            is what a reader needs, and the id is on the row. */}
                        <td className="flow-run-outcome" title={record.runId}>
                          {runOutcome(record, status)}
                        </td>
                        <td className="flow-run-number">
                          {formatDuration(
                            record.finishedAt !== undefined
                              ? record.finishedAt - record.startedAt
                              : undefined
                          )}
                        </td>
                        <td
                          className="flow-run-number flow-run-optional"
                          title={
                            tokensLabel(record) === '—' ? 'Token usage was not recorded' : undefined
                          }
                        >
                          {tokensLabel(record)}
                        </td>
                        <td className="flow-run-number flow-run-optional">
                          {record.usage.costUsd !== undefined
                            ? `$${record.usage.costUsd.toFixed(4)}`
                            : '—'}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="flow-run-detail" data-run-detail={record.runId}>
                          <td colSpan={6}>
                            <ul className="flow-run-steps">
                              {Object.values(record.nodes).map((node) => (
                                <li key={node.nodeId} data-detail-node={node.nodeId}>
                                  <span
                                    className={`flow-node-badge flow-node-badge-${node.status}`}
                                  >
                                    {node.status}
                                  </span>
                                  <strong>{node.nodeId}</strong>
                                  {node.worktree && <WorktreeChip worktree={node.worktree} />}
                                  {(node.children ?? [])
                                    .filter((child) => child.worktree)
                                    .map((child) => (
                                      <WorktreeChip key={child.label} worktree={child.worktree!} />
                                    ))}
                                  {(node.attempts ?? 1) > 1 && (
                                    <em className="flow-run-warned" data-attempts={node.nodeId}>
                                      took {node.attempts} attempts
                                    </em>
                                  )}
                                  {node.error && <em>{node.error}</em>}
                                  {!node.error && node.warning && (
                                    <em className="flow-run-warned">{node.warning}</em>
                                  )}
                                  {(node.children ?? [])
                                    .filter((child) => child.output ?? child.error)
                                    .map((child) => (
                                      <span
                                        key={child.label}
                                        className="flow-run-child"
                                        data-run-child={child.label}
                                        title={child.error ?? child.output}
                                      >
                                        <strong>{child.label}</strong> {child.error ?? child.output}
                                      </span>
                                    ))}
                                </li>
                              ))}
                            </ul>
                            {record.sessionIds.length > 0 && (
                              <p className="flow-run-sessions">
                                {record.sessionIds.map((sessionId, index) => (
                                  <button
                                    key={sessionId}
                                    type="button"
                                    className="flow-run-session-link"
                                    data-open-session={sessionId}
                                    title={sessionId}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void showSession(sessionId);
                                    }}
                                  >
                                    Session {index + 1}
                                  </button>
                                ))}
                              </p>
                            )}
                            <p className="flow-run-detail-id">{record.runId}</p>
                            {!run.isRunning && replayDuration(record) > 0 && (
                              <button
                                type="button"
                                className="flow-node-duplicate"
                                data-replay-run={record.runId}
                                title="Scrub through this run's timeline on the canvas"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const atMs = replayDuration(record);
                                  setReplay({ record, atMs, timeline: null });
                                  const services = getHostServices();
                                  const root =
                                    host.workspaceId ??
                                    host.filePath.slice(0, Math.max(host.filePath.lastIndexOf('/'), 0));
                                  void loadRunTimeline(
                                    services.filesystem,
                                    host.filePath,
                                    record.runId,
                                    root
                                  ).then((timeline) => {
                                    setReplay((prev) =>
                                      prev && prev.record.runId === record.runId
                                        ? { ...prev, timeline }
                                        : prev
                                    );
                                  });
                                }}
                              >
                                <span className="material-symbols-outlined">history</span>
                                Replay
                              </button>
                            )}
                            <button
                              type="button"
                              className="flow-node-duplicate flow-run-forget"
                              data-forget-run={record.runId}
                              title="Delete this run record"
                              onClick={(event) => {
                                event.stopPropagation();
                                void forgetRun(record);
                              }}
                            >
                              <span className="material-symbols-outlined">delete</span>
                              Forget this run
                            </button>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {showSchedule && (
        <div className="flow-variables flow-schedule" data-testid="flow-schedule">
          <label className="flow-node-toggle">
            <input
              type="checkbox"
              aria-label="Run on a schedule"
              checked={schedule?.enabled === true}
              onChange={(event) => patchSchedule({ enabled: event.target.checked })}
            />
            <span>Run this flow on a schedule</span>
          </label>

          <label className="flow-node-field">
            <span className="flow-node-field-label">How often</span>
            <select
              className="flow-node-input"
              aria-label="How often"
              value={schedule?.type ?? 'daily'}
              onChange={(event) =>
                patchSchedule({ type: event.target.value as FlowSchedule['type'] })
              }
            >
              <option value="daily">Every day</option>
              <option value="weekly">Certain days</option>
              <option value="interval">Every so often</option>
            </select>
          </label>

          {schedule?.type === 'interval' ? (
            <label className="flow-node-field">
              <span className="flow-node-field-label">Minutes between runs</span>
              <input
                className="flow-node-input"
                type="number"
                min={1}
                aria-label="Minutes between runs"
                value={schedule.intervalMinutes ?? 60}
                onChange={(event) =>
                  patchSchedule({ intervalMinutes: Number(event.target.value) || 1 })
                }
              />
            </label>
          ) : (
            <label className="flow-node-field">
              <span className="flow-node-field-label">At</span>
              <input
                className="flow-node-input"
                type="time"
                aria-label="At"
                value={(schedule as { time?: string } | undefined)?.time ?? '02:00'}
                onChange={(event) => patchSchedule({ time: event.target.value })}
              />
            </label>
          )}

          {schedule?.type === 'weekly' && (
            <div className="flow-node-field">
              <span className="flow-node-field-label">On</span>
              <div className="flow-schedule-days">
                {WEEKDAYS.map((day) => (
                  <label key={day} className="flow-node-toggle">
                    <input
                      type="checkbox"
                      aria-label={day}
                      checked={(schedule.days ?? []).includes(day)}
                      onChange={(event) => {
                        const days = new Set(schedule.days ?? []);
                        if (event.target.checked) days.add(day);
                        else days.delete(day);
                        patchSchedule({ days: [...days] });
                      }}
                    />
                    <span>{day}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* A scheduled run has nobody to approve a gate, so say what happens. */}
          {baseRef.current.nodes.some((node) => node.type === 'human-gate') && (
            <p className="flow-node-hint" data-testid="flow-schedule-gate-hint">
              This flow waits for a person at a gate. A scheduled run will pause there and
              notify you.
            </p>
          )}

          <div className="flow-trigger" data-testid="flow-trigger">
            <label className="flow-node-toggle">
              <input
                type="checkbox"
                aria-label="Run when matching files change"
                checked={trigger?.enabled === true}
                onChange={(event) => patchTrigger({ enabled: event.target.checked })}
              />
              <span>Run when matching files change</span>
            </label>

            <label className="flow-node-field">
              <span className="flow-node-field-label">Files (glob)</span>
              <input
                className="flow-node-input"
                aria-label="Files (glob)"
                placeholder="notes/**/*.md"
                value={trigger?.glob ?? ''}
                onChange={(event) => patchTrigger({ glob: event.target.value })}
              />
            </label>

            <label className="flow-node-field">
              <span className="flow-node-field-label">
                Quiet seconds before running
                <span className="flow-node-hint-inline">saves arrive in bursts</span>
              </span>
              <input
                className="flow-node-input"
                type="number"
                min={1}
                max={600}
                aria-label="Quiet seconds before running"
                value={trigger?.debounceSeconds ?? 10}
                onChange={(event) =>
                  patchTrigger({ debounceSeconds: Number(event.target.value) || 10 })
                }
              />
            </label>
          </div>
        </div>
      )}

      {showVariables && (
        <div className="flow-variables" data-testid="flow-variables">
          <label className="flow-node-field">
            <span className="flow-node-field-label">
              Minutes this takes by hand
              <span className="flow-node-hint-inline">used for the saved estimate</span>
            </span>
            <input
              className="flow-node-input"
              type="number"
              min={1}
              aria-label="Minutes this takes by hand"
              value={baseline ?? ''}
              placeholder="(not estimated)"
              onChange={(event) => patchBaseline(event.target.value)}
            />
          </label>
          <table className="flow-run-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Default value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.entries(variables).map(([name, value]) => (
                <tr key={name} data-variable={name}>
                  <td>
                    <input
                      className="flow-node-input"
                      aria-label={`Name of ${name}`}
                      defaultValue={name}
                      onBlur={(event) => renameVariableAndRefs(name, event.target.value.trim())}
                    />
                  </td>
                  <td>
                    <input
                      className="flow-node-input"
                      aria-label={`Value of ${name}`}
                      value={value}
                      onChange={(event) => setVariable(name, event.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="flow-node-field-toggle"
                      data-remove-variable={name}
                      onClick={() => removeVariable(name)}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="flow-toolbar-button"
            data-testid="flow-add-variable"
            onClick={() =>
              setVariable(
                uniqueNodeId('input', new Set(Object.keys(baseRef.current.variables))),
                ''
              )
            }
          >
            <span className="material-symbols-outlined">add</span>
            Add variable
          </button>
          <p className="flow-node-hint">
            Use a variable anywhere with <code>{'{{name}}'}</code>. Renaming one rewrites every
            reference to it.
          </p>
        </div>
      )}

      {run.pendingGate && (
        <div
          className="flow-gate"
          role="alertdialog"
          data-testid="flow-gate"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              run.pendingGate?.decide('approved', gateComment);
              setGateComment('');
            }
          }}
        >
          <div className="flow-gate-head">
            <span className="material-symbols-outlined">front_hand</span>
            <strong>{run.pendingGate.nodeId}</strong>
          </div>
          <Markdown text={run.pendingGate.message} />
          {/* The work being gated, so the decision is made looking at it
              rather than on faith. Direct parents' outputs, live. */}
          {gateContext(graphToFlow(baseRef.current, readGraph()), run.pendingGate.nodeId, run.liveNodes).map((entry) => (
            <details key={entry.nodeId} className="flow-gate-work" data-gate-work={entry.nodeId} open>
              <summary>{entry.label}</summary>
              <Markdown text={entry.output} />
            </details>
          ))}
          <textarea
            className="flow-node-input flow-gate-comment"
            data-testid="flow-gate-comment"
            aria-label="Note for this decision"
            placeholder="Optional note — a rejection reason travels to {{gate.error}}"
            value={gateComment}
            onChange={(event) => setGateComment(event.target.value)}
          />
          <div className="flow-gate-actions">
            <button
              type="button"
              className="flow-gate-reject"
              data-testid="flow-gate-reject"
              onClick={() => {
                run.pendingGate?.decide('rejected', gateComment);
                setGateComment('');
              }}
            >
              Reject
            </button>
            <button
              type="button"
              className="flow-gate-approve"
              data-testid="flow-gate-approve"
              title="Approve (Cmd+Enter)"
              onClick={() => {
                run.pendingGate?.decide('approved', gateComment);
                setGateComment('');
              }}
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {diffChild && diffChild.child.worktree && (
        <WorktreeDiffPanel
          child={diffChild.child}
          isWinner={winners[diffChild.parentId] === diffChild.child.label}
          onPick={() => setWinners((prev) => ({ ...prev, [diffChild.parentId]: diffChild.child.label }))}
          onClose={() => setDiffChild(null)}
        />
      )}

      {pendingRun && (
        <FlowRunGate
          summary={flowEffects(pendingRun, { shellAllowlist: SHELL_ALLOWLIST })}
          problems={analysis.issues}
          onApprove={() => {
            const flow = pendingRun;
            setPendingRun(null);
            void run.start(flow);
          }}
          onCancel={() => setPendingRun(null)}
          onPreview={() => {
            const flow = pendingRun;
            setPendingRun(null);
            void run.dryRun(flow); // rehearsal plays on the canvas; re-press Run to gate again
          }}
        />
      )}

      {run.runError && (
        <div className="flow-editor-invalid" role="alert" data-testid="flow-run-error">
          {run.runError}
        </div>
      )}

      {run.runState && (
        <div className="flow-run-panel" data-testid="flow-run-panel">
          <table className="flow-run-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Status</th>
                <th className="flow-run-number">Took</th>
                <th>Result</th>
                <th className="flow-run-number">Tokens</th>
                <th className="flow-run-number">Cost</th>
                <th>Session</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(run.runState.nodes).map((node) => (
                <tr key={node.nodeId} data-run-node={node.nodeId}>
                  <td>{node.nodeId}</td>
                  <td>
                    <span className={`flow-node-badge flow-node-badge-${node.status}`}>
                      {node.status}
                    </span>
                  </td>
                  <td className="flow-run-number">
                    {formatDuration(
                      node.startedAt !== undefined && node.finishedAt !== undefined
                        ? node.finishedAt - node.startedAt
                        : undefined
                    )}
                  </td>
                  <td className="flow-run-result" title={node.error ?? node.warning ?? node.output ?? ''}>
                    {node.error ? (
                      <span className="flow-run-failed">{previewOf(node.error)}</span>
                    ) : node.warning ? (
                      <span className="flow-run-warned" data-run-warning={node.nodeId}>
                        {node.warning}
                      </span>
                    ) : (
                      previewOf(node.output)
                    )}
                  </td>
                  <td className="flow-run-number">
                    {node.usage ? node.usage.inputTokens + node.usage.outputTokens : '—'}
                  </td>
                  <td className="flow-run-number">
                    {node.usage?.costUsd !== undefined ? `$${node.usage.costUsd.toFixed(4)}` : '—'}
                  </td>
                  {/* Selectable rather than a link: no host API can open a
                      session from an extension (see docs/editorhost-notes.md). */}
                  <td className="flow-run-session">{node.sessionId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Run total</td>
                <td />
                <td className="flow-run-number">
                  {run.runState.usage.inputTokens + run.runState.usage.outputTokens}
                </td>
                <td className="flow-run-number">
                  {run.runState.usage.costUsd !== undefined
                    ? `$${run.runState.usage.costUsd.toFixed(4)}`
                    : '—'}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {saveErrors && (
        <div className="flow-editor-invalid" role="alert" data-testid="flow-save-error">
          {saveErrors}
        </div>
      )}

      <div className="flow-canvas">
        {!isLoading && loaded && (
          <CatalogContext.Provider value={catalog}>
          <ReferencesContext.Provider value={analysis.references}>
          <NodeIssuesContext.Provider value={analysis.issues}>
          <NodeRunStoreContext.Provider value={runStore}>
          <RunFromContext.Provider value={runFrom}>
          <DisclosureContext.Provider value={disclosure}>
          <ReactFlow
            key={loaded.revision}
            defaultNodes={loaded.graph.nodes}
            defaultEdges={loaded.graph.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onEdgeClick={onEdgeClick}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onConnectEnd={onConnectEnd}
            onBeforeDelete={onBeforeDelete}
            deleteKeyCode={['Backspace', 'Delete']}
            // A wider radius lets a wire snap to a port without pixel-perfect
            // aim; snapping to a 16px grid keeps hand-dragged nodes aligned.
            connectionRadius={30}
            snapToGrid
            snapGrid={[16, 16]}
            proOptions={{ hideAttribution: false }}
            onMoveEnd={onMoveEnd}
            // A saved viewport wins; only a flow opened for the first time gets
            // the auto-fit, so reopening lands where you left off.
            defaultViewport={storedView.viewport}
            fitView={!storedView.viewport}
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          >
            {/* Explicit rather than default: the stock dot colour is a fixed
                grey that all but disappears on a light brand surface. */}
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.6} />
            <Controls />
            {/* Typed so the map carries the same colour key as the canvas;
                the colours themselves stay in CSS, next to the node rules. */}
            {showMinimap && <MiniMap
              pannable
              zoomable
              nodeClassName={(node) => `flow-minimap-node flow-minimap-${node.type}`}
            />}
            <SubAgentLayer
              subAgents={run.children}
              onOpenSession={showSession}
              onInspectDiff={(parentId, child) => setDiffChild({ parentId, child })}
              winners={winners}
            />
          </ReactFlow>
          </DisclosureContext.Provider>
          {isEmpty && (
            <div className="flow-empty" data-testid="flow-empty">
              <h2 className="flow-empty-title">Start from a shape that already works</h2>
              <p className="flow-empty-subtitle">
                Every template is wired and valid — edit it rather than starting from a blank grid.
              </p>
              <div className="flow-template-grid">
                {FLOW_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="flow-template-card"
                    data-template={template.id}
                    onClick={() => useTemplate(template)}
                  >
                    <span className="material-symbols-outlined flow-template-icon">
                      {template.icon}
                    </span>
                    <span className="flow-template-title">{template.title}</span>
                    <span className="flow-template-desc">{template.description}</span>
                  </button>
                ))}
              </div>
              <div className="flow-draft" data-testid="flow-draft">
                <p className="flow-empty-subtitle">…or describe it, and let the agent draw it:</p>
                <form
                  className="flow-draft-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const input = (event.target as HTMLFormElement).elements.namedItem(
                      'description'
                    ) as HTMLTextAreaElement;
                    const description = input.value.trim();
                    if (description === '' || aiBusy) return;
                    void runDraft(() => draftFlow(getHostServices().ai!, description));
                  }}
                >
                  <textarea
                    className="flow-node-input"
                    name="description"
                    rows={2}
                    disabled={aiBusy}
                    placeholder="Nightly: collect the git log, draft release notes, hold them for my approval, save to RELEASE_NOTES.md"
                    aria-label="Describe the flow"
                  />
                  <button type="submit" className="flow-toolbar-button" disabled={aiBusy} data-testid="flow-draft-go">
                    <span className="material-symbols-outlined" aria-hidden="true">
                      auto_awesome
                    </span>
                    {aiBusy ? 'Drafting…' : 'Draft it'}
                  </button>
                </form>
                {aiError && (
                  <p className="flow-editor-invalid" role="alert" data-testid="flow-draft-error">
                    {aiError}
                  </p>
                )}
              </div>
              <p className="flow-empty-footnote">
                …or use the buttons above to place a node yourself.
              </p>
            </div>
          )}
          </RunFromContext.Provider>
          </NodeRunStoreContext.Provider>
          </NodeIssuesContext.Provider>
          </ReferencesContext.Provider>
          </CatalogContext.Provider>
        )}
      </div>
    </div>
  );
}

/**
 * What a flow that will not open looks like.
 *
 * Two things the previous screen got wrong: it showed one problem at a time,
 * so repairing a flow meant a reload per mistake; and it was a dead end, with
 * the file right there and no way to touch it. The editor declares
 * `supportsSourceMode`, so the way out is one call away.
 */
function FlowLoadError({
  error,
  onEditAsText,
}: {
  error: Error;
  onEditAsText?: () => void;
}) {
  const problems = flowErrorsOf(error);

  return (
    <div className="flow-editor-error" role="alert" data-testid="flow-load-error">
      <span className="material-symbols-outlined" aria-hidden="true">
        error
      </span>
      <div className="flow-editor-error-body">
        <strong>
          {problems && problems.length > 1
            ? `This flow has ${problems.length} problems to fix.`
            : 'This flow could not be opened.'}
        </strong>

        {problems ? (
          <ul className="flow-editor-error-list">
            {problems.map((problem) => (
              <li key={`${problem.path}:${problem.message}`}>
                {problem.path && <code>{problem.path}</code>}
                <span>{problem.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{error.message}</p>
        )}

        {onEditAsText && (
          <button
            type="button"
            className="flow-toolbar-button"
            data-testid="flow-edit-as-text"
            onClick={onEditAsText}
          >
            Edit as text
          </button>
        )}
      </div>
    </div>
  );
}

/** `agent`, `agent-2`, `agent-3`… so ids stay readable and unique. */
function nextNodeId(type: NodeType, taken: Set<string>): string {
  if (!taken.has(type)) return type;
  for (let n = 2; ; n++) {
    const candidate = `${type}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
