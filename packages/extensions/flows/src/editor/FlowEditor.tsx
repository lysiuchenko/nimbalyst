import { useEditorLifecycle, type EditorHost, type EditorHostProps } from '@nimbalyst/extension-sdk';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { CatalogContext, EMPTY_CATALOG, NodeIssuesContext, ReferencesContext } from './catalogContext';
import { issuesByNode, referencesByNode } from './references';
import { loadCatalog, type Catalog } from '../host/catalog';
import { getHostServices } from '../host/hostServices';
import { RunStatusContext } from './runContext';
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
  const { getNodes, getEdges, addNodes, fitView, screenToFlowPosition } = useReactFlow<
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

  const readGraph = useCallback(
    () => ({ nodes: getNodes(), edges: getEdges() }),
    [getEdges, getNodes]
  );

  const refreshAnalysis = useCallback(() => {
    const candidate = graphToFlow(baseRef.current, readGraph());
    setAnalysis({ references: referencesByNode(candidate), issues: issuesByNode(candidate) });
  }, [readGraph]);

  const applyContent = useCallback((flow: Flow) => {
    baseRef.current = flow;
    setLoaded((previous) => ({
      graph: flowToGraph(flow),
      revision: (previous?.revision ?? 0) + 1,
    }));
    setSaveErrors(null);
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
      if (changes.some(isUserChange)) markDirty();
      refreshAnalysis();
    },
    [markDirty, refreshAnalysis]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowCanvasEdge>[]) => {
      if (changes.some(isUserChange)) markDirty();
      refreshAnalysis();
    },
    [markDirty, refreshAnalysis]
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
    [addNodes, getNodes, markDirty, refreshAnalysis, screenToFlowPosition]
  );

  useEffect(() => {
    const services = getHostServices();
    const workspace = host.filePath.slice(0, Math.max(host.filePath.lastIndexOf('/'), 0));
    const ipc = (window as unknown as { electronAPI?: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } })
      .electronAPI;
    if (!ipc || !services.ai) return;

    let cancelled = false;
    void loadCatalog(ipc, services.ai, host.workspaceId ?? workspace).then((next) => {
      if (!cancelled) setCatalog(next);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);

  const nodeTypes = useMemo(() => createNodeTypes(markDirty), [markDirty]);
  const run = useFlowRun(host);

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
    <div className="flow-editor" data-testid="flow-editor">
      <div className="flow-toolbar">
        {NODE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className="flow-toolbar-button"
            data-add-node={type}
            onClick={() => addNodeOfType(type)}
          >
            <span className="material-symbols-outlined">{NODE_TYPE_ICONS[type]}</span>
            {NODE_TYPE_LABELS[type]}
          </button>
        ))}
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
                <td colSpan={2}>Run total</td>
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
          <RunStatusContext.Provider value={run.statuses}>
          <ReactFlow
            key={loaded.revision}
            defaultNodes={loaded.graph.nodes}
            defaultEdges={loaded.graph.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: false }}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          </RunStatusContext.Provider>
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
