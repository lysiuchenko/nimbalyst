import { useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { getHostServices } from '../host/hostServices';
import { loadAllRuns } from './loadAllRuns';
import { summariseRuns, type RunsSummary } from './metrics';
import { asDuration } from './asDuration';

export function FlowsDashboard(_props: PanelHostProps) {
  const [summary, setSummary] = useState<RunsSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAllRuns(getHostServices().filesystem).then((records) => {
      if (!cancelled) setSummary(summariseRuns(records));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return <div className="flows-dashboard" data-testid="flows-dashboard" />;

  const { totals } = summary;

  return (
    <div className="flows-dashboard" data-testid="flows-dashboard">
      <header className="flows-dashboard-header">
        <h1>Flows</h1>
        <p>
          {totals.runs} {totals.runs === 1 ? 'run' : 'runs'} recorded in this workspace
        </p>
      </header>

      {totals.runs === 0 ? (
        <p className="flow-node-hint">
          No runs yet. Run a flow and its record lands in <code>.flow-runs/</code>.
        </p>
      ) : (
        <>
          <div className="flows-dashboard-cards">
            <article className="flows-dashboard-card" data-metric="agent-time">
              <span className="flows-dashboard-value">{asDuration(summary.agentMs)}</span>
              <span className="flows-dashboard-label">Agent time</span>
              <span className="flows-dashboard-note">Work the agents did</span>
            </article>

            <article className="flows-dashboard-card" data-metric="human-time">
              <span className="flows-dashboard-value">{asDuration(summary.humanMs)}</span>
              <span className="flows-dashboard-label">Human time</span>
              <span className="flows-dashboard-note">Waiting at approval gates</span>
            </article>

            <article className="flows-dashboard-card" data-metric="sub-agents">
              <span className="flows-dashboard-value">{summary.subAgents}</span>
              <span className="flows-dashboard-label">Sub-agents</span>
              <span className="flows-dashboard-note">Spawned by fan-out steps</span>
            </article>

            <article className="flows-dashboard-card" data-metric="tokens">
              <span className="flows-dashboard-value">
                {summary.tokens === null ? '—' : summary.tokens.toLocaleString()}
              </span>
              <span className="flows-dashboard-label">Tokens</span>
              {/* Zero would claim these runs were free; they were not. */}
              <span className="flows-dashboard-note">
                {summary.tokens === null ? 'Not recorded by the host' : 'Across every run'}
              </span>
            </article>
          </div>

          <table className="flow-run-table" data-testid="flows-dashboard-flows">
            <thead>
              <tr>
                <th>Flow</th>
                <th className="flow-run-number">Runs</th>
                <th className="flow-run-number">Failed</th>
                <th className="flow-run-number">Agent</th>
                <th className="flow-run-number">Human</th>
              </tr>
            </thead>
            <tbody>
              {summary.byFlow.map((flow) => (
                <tr key={flow.flowPath} data-dashboard-flow={flow.flowName}>
                  <td title={flow.flowPath}>{flow.flowName}</td>
                  <td className="flow-run-number">{flow.runs}</td>
                  <td className="flow-run-number">{flow.failed || '—'}</td>
                  <td className="flow-run-number">{asDuration(flow.agentMs)}</td>
                  <td className="flow-run-number">{asDuration(flow.humanMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
