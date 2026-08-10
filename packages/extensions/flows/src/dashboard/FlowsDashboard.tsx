import { useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { getHostServices } from '../host/hostServices';
import { loadAllRuns } from './loadAllRuns';
import { loadFlowFiles } from './loadFlowFiles';
import { buildFlowRows, type FlowRow } from './flowList';
import { summariseRuns, type RunsSummary } from './metrics';
import { asDuration } from './asDuration';
import { asAgo } from './asAgo';
import { scheduleLabel } from '../schedule/label';
import { readTheme, type FlowThemeId } from '../editor/theme';

interface DashboardData {
  summary: RunsSummary;
  rows: FlowRow[];
}

export function FlowsDashboard({ host }: PanelHostProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  // The canvas theme is a per-workspace choice the editor stores; the panel
  // reads the same key so the two surfaces do not disagree.
  const [theme, setTheme] = useState<FlowThemeId>(() => readTheme(host.storage));

  useEffect(() => {
    setTheme(readTheme(host.storage));
  }, [host.storage]);

  useEffect(() => {
    let cancelled = false;
    const filesystem = getHostServices().filesystem;

    void Promise.all([loadAllRuns(filesystem), loadFlowFiles(filesystem)]).then(
      ([records, files]) => {
        if (cancelled) return;
        const summary = summariseRuns(records);
        setData({ summary, rows: buildFlowRows(files, summary.byFlow, host.workspacePath) });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [host.workspacePath]);

  if (!data) {
    return (
      <div className="flows-dashboard" data-flow-theme={theme} data-testid="flows-dashboard" />
    );
  }

  const { summary, rows } = data;
  const { totals } = summary;

  return (
    <div className="flows-dashboard" data-flow-theme={theme} data-testid="flows-dashboard">
      <header className="flows-dashboard-header">
        <h1>Flows</h1>
        <p>{subtitleFor(rows.length, totals.runs)}</p>
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {totals.runs > 0 && <MetricCards summary={summary} />}

          <section className="flows-dashboard-list" data-testid="flows-dashboard-flows">
            {/* Aligned to the row grid so "43s" is legibly agent time rather
                than an unexplained number at the end of a line. */}
            <div className="flows-dashboard-row flows-dashboard-head" aria-hidden="true">
              <span />
              <span>Flow</span>
              <span>Runs when</span>
              <span className="flows-dashboard-row-stat">Runs</span>
              <span className="flows-dashboard-row-stat">Failed</span>
              <span className="flows-dashboard-row-stat">Agent</span>
            </div>

            {rows.map((row) => (
              <FlowRowCard
                key={row.flowPath}
                row={row}
                onOpen={() => {
                  // The file opens in a tab *behind* this panel, so without
                  // standing down the panel a click looks like it did nothing.
                  host.openFile(row.flowPath);
                  host.close();
                }}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function subtitleFor(flows: number, runs: number): string {
  if (flows === 0) return 'Nothing here yet';
  const flowWord = flows === 1 ? 'flow' : 'flows';
  if (runs === 0) return `${flows} ${flowWord}, none run yet`;
  return `${flows} ${flowWord} · ${runs} ${runs === 1 ? 'run' : 'runs'} recorded`;
}

/**
 * A flow as a row you can act on.
 *
 * Archived rows have no file behind them any more, so they are deliberately
 * inert — offering to open a file that is gone is worse than not offering.
 */
function FlowRowCard({ row, onOpen }: { row: FlowRow; onOpen: () => void }) {
  const openable = row.state !== 'archived';
  // `scheduleLabel` answers for a toolbar button, so it says "Schedule" when
  // there is none. On a list a flow nobody automated is "Manual".
  const scheduled = row.schedule?.enabled === true;
  const schedule = scheduled ? scheduleLabel(row.schedule ?? undefined) : null;

  return (
    <div
      className="flows-dashboard-row"
      data-flow-state={row.state}
      data-dashboard-flow={row.flowName}
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      title={
        openable ? `${row.displayPath} — open it` : `${row.displayPath} — no longer in the workspace`
      }
      onClick={openable ? onOpen : undefined}
      onKeyDown={
        openable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      <span className="flows-dashboard-dot" aria-hidden="true" />

      <div className="flows-dashboard-row-main">
        <span className="flows-dashboard-row-name">{row.flowName}</span>
        <span className="flows-dashboard-row-sub">
          {row.state === 'archived' ? 'No longer in this workspace' : row.displayPath}
          {' · '}
          {asAgo(row.lastRunAt)}
        </span>
      </div>

      {schedule ? (
        <span className="flows-dashboard-pill" data-pill="schedule">
          {schedule}
        </span>
      ) : (
        <span className="flows-dashboard-pill" data-pill="manual">
          Manual
        </span>
      )}

      <span className="flows-dashboard-row-stat">
        {row.runs === 0 ? '—' : `${row.runs} ${row.runs === 1 ? 'run' : 'runs'}`}
      </span>
      <span className="flows-dashboard-row-stat" data-failed={row.failed > 0}>
        {row.failed > 0 ? `${row.failed} failed` : ''}
      </span>
      <span className="flows-dashboard-row-stat">{row.runs === 0 ? '' : asDuration(row.agentMs)}</span>
    </div>
  );
}

/**
 * What someone sees before they have anything.
 *
 * The New File menu already offers "Flow" — the manifest contributes it — but
 * nothing in the product ever said so, which left this screen as a blank
 * rectangle with no way forward.
 */
function EmptyState() {
  return (
    <div className="flows-dashboard-empty" data-testid="flows-dashboard-empty">
      <span className="material-symbols-outlined" aria-hidden="true">
        account_tree
      </span>
      <h2>No flows in this workspace yet</h2>
      <p>
        A flow is a pipeline you draw: shell steps, agent steps, and approval gates wired together.
        Run it once, or put it on a schedule and let it run without you.
      </p>
      <p className="flows-dashboard-empty-how">
        Create one from <strong>New File → Flow</strong>, then pick a starter template on the canvas.
      </p>
    </div>
  );
}

function MetricCards({ summary }: { summary: RunsSummary }) {
  return (
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

      {/* Only shown where a flow author stated a baseline — the figure is
          theirs, and without one there is nothing honest to display. */}
      {summary.savedMs !== null && (
        <article className="flows-dashboard-card" data-metric="saved">
          <span className="flows-dashboard-value">{asDuration(summary.savedMs)}</span>
          <span className="flows-dashboard-label">Time saved (estimated)</span>
          <span className="flows-dashboard-note">
            From your own baseline, across {summary.baselineRuns}{' '}
            {summary.baselineRuns === 1 ? 'run' : 'runs'}
          </span>
        </article>
      )}

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
  );
}
