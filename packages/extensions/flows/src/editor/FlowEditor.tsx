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
import { useCallback, useMemo, useRef, useState } from 'react';
import { NODE_TYPES, type Flow, type NodeType } from '../schema/types';
import { parseFlowFile } from '../schema/validate';
import {
  flowToGraph,
  graphToFlow,
  type FlowCanvasEdge,
  type FlowCanvasNode,
  type FlowGraph,
} from './flowGraph';
import { createNode, createNodeTypes, NODE_TYPE_ICONS, NODE_TYPE_LABELS } from './nodes/nodeTypes';
import { prepareSave } from './saveFlow';

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
  const { getNodes, getEdges, addNodes, fitView } = useReactFlow<
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

  const readGraph = useCallback(
    () => ({ nodes: getNodes(), edges: getEdges() }),
    [getEdges, getNodes]
  );

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
    onLoaded: () => fitView({ padding: 0.2, maxZoom: 1 }),
  });

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowCanvasNode>[]) => {
      if (changes.some(isUserChange)) markDirty();
    },
    [markDirty]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowCanvasEdge>[]) => {
      if (changes.some(isUserChange)) markDirty();
    },
    [markDirty]
  );

  // The canvas is uncontrolled, so xyflow adds the edge to its own store; this
  // only records that the document changed. Adding it here as well would write
  // the connection to the file twice.
  const onConnect = useCallback((_connection: Connection) => markDirty(), [markDirty]);

  const addNodeOfType = useCallback(
    (type: NodeType) => {
      const existing = getNodes();
      const id = nextNodeId(type, new Set(existing.map((node) => node.id)));
      addNodes({
        id,
        type,
        position: { x: 60 + existing.length * 40, y: 60 + existing.length * 30 },
        data: { node: createNode(type, id) },
      });
      markDirty();
    },
    [addNodes, getNodes, markDirty]
  );

  const nodeTypes = useMemo(() => createNodeTypes(markDirty), [markDirty]);

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
        <span className="flow-toolbar-status" data-dirty={isDirty}>
          {isDirty ? 'Unsaved changes' : 'Saved'}
        </span>
      </div>

      {saveErrors && (
        <div className="flow-editor-invalid" role="alert" data-testid="flow-save-error">
          {saveErrors}
        </div>
      )}

      <div className="flow-canvas">
        {!isLoading && loaded && (
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
