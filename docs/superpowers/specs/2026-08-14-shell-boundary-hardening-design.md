# Shell node boundary hardening

## Threat

`shell` nodes run an allowlisted executable via `spawn(..., { shell: false })` in the
extension's backend utility-process. `shell: false` makes `&&`, `;`, `$(…)`, backticks inert,
so command *chaining* is not the exposure. The real exposure is **allowlisted-but-scriptable
binaries**: `node -e`, `npm --node-options=--require=…`, `git -c`, `git --upload-pack=…` all
execute code the allowlist never approved, and they survive `shell: false` because they are a
single argv the process itself interprets.

The command string is `context.resolved.run` — interpolated, so upstream agent output flows
into it. An attacker who controls agent output (or a malicious `.flow.json`) controls the shell
argv within the allowlist.

## Two defects found

1. **The boundary does not enforce the smuggling-flag policy.** `backend/index.ts runShell`
   re-checks the *executable* allowlist (its comment: "this one is the boundary") but never
   checks smuggling flags. The only thing refusing `node -e` is the renderer's `assertAllowed`
   — a pre-check the comment itself calls "a convenience." Defense-in-depth is missing at the
   one layer that matters.

2. **The two layers parse argv differently, so quoting evades the pre-check.** The renderer
   splits with `command.trim().split(/\s+/)` (quote-blind); the backend spawns from
   `tokenize()` (quote-aware, strips quotes). `node "-e" "process.exit(0)"`:
   - renderer sees token `"-e"` (quotes included) → not in `SMUGGLING_FLAGS` → **passes**
   - backend tokenizes to `['node', '-e', 'process.exit(0)']` → **runs**. RCE.

Both collapse to one root cause: the smuggling-flag policy is enforced in the wrong place
(renderer only) against the wrong parse (naive split, not the tokenizer that sets the real argv).

## Fix

Enforce the policy at the boundary, on the exact argv that will be spawned.

- New pure module `src/runner/shellPolicy.ts`: `CHAINING`, `SMUGGLING_FLAGS`, `tokenize()`
  (moved from `backend/index.ts`, single source of truth), `assertArgvSafe(argv)` — throws on
  a smuggling flag in `argv[1..]`, matching `--flag=value` via `split('=')[0]`.
- `backend/index.ts runShell`: after `tokenize` + allowlist, call `assertArgvSafe(argv.slice(1))`
  before `spawn`. The boundary now judges the real argv.
- `runner/executors.ts assertAllowed`: tokenize with the shared quote-aware `tokenize` and
  delegate flag checks to `assertArgvSafe`, so the fast-fail parses the same way the boundary
  spawns and no longer gives false confidence.

Chaining stays a renderer-side refusal (a conservative UX guardrail); `shell: false` already
neutralizes it at the boundary, so it needs no backend duplication.

## Tests (red first)

- backend: `node -e …` refused; `node "-e" …` (quote-evasion) refused; `git -c foo=bar log`
  refused — all before spawn.
- renderer: quote-wrapped smuggling flag `node "-e" "x"` refused (currently passes — the bug).
- keep every existing shell test green (allowlist, chaining, unquoted smuggling, ordinary flags).
