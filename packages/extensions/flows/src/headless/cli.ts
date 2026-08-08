/**
 * `nimbalyst-flows` — run, compile or validate a flow without the app.
 *
 * Argument parsing is separated from execution so the parser is testable on its
 * own and the entry point stays a thin shell around it.
 */

export type CliArgs =
  | { command: 'help' }
  | { command: 'run'; flowPath: string; variables: Record<string, string> }
  | { command: 'compile'; flowPath: string; outPath?: string }
  | { command: 'validate'; flowPath: string };

const COMMANDS = ['run', 'compile', 'validate'] as const;

export const USAGE = `nimbalyst-flows — run Nimbalyst flows headlessly

  nimbalyst-flows run <file.flow.json> [--var name=value ...]
  nimbalyst-flows compile <file.flow.json> [--out <path.md>]
  nimbalyst-flows validate <file.flow.json>

Exit codes: 0 success, 1 the flow failed, 2 bad usage or an invalid flow.`;

export function parseCliArgs(argv: string[]): CliArgs {
  const [first, ...rest] = argv;

  if (!first || first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help' };
  }
  if (!(COMMANDS as readonly string[]).includes(first)) {
    throw new Error(`unknown command ${JSON.stringify(first)}\n\n${USAGE}`);
  }

  const command = first as (typeof COMMANDS)[number];
  const positional = rest.filter((arg) => !arg.startsWith('-'));
  const flowPath = positional[0];
  if (!flowPath) {
    throw new Error(`${command} needs a .flow.json path\n\n${USAGE}`);
  }

  if (command === 'validate') return { command, flowPath };

  if (command === 'compile') {
    const outIndex = rest.indexOf('--out');
    const outPath = outIndex >= 0 ? rest[outIndex + 1] : undefined;
    return outPath ? { command, flowPath, outPath } : { command, flowPath };
  }

  return { command, flowPath, variables: parseVariables(rest) };
}

function parseVariables(args: string[]): Record<string, string> {
  const variables: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const inline = arg.startsWith('--var=') ? arg.slice('--var='.length) : undefined;
    const pair = inline ?? (arg === '--var' ? args[++i] : undefined);
    if (pair === undefined) continue;

    // Split on the FIRST `=` only, so a value may contain one.
    const split = pair.indexOf('=');
    if (split <= 0) {
      throw new Error(`--var expects name=value, got ${JSON.stringify(pair)}`);
    }
    variables[pair.slice(0, split)] = pair.slice(split + 1);
  }

  return variables;
}
