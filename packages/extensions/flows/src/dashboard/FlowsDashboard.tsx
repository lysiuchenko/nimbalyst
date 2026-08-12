import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { getHostServices } from '../host/hostServices';
import { createWorkspaceFiles, workspaceFindIpc } from '../host/workspaceFiles';
import { asAgo } from './asAgo';
import { asDuration } from './asDuration';
import { asNextRun } from './asNextRun';
import { type FlowRow, type FlowRowState } from './flowList';
import { loadDashboardData, type DashboardData } from './loadDashboardData';
import type { RunsSummary } from './metrics';
import { scheduleLabel } from '../schedule/label';
import { readTheme, type FlowThemeId } from '../editor/theme';
import { requestRun, RUN_INTENT_EVENT } from '../editor/runIntent';

const REFRESH_INTERVAL_MS = 15_000;

interface DashboardView {
  data: DashboardData | null;
  error: string | null;
  refreshing: boolean;
  updatedAt: number | null;
}

const INITIAL_VIEW: DashboardView = {
  data: null,
  error: null,
  refreshing: true,
  updatedAt: null,
};

export function FlowsDashboard({ host }: PanelHostProps) {
  const [view, setView] = useState<DashboardView>(INITIAL_VIEW);
  // The canvas theme is a per-workspace choice the editor stores; the panel
  // reads the same key so the two surfaces do not disagree.
  const [theme, setTheme] = useState<FlowThemeId>(() => readTheme(host.storage));
  const requestId = useRef(0);
  const workspacePath = host.workspacePath;

  useEffect(() => {
    setTheme(readTheme(host.storage));
  }, [host.storage]);

  const refresh = useCallback(
    async (clearSnapshot = false) => {
      const currentRequest = ++requestId.current;
      setView((current) =>
        clearSnapshot ? INITIAL_VIEW : { ...current, error: null, refreshing: true }
      );

      try {
        const filesystem = createWorkspaceFiles(
          getHostServices().filesystem,
          workspacePath,
          workspaceFindIpc()
        );
        const data = await loadDashboardData(filesystem, workspacePath);
        if (requestId.current !== currentRequest) return;
        setView({
          data,
          error: null,
          refreshing: false,
          updatedAt: Date.now(),
        });
      } catch (error) {
        if (requestId.current !== currentRequest) return;
        setView((current) => ({
          ...current,
          error: messageFor(error),
          refreshing: false,
        }));
      }
    },
    [workspacePath]
  );

  useEffect(() => {
    void refresh(true);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      requestId.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  if (!view.data && view.error) {
    return (
      <DashboardShell theme={theme} busy={false}>
        <LoadError message={view.error} onRetry={() => void refresh(true)} />
      </DashboardShell>
    );
  }

  if (!view.data) {
    return (
      <DashboardShell theme={theme} busy>
        <DashboardLoading />
      </DashboardShell>
    );
  }

  const { summary, rows, runProblems } = view.data;
  const { totals } = summary;
  const invalidFlows = rows.filter((row) => row.state === 'invalid').length;

  return (
    <DashboardShell theme={theme} busy={view.refreshing}>
      <header className="flows-dashboard-header">
        <div>
          <h1>Flows</h1>
          <p>{subtitleFor(rows.length, totals.runs)}</p>
        </div>
        <div className="flows-dashboard-actions">
          <span className="flows-dashboard-updated" aria-live="polite">
            {view.refreshing
              ? 'Refreshing…'
              : view.updatedAt
              ? `Updated ${asAgo(view.updatedAt)}`
              : ''}
          </span>
          <button
            type="button"
            className="flows-dashboard-refresh"
            disabled={view.refreshing}
            onClick={() => void refresh()}
            aria-label="Refresh flows"
            title="Refresh flows"
          >
            <span
              className="material-symbols-outlined"
              data-spinning={view.refreshing || undefined}
              aria-hidden="true"
            >
              refresh
            </span>
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {view.error && (
        <Notice tone="warning" title="Couldn’t refresh">
          Showing the last good snapshot. {view.error}
        </Notice>
      )}

      {(invalidFlows > 0 || runProblems.length > 0) && (
        <Notice tone="attention" title="Some flow data needs attention">
          {problemSummary(invalidFlows, runProblems.length)} Invalid flows stay in the list so you
          can open and repair them.
        </Notice>
      )}

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {totals.runs > 0 && <MetricCards summary={summary} />}

          <section className="flows-dashboard-list" data-testid="flows-dashboard-flows">
            <div className="flows-dashboard-row flows-dashboard-head" aria-hidden="true">
              <span />
              <span>Flow</span>
              <span />
              <span>Next run</span>
              <span className="flows-dashboard-row-stat">Runs</span>
              <span className="flows-dashboard-row-stat">Failed</span>
              <span className="flows-dashboard-row-stat">Avg. agent</span>
            </div>

            {rows.map((row) => (
              <FlowRowCard
                key={`${row.state}:${row.flowPath}`}
                row={row}
                onOpen={() => {
                  // Opening behind an opaque panel looked like a dead click.
                  host.openFile(row.flowPath);
                  host.close();
                }}
                onRun={() => {
                  // The panel launches; the editor owns the run — gates,
                  // statuses and cancel already live there. The intent is
                  // consumed by a freshly-loading editor; the event reaches one
                  // whose tab was already open.
                  requestRun(row.flowPath);
                  host.openFile(row.flowPath);
                  host.close();
                  window.dispatchEvent(new Event(RUN_INTENT_EVENT));
                }}
              />
            ))}
          </section>
        </>
      )}
    </DashboardShell>
  );
}

function DashboardShell({
  theme,
  busy,
  children,
}: {
  theme: FlowThemeId;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <main
      className="flows-dashboard"
      data-flow-theme={theme}
      data-testid="flows-dashboard"
      aria-busy={busy}
    >
      {children}
    </main>
  );
}

function DashboardLoading() {
  return (
    <div
      className="flows-dashboard-loading"
      data-testid="flows-dashboard-loading"
      aria-label="Loading flows"
    >
      <div className="flows-dashboard-loading-title" />
      <div className="flows-dashboard-loading-subtitle" />
      <div className="flows-dashboard-loading-cards">
        <span />
        <span />
        <span />
      </div>
      <div className="flows-dashboard-loading-rows">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section
      className="flows-dashboard-load-error"
      role="alert"
      data-testid="flows-dashboard-error"
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        cloud_off
      </span>
      <h1>Couldn’t load flows</h1>
      <p className="select-text">{message}</p>
      <button type="button" className="flows-dashboard-primary-action" onClick={onRetry}>
        Try again
      </button>
    </section>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'warning' | 'attention';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="flows-dashboard-notice" data-tone={tone} role="status">
      <span className="material-symbols-outlined" aria-hidden="true">
        {tone === 'warning' ? 'sync_problem' : 'warning'}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </aside>
  );
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The workspace could not be read.';
}

function problemSummary(invalidFlows: number, damagedRuns: number): string {
  const parts: string[] = [];
  if (invalidFlows > 0) {
    parts.push(`${invalidFlows} invalid ${invalidFlows === 1 ? 'flow' : 'flows'}`);
  }
  if (damagedRuns > 0) {
    parts.push(
      `${damagedRuns} damaged run ${damagedRuns === 1 ? 'record was' : 'records were'} skipped`
    );
  }
  return `${parts.join(' · ')}.`;
}

function subtitleFor(flows: number, runs: number): string {
  if (flows === 0) return 'Nothing here yet';
  const flowWord = flows === 1 ? 'flow' : 'flows';
  if (runs === 0) return `${flows} ${flowWord}, none run yet`;
  return `${flows} ${flowWord} · ${runs} ${runs === 1 ? 'run' : 'runs'} recorded`;
}

/** One flow as a complete keyboard target. Archived rows have no file to open. */
function FlowRowCard({
  row,
  onOpen,
  onRun,
}: {
  row: FlowRow;
  onOpen: () => void;
  onRun: () => void;
}) {
  const openable = row.state !== 'archived';
  // Not `invalid` (the run would only fail validation), not `archived` (no
  // file), not `running` (one run per flow at a time is the rule everywhere).
  const runnable = row.state === 'ok' || row.state === 'failing' || row.state === 'never-run';
  const scheduled = row.schedule?.enabled === true;
  const recurrence = scheduled ? scheduleLabel(row.schedule ?? undefined) : null;
  const title = titleFor(row, openable, recurrence);

  return (
    <div
      className="flows-dashboard-row"
      data-flow-state={row.state}
      data-dashboard-flow={row.flowName}
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      title={title}
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
          <span className="flows-dashboard-status">{statusLabel(row.state)}</span>
          <span aria-hidden="true"> · </span>
          {row.state === 'archived' ? 'No longer in this workspace' : row.displayPath}
          {row.state !== 'invalid' && row.state !== 'never-run' && (
            <>
              <span aria-hidden="true"> · </span>
              {asAgo(row.lastRunAt)}
            </>
          )}
          {row.state === 'invalid' && row.problemSummary && (
            <>
              <span aria-hidden="true"> · </span>
              {row.problemSummary}
            </>
          )}
        </span>
      </div>

      {runnable ? (
        <button
          type="button"
          className="flows-dashboard-run"
          data-testid="flows-dashboard-run"
          aria-label={`Run ${row.flowName}`}
          title={`Run ${row.flowName} — opens the flow and starts it`}
          onClick={(event) => {
            // The row itself opens the flow; the button must not double up.
            event.stopPropagation();
            onRun();
          }}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            play_arrow
          </span>
          Run
        </button>
      ) : (
        // The rows share one grid; a missing cell would shift every column.
        <span aria-hidden="true" />
      )}

      {row.state === 'invalid' ? (
        <span className="flows-dashboard-pill" data-pill="invalid">
          {row.problemCount} {row.problemCount === 1 ? 'problem' : 'problems'}
        </span>
      ) : scheduled ? (
        <span className="flows-dashboard-pill" data-pill="schedule" title={recurrence ?? undefined}>
          {asNextRun(row.nextRunAt)}
        </span>
      ) : (
        <span className="flows-dashboard-pill" data-pill="manual">
          Manual
        </span>
      )}

      <span className="flows-dashboard-row-stat" data-stat="runs">
        {row.runs === 0 ? '—' : `${row.runs} ${row.runs === 1 ? 'run' : 'runs'}`}
      </span>
      <span className="flows-dashboard-row-stat" data-stat="failed" data-failed={row.failed > 0}>
        {row.failed > 0 ? `${row.failed} failed` : '—'}
      </span>
      <span className="flows-dashboard-row-stat" data-stat="average">
        {row.runs === 0 || row.agentMs === 0 ? '—' : asDuration(row.averageAgentMs)}
      </span>
    </div>
  );
}

function titleFor(row: FlowRow, openable: boolean, recurrence: string | null): string {
  if (!openable) return `${row.displayPath} — no longer in the workspace`;
  if (row.state === 'invalid') {
    return `${row.displayPath} — open to fix ${row.problemCount} ${
      row.problemCount === 1 ? 'problem' : 'problems'
    }`;
  }
  return recurrence ? `${row.displayPath} — ${recurrence}` : `${row.displayPath} — open flow`;
}

function statusLabel(state: FlowRowState): string {
  const labels: Record<FlowRowState, string> = {
    invalid: 'Needs repair',
    failing: 'Failed',
    interrupted: 'Interrupted',
    running: 'Running',
    cancelled: 'Cancelled',
    ok: 'Succeeded',
    'never-run': 'Never run',
    archived: 'Archived',
  };
  return labels[state];
}

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
        Create one from <strong>New File → Flow</strong>, then pick a starter template on the
        canvas.
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
        <span className="flows-dashboard-note">
          {summary.tokens === null ? 'Not recorded by the host' : 'Across every run'}
        </span>
      </article>
    </div>
  );
}
