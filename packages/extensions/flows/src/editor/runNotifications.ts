import type { RunRecord } from '../runner/runStore';

/**
 * Run-level OS notifications, written for Notification Center.
 *
 * The host fires a per-turn "Response Ready" for every agent session — which,
 * for a flow, meant one raw-markdown notification per step and eight for a
 * fan-out, while the two moments that actually need a person (a waiting gate,
 * the run ending) only showed as in-app toasts. Flow step sessions now
 * suppress the per-turn one, and these fire instead: clean one-line prose, no
 * markdown, no mid-word cuts.
 */
export interface RunNotificationCopy {
  title: string;
  body: string;
}

/** One clean line, cut at a word boundary. */
function oneLine(text: string, limit = 140): string {
  const plain = text
    // Backticks and asterisks only: underscores are load-bearing in filenames.
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function gateNotification(
  flowName: string,
  gateLabel: string,
  message: string
): RunNotificationCopy {
  return {
    title: `Flow "${flowName}" is waiting at "${gateLabel}"`,
    body: oneLine(message),
  };
}

export function runNotification(record: RunRecord): RunNotificationCopy {
  const flowName = record.flowName;

  if (record.status === 'cancelled') {
    return { title: `Flow "${flowName}" was cancelled`, body: '' };
  }

  if (record.status === 'failed') {
    const failed = Object.values(record.nodes).find((node) => node.status === 'failed');
    return {
      title: `Flow "${flowName}" failed${failed ? ` at "${failed.nodeId}"` : ''}`,
      body: oneLine(failed?.error ?? 'See the run history for details.'),
    };
  }

  const ran = Object.values(record.nodes).filter((node) => node.status === 'done');
  // "wrote PR_REVIEW.md (2140 characters)" -> "wrote PR_REVIEW.md" — the
  // artifacts are the part of a finished run worth a glance.
  const artifacts = ran
    .filter((node) => node.type === 'write-file' && node.output)
    .map((node) => node.output!.replace(/\s*\(\d+ characters\)\s*$/, ''));

  const steps = `${ran.length} ${ran.length === 1 ? 'step' : 'steps'}`;
  return {
    title: `Flow "${flowName}" finished`,
    body: oneLine([steps, ...artifacts].join(' · ')),
  };
}
