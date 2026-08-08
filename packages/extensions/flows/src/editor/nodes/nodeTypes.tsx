import { Handle, Position, useReactFlow, type NodeProps, type NodeTypes } from '@xyflow/react';
import { useCallback } from 'react';
import type { AgentNode, FlowNode, NodeType } from '../../schema/types';
import { useCatalog, useNodeIssues, useReferences } from '../catalogContext';
import type { FlowCanvasNode, FlowNodeData } from '../flowGraph';
import { useNodeStatus } from '../runContext';
import { CatalogPicker, ReferenceChips, ToolPicker } from './NodeFields';

/** How each node type presents its one essential field. */
interface NodeChrome {
  icon: string;
  field: string;
  fieldLabel: string;
  placeholder: string;
  /** `text` = free prose, `pick` = choose from the workspace catalog. */
  input: 'text' | 'textarea' | 'pick';
  /** Which catalog list a `pick` field draws from. */
  catalog?: 'skills' | 'commands';
  hint: string;
}

const CHROME: Record<NodeType, NodeChrome> = {
  agent: {
    icon: 'smart_toy',
    field: 'prompt',
    fieldLabel: 'Prompt',
    placeholder: 'What should the agent do?',
    input: 'textarea',
    hint: 'Runs as its own session.',
  },
  'slash-command': {
    icon: 'terminal',
    field: 'command',
    fieldLabel: 'Command',
    placeholder: '/review',
    input: 'pick',
    catalog: 'commands',
    hint: 'No commands found in .claude/commands.',
  },
  skill: {
    icon: 'auto_awesome',
    field: 'skill',
    fieldLabel: 'Skill',
    placeholder: 'brainstorming',
    input: 'pick',
    catalog: 'skills',
    hint: 'No skills found in .claude/skills or .agents/skills.',
  },
  'human-gate': {
    icon: 'front_hand',
    field: 'message',
    fieldLabel: 'Message',
    placeholder: 'Approve to continue?',
    input: 'textarea',
    hint: 'Holds this branch until someone decides.',
  },
  shell: {
    icon: 'code',
    field: 'run',
    fieldLabel: 'Run',
    placeholder: 'npm test',
    input: 'text',
    hint: 'One allowlisted command. No pipes or chaining.',
  },
};

interface FlowNodeCardProps extends NodeProps<FlowCanvasNode> {
  chrome: NodeChrome;
  onEdited: () => void;
}

function FlowNodeCard({ id, data, selected, chrome, onEdited }: FlowNodeCardProps) {
  const { updateNodeData } = useReactFlow<FlowCanvasNode>();
  const node = data.node;
  const status = useNodeStatus(id);
  const catalog = useCatalog();
  const references = useReferences(id);
  const issues = useNodeIssues(id);

  const patch = useCallback(
    (changes: Record<string, unknown>) => {
      updateNodeData(id, { node: { ...node, ...changes } as FlowNode });
      onEdited();
    },
    [id, node, onEdited, updateNodeData]
  );

  const fields = node as unknown as Record<string, unknown>;
  const fieldValue = String(fields[chrome.field] ?? '');
  const agent = node.type === 'agent' ? (node as AgentNode) : undefined;

  return (
    <div
      className={`flow-node flow-node-${node.type}${selected ? ' flow-node-selected' : ''}${
        issues.length > 0 ? ' flow-node-invalid' : ''
      }`}
      data-node-id={id}
      data-node-type={node.type}
      data-node-status={status ?? ''}
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
        {status ? (
          <span className={`flow-node-badge flow-node-badge-${status}`}>{status}</span>
        ) : (
          <span className="flow-node-type">{node.type}</span>
        )}
      </header>

      {chrome.input === 'pick' ? (
        <CatalogPicker
          label={chrome.fieldLabel}
          value={fieldValue}
          entries={chrome.catalog === 'skills' ? catalog.skills : catalog.commands}
          placeholder={chrome.placeholder}
          emptyHint={chrome.hint}
          onChange={(value) => patch({ [chrome.field]: value })}
        />
      ) : (
        <label className="flow-node-field">
          <span className="flow-node-field-label">{chrome.fieldLabel}</span>
          {chrome.input === 'textarea' ? (
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
      )}

      {node.type === 'slash-command' && (
        <label className="flow-node-field">
          <span className="flow-node-field-label">Arguments</span>
          <input
            className="flow-node-input"
            aria-label="Arguments"
            value={String(fields.args ?? '')}
            placeholder="(none)"
            onChange={(event) => patch({ args: event.target.value || undefined })}
          />
        </label>
      )}

      {agent && (
        <>
          <label className="flow-node-field">
            <span className="flow-node-field-label">Model</span>
            <select
              className="flow-node-input"
              aria-label="Model"
              value={agent.model ?? ''}
              onChange={(event) => patch({ model: event.target.value || null })}
            >
              <option value="">Host default</option>
              {catalog.models.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <ToolPicker
            value={agent.tools}
            choices={catalog.tools}
            onChange={(tools) => patch({ tools })}
          />
        </>
      )}

      <ReferenceChips
        references={references}
        onInsert={(token) => patch({ [chrome.field]: `${fieldValue}${token}` })}
      />

      <label className="flow-node-field">
        <span className="flow-node-field-label">Output port</span>
        <input
          className="flow-node-input"
          aria-label="Output port"
          value={node.output ?? ''}
          placeholder="(none — downstream nodes get no data)"
          onChange={(event) => patch({ output: event.target.value || undefined })}
        />
      </label>

      {issues.length > 0 && (
        <ul className="flow-node-issues" data-testid={`flow-node-issues-${id}`}>
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

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
