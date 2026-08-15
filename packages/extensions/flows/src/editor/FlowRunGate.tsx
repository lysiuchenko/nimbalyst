import type { FlowEffectSummary } from '../runner/flowEffects';

/**
 * The pre-run approval gate: a blocking review of everything the run will do,
 * grouped by effect. Presentational — every decision is the caller's. Reuses
 * the `flow-gate` shape so it reads like the run-pause card.
 */
export function FlowRunGate({
  summary,
  problems,
  onApprove,
  onCancel,
  onPreview,
}: {
  summary: FlowEffectSummary;
  problems: Record<string, string[]>;
  onApprove: () => void;
  onCancel: () => void;
  onPreview: () => void;
}) {
  const problemRows = Object.entries(problems).flatMap(([nodeId, messages]) =>
    messages.map((message) => ({ nodeId, message }))
  );

  return (
    <div className="flow-gate flow-run-gate" role="alertdialog" data-testid="flow-run-gate">
      <div className="flow-gate-head">
        <span className="material-symbols-outlined" aria-hidden="true">visibility</span>
        <strong>Review what this run will do</strong>
      </div>

      {summary.files.length > 0 && (
        <section className="flow-run-gate-group" data-testid="flow-run-gate-files">
          <h4>Files</h4>
          {summary.files.map((file) => (
            <div key={file.nodeId} className="flow-run-gate-row">
              <span className="flow-run-gate-node">{file.label}</span>
              <code>{file.path.text}</code>
              {!file.path.resolved && <em className="flow-run-gate-symbolic">resolved at run time</em>}
            </div>
          ))}
        </section>
      )}

      {summary.shell.length > 0 && (
        <section className="flow-run-gate-group" data-testid="flow-run-gate-shell">
          <h4>Shell</h4>
          {summary.shell.map((entry) => (
            <div key={entry.nodeId} className="flow-run-gate-row">
              <span className="flow-run-gate-node">{entry.label}</span>
              <code>{entry.command.text}</code>
              {!entry.command.resolved && <em className="flow-run-gate-symbolic">resolved at run time</em>}
              {entry.inAllowlist === false && <span className="flow-run-gate-flag">outside allowlist</span>}
            </div>
          ))}
        </section>
      )}

      {summary.agents.length > 0 && (
        <section className="flow-run-gate-group" data-testid="flow-run-gate-agents">
          <h4>Agents</h4>
          {summary.agents.map((agent) => (
            <div key={agent.nodeId} className="flow-run-gate-row">
              <span className="flow-run-gate-node">{agent.label}</span>
              <span className="flow-run-gate-meta">
                {agent.kind} · {agent.provider} ·{' '}
                {agent.tools ? `tools: ${agent.tools.join(', ')}` : 'tools: project default'} ·{' '}
                {agent.worktree ? 'isolated' : 'main working tree'}
              </span>
              {agent.over && !agent.over.resolved && (
                <em className="flow-run-gate-symbolic">over {agent.over.text} — count at run time</em>
              )}
            </div>
          ))}
        </section>
      )}

      {problemRows.length > 0 && (
        <section className="flow-run-gate-group" data-testid="flow-run-gate-problems">
          <h4>Reference problems</h4>
          {problemRows.map((row, index) => (
            <div key={`${row.nodeId}-${index}`} className="flow-run-gate-row">
              <span className="flow-run-gate-node">{row.nodeId}</span>
              <span>{row.message}</span>
            </div>
          ))}
        </section>
      )}

      <div className="flow-gate-actions">
        <button type="button" className="flow-run-gate-preview" data-testid="flow-run-gate-preview" onClick={onPreview}>
          Preview resolved commands
        </button>
        <button type="button" className="flow-gate-reject" data-testid="flow-run-gate-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="flow-gate-approve" data-testid="flow-run-gate-approve" onClick={onApprove}>
          Approve and run
        </button>
      </div>
    </div>
  );
}
