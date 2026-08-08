import { Handle, Position, useReactFlow, type NodeProps, type NodeTypes } from '@xyflow/react';
import { useCallback } from 'react';
import type { FlowNode, NodeType } from '../../schema/types';
import type { FlowCanvasNode, FlowNodeData } from '../flowGraph';

/** What each node type shows and lets the user edit on the canvas. */
interface NodeChrome {
  icon: string;
  /** The one field this node type cannot do without. */
  field: string;
  fieldLabel: string;
  placeholder: string;
  /** Multi-line editor for prose-shaped fields. */
  multiline: boolean;
}

const CHROME: Record<NodeType, NodeChrome> = {
  agent: {
    icon: 'smart_toy',
    field: 'prompt',
    fieldLabel: 'Prompt',
    placeholder: 'What should the agent do?',
    multiline: true,
  },
  'slash-command': {
    icon: 'terminal',
    field: 'command',
    fieldLabel: 'Command',
    placeholder: '/review',
    multiline: false,
  },
  skill: {
    icon: 'auto_awesome',
    field: 'skill',
    fieldLabel: 'Skill',
    placeholder: 'brainstorming',
    multiline: false,
  },
  shell: {
    icon: 'code',
    field: 'run',
    fieldLabel: 'Run',
    placeholder: 'npm test',
    multiline: false,
  },
  'human-gate': {
    icon: 'front_hand',
    field: 'message',
    fieldLabel: 'Message',
    placeholder: 'Approve to continue?',
    multiline: true,
  },
};

interface FlowNodeCardProps extends NodeProps<FlowCanvasNode> {
  chrome: NodeChrome;
  onEdited: () => void;
}

function FlowNodeCard({ id, data, selected, chrome, onEdited }: FlowNodeCardProps) {
  const { updateNodeData } = useReactFlow<FlowCanvasNode>();
  const node = data.node;

  const patch = useCallback(
    (changes: Partial<Record<string, unknown>>) => {
      updateNodeData(id, { node: { ...node, ...changes } as FlowNode });
      onEdited();
    },
    [id, node, onEdited, updateNodeData]
  );

  const fieldValue = String((node as unknown as Record<string, unknown>)[chrome.field] ?? '');

  return (
    <div
      className={`flow-node flow-node-${node.type}${selected ? ' flow-node-selected' : ''}`}
      data-node-id={id}
      data-node-type={node.type}
    >
      <Handle type="target" position={Position.Left} className="flow-node-handle" />

      <header className="flow-node-header">
        <span className="flow-node-icon material-symbols-outlined">{chrome.icon}</span>
        <input
          className="flow-node-label"
          aria-label="Node label"
          value={node.label ?? ''}
          placeholder={id}
          onChange={(event) => patch({ label: event.target.value || undefined })}
        />
        <span className="flow-node-type">{node.type}</span>
      </header>

      <label className="flow-node-field">
        <span className="flow-node-field-label">{chrome.fieldLabel}</span>
        {chrome.multiline ? (
          <textarea
            className="flow-node-input"
            aria-label={chrome.fieldLabel}
            rows={3}
            value={fieldValue}
            placeholder={chrome.placeholder}
            onChange={(event) => patch({ [chrome.field]: event.target.value })}
          />
        ) : (
          <input
            className="flow-node-input"
            aria-label={chrome.fieldLabel}
            value={fieldValue}
            placeholder={chrome.placeholder}
            onChange={(event) => patch({ [chrome.field]: event.target.value })}
          />
        )}
      </label>

      <label className="flow-node-field">
        <span className="flow-node-field-label">Output port</span>
        <input
          className="flow-node-input"
          aria-label="Output port"
          value={node.output ?? ''}
          placeholder="(none)"
          onChange={(event) => patch({ output: event.target.value || undefined })}
        />
      </label>

      <Handle type="source" position={Position.Right} className="flow-node-handle" />
    </div>
  );
}

/**
 * One component per node type, as the host's node registry expects. They share
 * a card body and differ in icon, primary field, and editing affordance.
 */
export function createNodeTypes(onEdited: () => void): NodeTypes {
  const entries = (Object.keys(CHROME) as NodeType[]).map((type) => {
    const chrome = CHROME[type];
    const Component = (props: NodeProps<FlowCanvasNode>) => (
      <FlowNodeCard {...props} chrome={chrome} onEdited={onEdited} />
    );
    Component.displayName = `${type}Node`;
    return [type, Component];
  });

  return Object.fromEntries(entries) as NodeTypes;
}

/** A fresh node of `type`, ready to drop on the canvas. */
export function createNode(type: NodeType, id: string): FlowNodeData['node'] {
  const base = { id, type } as Record<string, unknown>;
  base[CHROME[type].field] = '';
  return base as unknown as FlowNode;
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  agent: 'Agent',
  'slash-command': 'Slash command',
  skill: 'Skill',
  shell: 'Shell',
  'human-gate': 'Human gate',
};

export const NODE_TYPE_ICONS: Record<NodeType, string> = Object.fromEntries(
  (Object.keys(CHROME) as NodeType[]).map((type) => [type, CHROME[type].icon])
) as Record<NodeType, string>;
