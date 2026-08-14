/**
 * Shared shell-command policy — the single source of truth for what a `shell`
 * node may run, used by both the renderer's pre-check and the backend boundary.
 *
 * Keeping the tokenizer and the flag list in one place is the point: the backend
 * spawns from `tokenize`, so any check that parses differently (an ad-hoc
 * `split(/\s+/)`, say) inspects a different argv than the one that actually runs
 * — and a quoted flag can slip through the check yet reach the process bare.
 */

/** Operators that would let one allowlisted command pull in another. */
export const CHAINING = ['&&', '||', ';', '|', '$(', '`', '>', '<', '&', '\n'];

/**
 * Flags that turn an allowlisted executable into an arbitrary one.
 *
 * Allowlisting the *executable* is not enough: `node -e '…'`, npm's
 * `--node-options=--require=…` and git's `--upload-pack=…` all execute code the
 * allowlist never approved, and they survive a shell-less spawn because the
 * process itself interprets them. Refused for every command.
 */
export const SMUGGLING_FLAGS = [
  '-e',
  '--eval',
  '-p',
  '--print',
  '--node-options',
  '--require',
  '-r',
  '--upload-pack',
  '--receive-pack',
  '--exec',
  '--use',
  '-c',
];

/**
 * Split a command line into argv, honoring single and double quotes.
 *
 * Quoting is the one shell convenience worth keeping — `--grep "two words"` is
 * ordinary usage. Nothing else is interpreted: no expansion, no substitution,
 * no operators, because the result is passed to `spawn` without a shell.
 */
export function tokenize(command: string): string[] {
  const argv: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const character of command.trim()) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started || current) argv.push(current);
      current = '';
      started = false;
      continue;
    }
    current += character;
    started = true;
  }
  if (started || current) argv.push(current);

  return argv;
}

/**
 * Refuse an argv whose arguments smuggle code past the executable allowlist.
 *
 * Judges the tokenized argv — the same one the backend spawns — so a quoted flag
 * cannot hide behind a whitespace split. `argv[0]` (the executable) is the
 * allowlist's job; this checks `argv[1..]`.
 */
export function assertArgvSafe(args: readonly string[]): void {
  for (const argument of args) {
    // `--flag=value` smuggles just as well as `--flag value`.
    const flag = argument.split('=')[0];
    if (SMUGGLING_FLAGS.includes(flag)) {
      throw new Error(
        `shell flag ${JSON.stringify(flag)} is not allowed: it can execute code the allowlist does not cover`
      );
    }
  }
}
