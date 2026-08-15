import { Handle, Position, useReactFlow, type NodeProps, type NodeTypes } from '@xyflow/react';
import { useCallback, useState } from 'react';
import type { AgentNode, FanOutNode, FlowNode, NodeType, WriteFileNode } from '../../schema/types';
import { useCatalog, useNodeIssues, useReferences } from '../catalogContext';
import { useNodeChildren } from '../runContext';
import type { FlowCanvasNode, FlowNodeData } from '../flowGraph';
import { useLiveTail, useNodeReliability, useNodeResult, useNodeStatus, useRunFrom } from '../runContext';
import { CatalogPicker, ReferenceChips, RefField, ToolPicker } from './NodeFields';
import { modelOptionsForProvider } from './agentModels';
import { configBadges, summarize } from './summarize';

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
  'fan-out': {
    icon: 'hub',
    field: 'prompt',
    fieldLabel: 'Prompt for each item',
    placeholder: 'Review {{item}}',
    input: 'textarea',
    hint: 'One sub-agent per item, running at the same time.',
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
  'write-file': {
    icon: 'save',
    // The path leads: it is what the node is *for*, and the content is usually
    // a single `{{reference}}` carried in from the step before.
    field: 'path',
    fieldLabel: 'Save to',
    placeholder: 'RELEASE_NOTES.md',
    input: 'text',
    hint: 'A path inside this workspace.',
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
  onDuplicate: (id: string) => void;
}

function FlowNodeCard({ id, data, selected, chrome, onEdited, onDuplicate }: FlowNodeCardProps) {
  const { updateNodeData } = useReactFlow<FlowCanvasNode>();
  const node = data.node;
  const status = useNodeStatus(id);
  const result = useNodeResult(id);
  const onRunFrom = useRunFrom();
  const reliability = useNodeReliability(id);
  const liveTail = useLiveTail(id);
  const [resultOpen, setResultOpen] = useState(false);
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
  const fanOut = node.type === 'fan-out' ? (node as FanOutNode) : undefined;
  const writeFile = node.type === 'write-file' ? (node as WriteFileNode) : undefined;
  const children = useNodeChildren(id);
  const badges = configBadges(node);

  // Open on its own only when there is nothing to read: a node just dropped on
  // the canvas is unfinished, and asking for one more click before typing is
  // friction. A node loaded from a file starts closed, however deep its
  // configuration, because the canvas is there to be read first.
  const [open, setOpen] = useState(() => fieldValue.trim() === '');
  // Kept beside `open` rather than left to the <details> element: closing the
  // node unmounts it, and an author who opened Advanced should find it open
  // when they come back to the same node.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div
      className={`flow-node flow-node-${node.type}${selected ? ' flow-node-selected' : ''}${
        issues.length > 0 ? ' flow-node-invalid' : ''
      }`}
      data-node-id={id}
      data-node-type={node.type}
      data-node-status={status ?? ''}
    >
      {/* Two targets and two sources: a flow laid out top-down would otherwise
          route every edge out to the right and back, because the only ports
          were on the sides. */}
      <Handle type="target" position={Position.Left} id="left" className="flow-node-handle" />
      <Handle type="target" position={Position.Top} id="top" className="flow-node-handle flow-node-handle-vertical" />

      <header className="flow-node-header" onDoubleClick={() => setOpen((wasOpen) => !wasOpen)}>
        <span className="flow-node-icon material-symbols-outlined">{chrome.icon}</span>
        {/* A name is content, not configuration, but an always-editable input
            makes a card look like a form. Read as text, edit once opened. */}
        {open ? (
          <input
            className="flow-node-label"
            aria-label="Node label"
            value={node.label ?? ''}
            placeholder={id}
            onChange={(event) => patch({ label: event.target.value || undefined })}
          />
        ) : (
          <span className="flow-node-label flow-node-label-static">{node.label ?? id}</span>
        )}
        {/* The type is already carried by the icon and, closed, by the summary
            sentence — spelling it out again costs the label the room it needs. */}
        {status ? (
          <span className={`flow-node-badge flow-node-badge-${status}`}>{status}</span>
        ) : (
          open && <span className="flow-node-type">{node.type}</span>
        )}
        {/* Worn only by a step with a recorded failure: the chip is signal,
            not decoration — a clean node stays clean-looking. */}
        {reliability && reliability.total >= 2 && reliability.ok < reliability.total && (
          <span
            className="flow-node-reliability"
            data-reliability={id}
            title={`succeeded ${reliability.ok} of ${reliability.total} recent runs`}
          >
            {reliability.ok}/{reliability.total}
          </span>
        )}
        <button
          type="button"
          className="flow-node-expand"
          data-expand={id}
          aria-expanded={open}
          title={open ? 'Close this step' : 'Open this step'}
          aria-label={`${open ? 'Close' : 'Open'} ${node.label ?? id}`}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          <span className="material-symbols-outlined">
            {open ? 'expand_more' : 'chevron_right'}
          </span>
        </button>
        {onRunFrom && (
          <button
            type="button"
            className="flow-node-duplicate flow-node-runfrom"
            data-run-from={id}
            title="Run from this step — everything above is reused from the last run"
            aria-label={`Run from ${node.label ?? id}`}
            onClick={() => onRunFrom(id)}
          >
            <span className="material-symbols-outlined">resume</span>
          </button>
        )}
        <button
          type="button"
          className="flow-node-duplicate"
          data-duplicate={id}
          title="Duplicate this node"
          aria-label={`Duplicate ${node.label ?? id}`}
          onClick={() => onDuplicate(id)}
        >
          <span className="material-symbols-outlined">content_copy</span>
        </button>
      </header>

      {/* The heartbeat: what the running agent is doing right now. */}
      {status === 'running' && liveTail && (
        <p className="flow-node-live" data-live-tail={id} title={liveTail}>
          {liveTail}
        </p>
      )}

      {/* A failure answers "so what now?" on the spot rather than dead-ending. */}
      {status === 'failed' && (
        <div className="flow-node-failure-actions">
          {onRunFrom && (
            <button
              type="button"
              className="flow-toolbar-button"
              data-node-retry={id}
              title="Re-run this step and everything below it; upstream is reused"
              onClick={() => onRunFrom(id)}
            >
              Retry step
            </button>
          )}
          <button
            type="button"
            className="flow-toolbar-button"
            data-node-edit={id}
            onClick={() => setOpen(true)}
          >
            Edit step
          </button>
        </div>
      )}

      {/* Closed, a node is something to read: what this step does, plus the
          settings someone chose. Opening it is what asks for the editor. */}
      {!open && (
        <div className="flow-node-summary" data-testid={`flow-summary-${id}`}>
          <p className="flow-node-summary-text">{summarize(node)}</p>
          {badges.length > 0 && (
            <div className="flow-node-badges">
              {badges.map((badge) => (
                <span key={badge.label} className="flow-node-badge-config" title={badge.title}>
                  {badge.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* What the step produced, the moment it produced it. Clamped to two
          lines; a click swaps clamp for scroll. Errors take the same strip so
          a failure is readable where it happened, not only in the history. */}
      {result && (result.output || result.error) && (
        <button
          type="button"
          className="flow-node-result"
          data-node-result={id}
          data-kind={result.error ? 'error' : 'output'}
          data-expanded={resultOpen}
          title={resultOpen ? 'Collapse' : 'Expand'}
          onClick={(event) => {
            event.stopPropagation();
            setResultOpen((was) => !was);
          }}
        >
          <pre>{result.error ?? result.output}</pre>
        </button>
      )}

      {open && (
        <div className="flow-node-body">
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
        <RefField
          label={chrome.fieldLabel}
          value={fieldValue}
          references={references}
          placeholder={chrome.placeholder}
          multiline={chrome.input === 'textarea'}
          onChange={(value) => patch({ [chrome.field]: value })}
        />
      )}

      {writeFile && (
        // A textarea because the content is a document: an input would strip
        // the newlines out of whatever the previous step produced.
        <RefField
          label="Content"
          value={writeFile.content ?? ''}
          references={references}
          placeholder="{{draft.notes}}"
          hint="usually a reference"
          multiline
          onChange={(value) => patch({ content: value })}
        />
      )}

      {fanOut && (
        <>
          {/* A textarea, not an input: the list is one item per line and an
              input silently strips the newlines that separate them. */}
          <RefField
            label="Fan out over"
            value={fanOut.over ?? ''}
            references={references}
            placeholder="{{list.files}}"
            hint="one item per line"
            multiline
            rows={2}
            onChange={(value) => patch({ over: value })}
          />
          <label className="flow-node-field">
            <span className="flow-node-field-label">At once</span>
            <input
              className="flow-node-input"
              type="number"
              min={1}
              aria-label="At once"
              value={fanOut.concurrency ?? ''}
              placeholder="4"
              onChange={(event) =>
                patch({ concurrency: event.target.value ? Number(event.target.value) : undefined })
              }
            />
          </label>
          {/* The sub-agents themselves are drawn on the canvas by SubAgentLayer;
              the node only keeps the tally, so the two never disagree. */}
          {children.length > 0 && (
            <div className="flow-node-field" data-testid={`flow-children-${id}`}>
              <span className="flow-node-field-label">
                Sub-agents ({children.filter((c) => c.status === 'done').length}/{children.length})
              </span>
            </div>
          )}
        </>
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

      <ReferenceChips
        references={references}
        onInsert={(token) => patch({ [chrome.field]: `${fieldValue}${token}` })}
      />

      {/* Everything below decides how the step runs rather than what it does.
          Folded away by default: someone reading or writing a flow needs the
          work described first, and defaults are right for most nodes. */}
      <details
        className="flow-node-advanced"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary>Advanced</summary>

        {/* Only meaningful with several incoming edges, but always settable:
            wiring order should not dictate configuration order. */}
        <label className="flow-node-toggle">
          <input
            type="checkbox"
            aria-label="Run on the first arriving branch"
            checked={node.join === 'any'}
            onChange={(event) => patch({ join: event.target.checked ? 'any' : undefined })}
          />
          <span>Run on the first arriving branch (any-join)</span>
        </label>

        {node.type !== 'human-gate' && (
          <label className="flow-node-field">
            <span className="flow-node-field-label">
              Retries
              <span className="flow-node-hint-inline">extra attempts on failure</span>
            </span>
            <input
              className="flow-node-input"
              aria-label="Retries"
              type="number"
              min={1}
              max={5}
              value={node.retries ?? ''}
              placeholder="none"
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                patch({ retries: Number.isNaN(parsed) ? undefined : Math.min(5, Math.max(1, parsed)) });
              }}
            />
          </label>
        )}

        {(agent || fanOut) && (
          <>
            <label className="flow-node-field">
              <span className="flow-node-field-label">Provider</span>
              <select
                className="flow-node-input"
                aria-label="Provider"
                value={(agent ?? fanOut)?.provider ?? ''}
                onChange={(event) =>
                  // Clear the model too: each provider offers its own list, so a
                  // claude-code:* id must not linger on a node switched to Codex.
                  patch({ provider: event.target.value === '' ? undefined : event.target.value, model: null })
                }
              >
                <option value="">Claude Code (default)</option>
                <option value="openai-codex">OpenAI Codex — no tool allowlist</option>
                <option value="copilot-cli">GitHub Copilot CLI — no tool allowlist</option>
              </select>
            </label>
            <label className="flow-node-field">
              <span className="flow-node-field-label">Model</span>
              <select
                className="flow-node-input"
                aria-label="Model"
                value={(agent ?? fanOut)?.model ?? ''}
                onChange={(event) => patch({ model: event.target.value || null })}
              >
                <option value="">Host default</option>
                {modelOptionsForProvider((agent ?? fanOut)?.provider).map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
            <ToolPicker
              value={(agent ?? fanOut)?.tools}
              choices={catalog.tools}
              onChange={(tools) => patch({ tools })}
            />
            {/* Sub-agents run at the same time, so for a fan-out this is the
                difference between parallel work and workers overwriting each
                other in one checkout. */}
            <label className="flow-node-toggle">
              <input
                type="checkbox"
                aria-label={fanOut ? 'Isolate each sub-agent' : 'Run in its own worktree'}
                checked={(agent ?? fanOut)?.worktree === true}
                onChange={(event) => patch({ worktree: event.target.checked || undefined })}
              />
              <span>
                {fanOut ? 'Give each sub-agent its own worktree' : 'Run in its own worktree'}
              </span>
            </label>
          </>
        )}

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
      </details>
        </div>
      )}

      {issues.length > 0 && (
        <ul className="flow-node-issues" data-testid={`flow-node-issues-${id}`}>
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <Handle type="source" position={Position.Right} id="right" className="flow-node-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="flow-node-handle flow-node-handle-vertical" />
    </div>
  );
}

/**
 * One component per node type, as the host's node registry expects. They share
 * a card body and differ in icon, primary field, and editing affordance.
 */
export function createNodeTypes(
  onEdited: () => void,
  onDuplicate: (id: string) => void
): NodeTypes {
  const entries = (Object.keys(CHROME) as NodeType[]).map((type) => {
    const chrome = CHROME[type];
    const Component = (props: NodeProps<FlowCanvasNode>) => (
      <FlowNodeCard {...props} chrome={chrome} onEdited={onEdited} onDuplicate={onDuplicate} />
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
  'fan-out': 'Fan out',
  'slash-command': 'Slash command',
  skill: 'Skill',
  shell: 'Shell',
  'human-gate': 'Human gate',
  'write-file': 'Write file',
};

export const NODE_TYPE_ICONS: Record<NodeType, string> = Object.fromEntries(
  (Object.keys(CHROME) as NodeType[]).map((type) => [type, CHROME[type].icon])
) as Record<NodeType, string>;
