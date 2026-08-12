import type { Flow, FlowNode } from '../schema/types';
import { validateFlow } from '../schema/validate';

/** Where a compiled flow lands, relative to the workspace root. */
export function commandPathFor(flowName: string): string {
  return `.claude/commands/flow-${slug(flowName)}.md`;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'flow'
  );
}

/**
 * Compile a flow into a Claude Code slash command.
 *
 * The command is a set of instructions, not an executor: outside the app there
 * is no canvas to pause and no gate card to click, so gates become explicit
 * "stop and ask" points rather than something the agent decides on its own.
 */
export function compileToSlashCommand(flow: Flow, flowPath: string): string {
  const validated = validateFlow(flow);
  if (!validated.valid) {
    throw new Error(
      `cannot compile an invalid flow: ${validated.errors
        .map((error) => (error.path ? `${error.path}: ${error.message}` : error.message))
        .join('; ')}`
    );
  }

  const resolved = validated.flow;
  const ordered = topologicalOrder(resolved);
  const parentsOf = (id: string) => resolved.edges.filter((e) => e.to === id).map((e) => e.from);

  const lines: string[] = [
    '---',
    `description: Run the ${resolved.name} flow`,
    '---',
    '',
    `# ${resolved.name}`,
    '',
    `Generated from \`${flowPath}\` by the Nimbalyst flows extension. Edit the flow, not this file — recompiling overwrites it.`,
    '',
    'Work through the steps in order. Each step depends on the ones listed after `after:`; use their results as input where a `{{node.port}}` reference appears.',
    '',
  ];

  if (Object.keys(resolved.variables).length > 0) {
    lines.push('## Variables', '');
    for (const [name, value] of Object.entries(resolved.variables)) {
      lines.push(`- \`{{${name}}}\` — default: \`${value}\``);
    }
    lines.push('');
  }

  lines.push('## Steps', '');
  for (const node of ordered) {
    const parents = parentsOf(node.id);
    lines.push(`### ${node.id}${node.label ? ` — ${node.label}` : ''}`, '');
    lines.push(`- type: \`${node.type}\``);
    if (parents.length > 0) lines.push(`- after: ${parents.join(', ')}`);
    if (node.output) lines.push(`- publishes: \`{{${node.id}.${node.output}}}\``);
    // The compiled prompt is run by a CLI with no scheduler, so a condition on
    // an edge has to become a condition in prose.
    const failureOnly =
      resolved.edges.some((edge) => edge.to === node.id) &&
      resolved.edges.filter((edge) => edge.to === node.id).every((edge) => edge.on === 'failure');
    lines.push(
      '',
      failureOnly
        ? `**Only if a step above failed:** ${instructionFor(node)}`
        : instructionFor(node),
      ''
    );
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function instructionFor(node: FlowNode): string {
  switch (node.type) {
    case 'agent':
      return node.prompt;
    case 'slash-command':
      return `Run ${node.command}${node.args ? ` ${node.args}` : ''}`;
    case 'skill':
      return `Use the ${node.skill} skill.${node.input ? `\n\n${node.input}` : ''}`;
    case 'shell':
      return `Run this command${node.cwd ? ` in \`${node.cwd}\`` : ''} and check it succeeds:\n\n\`\`\`sh\n${node.run}\n\`\`\``;
    case 'fan-out':
      return (
        `Repeat the following once for every line of ${node.over}, running them in parallel where you can. ` +
        `Substitute each line for {{item}}:\n\n${node.prompt}`
      );
    case 'human-gate':
      // Outside the app there is no gate card, so the only safe translation of
      // "wait for a human" is to stop and ask.
      return `**Stop and ask the user before continuing:** ${node.message}`;
    case 'write-file':
      // Compiled output is run by the user's own CLI, which has its own file
      // tools -- so this becomes an instruction rather than a shell redirect,
      // which would mangle any content containing quotes or backticks.
      return `Write the following to \`${node.path}\`, replacing whatever is there:\n\n${node.content}`;
  }
}

/** Dependency order; the flow is a validated DAG, so this always terminates. */
function topologicalOrder(flow: Flow): FlowNode[] {
  const pending = new Map(flow.nodes.map((node) => [node.id, 0]));
  for (const edge of flow.edges) pending.set(edge.to, (pending.get(edge.to) ?? 0) + 1);

  const ready = flow.nodes.filter((node) => pending.get(node.id) === 0).map((node) => node.id);
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const ordered: FlowNode[] = [];

  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(byId.get(id)!);
    for (const edge of flow.edges.filter((e) => e.from === id)) {
      const left = (pending.get(edge.to) ?? 1) - 1;
      pending.set(edge.to, left);
      if (left === 0) ready.push(edge.to);
    }
  }

  return ordered;
}
