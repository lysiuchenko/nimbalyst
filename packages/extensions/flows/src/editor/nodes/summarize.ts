import type { FlowNode } from '../../schema/types';

/** Longest summary a card shows before it is cut. */
const SUMMARY_LIMIT = 100;

/**
 * One plain sentence describing what a node does.
 *
 * A flow is read far more often than it is edited, and it is read by people who
 * did not write it — an analyst reviewing a process, an engineer picking up
 * someone else's pipeline. So the card leads with meaning ("Waits for a person:
 * Ship it?") rather than with the field names the schema happens to use.
 */
export function summarize(node: FlowNode): string {
  return clamp(flatten(describe(node)));
}

function describe(node: FlowNode): string {
  switch (node.type) {
    case 'agent':
      return node.prompt;
    case 'fan-out':
      return node.over
        ? `For each item in ${node.over}: ${node.prompt}`
        : node.prompt;
    case 'human-gate':
      return node.message ? `Waits for a person: ${node.message}` : '';
    case 'skill':
      return node.skill ? `Uses the ${node.skill} skill` : '';
    case 'slash-command':
      return node.args ? `${node.command} ${node.args}` : node.command;
    case 'shell':
      return node.run;
    case 'write-file':
      // The path is the point of this node; the content is whatever flowed in.
      return node.path ? `Saves to ${node.path}` : '';
  }
}

/** A card is one line tall; newlines in a prompt must not change that. */
function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clamp(text: string): string {
  if (text === '') return 'Not filled in yet';
  return text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : text;
}

export interface ConfigBadge {
  label: string;
  /** The full value, for the cases where the badge had to shorten it. */
  title: string;
}

/**
 * The settings a node has been moved off its defaults on.
 *
 * These are what someone needs to know before trusting a step — which model
 * spends the tokens, whether the tools are restricted, whether the work is
 * isolated — and they would otherwise be invisible until the node is opened.
 * A node left on every default shows no badges, so a badge always means
 * "someone chose this".
 */
export function configBadges(node: FlowNode): ConfigBadge[] {
  const badges: ConfigBadge[] = [];

  if (node.join === 'any') {
    badges.push({
      label: 'any branch',
      title: 'Runs when the first incoming branch arrives — the arms of a fork can meet here',
    });
  }
  // Structural, not `AgentNode & FanOutNode`: intersecting those collapses to
  // `never`, because their `type` literals cannot both hold.
  const configurable = node as Partial<{
    model: string | null;
    tools: string[];
    worktree: boolean;
  }>;

  if (node.type === 'fan-out' && node.concurrency) {
    badges.push({
      label: `${node.concurrency} at a time`,
      title: `Runs ${node.concurrency} sub-agents at once`,
    });
  }

  if (configurable.model) {
    badges.push({
      label: configurable.model.split(':').pop() ?? configurable.model,
      title: `Model: ${configurable.model}`,
    });
  }

  if (configurable.tools && configurable.tools.length > 0) {
    badges.push({
      label: `${configurable.tools.length} tools`,
      title: `Restricted to: ${configurable.tools.join(', ')}`,
    });
  }

  if (configurable.worktree === true) {
    badges.push({
      label: 'Isolated',
      title:
        node.type === 'fan-out'
          ? 'Each sub-agent works in its own git worktree'
          : 'Works in its own git worktree',
    });
  }

  return badges;
}
