import { useEditorLifecycle, type EditorHost, type EditorHostProps } from '@nimbalyst/extension-sdk';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
} from '@xyflow/react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NODE_TYPES, type Flow, type NodeType } from '../schema/types';
import { parseFlowFile } from '../schema/validate';
import {
  flowToGraph,
  graphToFlow,
  placeNewNode,
  type FlowCanvasEdge,
  type FlowCanvasNode,
  type FlowGraph,
} from './flowGraph';
import { createNode, createNodeTypes, NODE_TYPE_ICONS, NODE_TYPE_LABELS } from './nodes/nodeTypes';
import { formatDuration, previewOf } from './nodes/entryFilter';
import { applyTemplate, FLOW_TEMPLATES, type FlowTemplate } from './templates';
import { FLOW_THEMES, nextTheme, readTheme, THEME_STORAGE_KEY, type FlowThemeId } from './theme';
import { duplicateNode, renameVariable, uniqueNodeId, validVariableName } from './canvasActions';
import { createHistory } from './history';
import { loadRunHistory } from './runHistory';
import { deleteRunRecord } from './deleteRunRecord';
import type { HostIpc } from '../host/nimbalystSessionHost';
import { WEEKDAYS, type FlowSchedule } from '../schedule/types';
import { scheduleLabel } from '../schedule/label';
import { displayStatus, historySummary, relativeWhen, runOutcome, tokensLabel } from './runSummary';
import type { RunRecord } from '../runner/runStore';
import { CatalogContext, EMPTY_CATALOG, NodeIssuesContext, ReferencesContext } from './catalogContext';
import { SubAgentLayer } from './SubAgentLayer';
import { issuesByNode, referencesByNode } from './references';
import { loadCatalog, type Catalog } from '../host/catalog';
import { scanWorkspaceCatalog } from '../host/workspaceScan';
import { getHostServices } from '../host/hostServices';
import { NodeChildrenContext, RunStatusContext } from './runContext';
import { prepareSave } from './saveFlow';
import { useFlowRun } from './useFlowRun';

const EMPTY_FLOW: Flow = { version: 1, name: 'untitled', nodes: [], edges: [], variables: {} };

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
  const { getNodes, getEdges, addNodes, addEdges, setNodes, setEdges, fitView, screenToFlowPosition } = useReactFlow<
    FlowCanvasNode,
    FlowCanvasEdge
  >();

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
    parse: (raw) => {
      const parsed = parseFlowFile(raw.trim() === '' ? JSON.stringify(EMPTY_FLOW) : raw);
      if (!parsed.valid) {
        const [first] = parsed.errors;
        throw new Error(first.path ? `${first.path}: ${first.message}` : first.message);
      }
      return parsed.flow;
    },
    applyContent,
    getCurrentContent: () => graphToFlow(baseRef.current, readGraph()),
    onSave,
    onLoaded: () => {
      fitView({ padding: 0.2, maxZoom: 1 });
      refreshAnalysis();
    },
  });

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

  // Run what is on the canvas, not what is on disk, but refuse to run something
  // that would not survive a save.
  const startRun = useCallback(() => {
    const prepared = prepareSave(baseRef.current, readGraph());
    if (!prepared.ok) {
      setSaveErrors(prepared.summary.replace('was not saved', 'cannot be run'));
      return;
    }
    setSaveErrors(null);
    void run.start(prepared.flow);
  }, [readGraph, run]);

  if (error) {
    return (
      <div className="flow-editor-error" role="alert">
        <span className="material-symbols-outlined">error</span>
        <div>
          <strong>This flow could not be opened.</strong>
          <p>{error.message}</p>
        </div>
      </div>
    );
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
        <button
          type="button"
          className="flow-toolbar-run"
          data-testid="flow-run"
          onClick={run.isRunning ? run.cancel : startRun}
        >
          <span className="material-symbols-outlined">{run.isRunning ? 'stop' : 'play_arrow'}</span>
          {run.isRunning ? 'Cancel' : 'Run'}
        </button>
      </div>

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
                                  {node.error && <em>{node.error}</em>}
                                  {!node.error && node.warning && (
                                    <em className="flow-run-warned">{node.warning}</em>
                                  )}
                                </li>
                              ))}
                            </ul>
                            <p className="flow-run-detail-id">{record.runId}</p>
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
        </div>
      )}

      {showVariables && (
        <div className="flow-variables" data-testid="flow-variables">
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
        <div className="flow-gate" role="alertdialog" data-testid="flow-gate">
          <span className="material-symbols-outlined">front_hand</span>
          <div className="flow-gate-body">
            <strong>{run.pendingGate.nodeId}</strong>
            <p>{run.pendingGate.message}</p>
          </div>
          <button
            type="button"
            className="flow-gate-approve"
            data-testid="flow-gate-approve"
            onClick={() => run.pendingGate?.decide('approved')}
          >
            Approve
          </button>
          <button
            type="button"
            className="flow-gate-reject"
            data-testid="flow-gate-reject"
            onClick={() => run.pendingGate?.decide('rejected')}
          >
            Reject
          </button>
        </div>
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
          <NodeChildrenContext.Provider value={run.children}>
          <RunStatusContext.Provider value={run.statuses}>
          <ReactFlow
            key={loaded.revision}
            defaultNodes={loaded.graph.nodes}
            defaultEdges={loaded.graph.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: false }}
            fitView
          >
            {/* Explicit rather than default: the stock dot colour is a fixed
                grey that all but disappears on a light brand surface. */}
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.6} />
            <Controls />
            <MiniMap pannable zoomable />
            <SubAgentLayer subAgents={run.children} />
          </ReactFlow>
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
              <p className="flow-empty-footnote">
                …or use the buttons above to place a node yourself.
              </p>
            </div>
          )}
          </RunStatusContext.Provider>
          </NodeChildrenContext.Provider>
          </NodeIssuesContext.Provider>
          </ReferencesContext.Provider>
          </CatalogContext.Provider>
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
