# Flows — security model

What the flows extension is allowed to do, what it refuses, and where each rule
is enforced. Every "enforced at" below points at code with a test.

## 1. Flow files carry no credentials

`.flow.json` is committed and shared, so a pasted key leaks the moment the file
is saved. The validator rejects credential-shaped strings anywhere in a flow —
in `variables`, and in every string field of every node.

| Detected | Example shape |
| --- | --- |
| Anthropic API key | `sk-ant-…` |
| OpenAI API key | `sk-…` / `sk-proj-…` |
| GitHub token | `ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…` |
| AWS access key id | `AKIA…` |
| Private key block | `-----BEGIN … PRIVATE KEY-----` |

A flow **names** a credential instead of carrying it: `${env:ANTHROPIC_API_KEY}`.
The error never echoes the offending value, so the rejection itself cannot leak
it into a log or a screenshot.

Enforced at `src/schema/validate.ts` (`CREDENTIAL_PATTERNS`, `credentialIn`) —
tests in `src/schema/__tests__/credentialScanning.test.ts`.

This is a backstop, not a scanner. It catches the common paste; it is not a
guarantee that a flow is credential-free.

## 2. Shell nodes are allowlisted, and the allowlist is enforced twice

A `shell` node names one executable. It runs only if that executable is on the
allowlist.

- **Renderer** (`src/runner/executors.ts`): fast failure before the command
  leaves the editor. Also rejects any chaining or substitution operator —
  `&&`, `||`, `;`, `|`, `$(`, backticks, `>`, `<`, `&`, newline — because one
  allowlisted binary plus `&&` is enough to run anything.
- **Backend module** (`src/backend/index.ts`): the real boundary. The allowlist
  travels with the request and is re-checked in the utility process, so a
  renderer that skipped the check changes nothing.

The command is spawned with **`shell: false`**. There is no shell to interpret
metacharacters, so `echo a && echo b` passes `&&` to `echo` as literal text — a
tested property, not an assumption. A quote-aware tokenizer keeps
`--grep "two words"` working without reintroducing a shell.

Default allowlist: `npm`, `npx`, `node`, `git`, `echo`, `ls`, `pwd`, `cat`.
Headless runs override it with `FLOWS_SHELL_ALLOWLIST`. An empty allowlist
disables shell nodes entirely.

## 3. Shell nodes cannot escape the workspace

A node's `cwd` is resolved against the workspace and rejected if it lands
outside it, so `cwd: "../.."` fails instead of running in the parent directory.
Enforced at `resolveCwd` in `src/backend/index.ts`.

## 4. Capabilities are never silently downgraded

`worktree: true` and `tools: [...]` are safety properties, so a node that asks
for one the host cannot honor **fails** rather than running without it:

```
node "plan" restricts tools to Read, Write, which this host cannot enforce;
it would otherwise run with every tool available
```

Running anyway would tell the author the node succeeded while it edited the main
tree with every tool available. Enforced at `assertCapableFor` in
`src/runner/executors.ts`; a client that can deliver these declares
`capabilities` and the same nodes run.

`worktree: true` is honored: `services.ai.sendPrompt` takes a `worktreeId`, and
`NimbalystAgentClient` creates the checkout *before* sending the prompt, so a
worktree that cannot be created or resolved fails the node instead of leaving it
loose in the main tree. `tools` has no equivalent and still fails.

On a `fan-out` the flag is per sub-agent, not per node — concurrent workers
sharing one checkout would overwrite each other. Each checkout is branched under
a name unique to the run, so re-running the same flow cannot collide with the
worktrees an earlier run left behind.

## 5. The extension runs no agent of its own

Flows never spawn the Claude Agent SDK. Agent work goes through the host's own
provider, so the host keeps owning credentials, binary resolution, and the env
sanitisation it added after a user's stray `.env` billed their personal account.
See `docs/editorhost-notes.md` §5b.

Consequence for headless mode: `nimbalyst-flows run` **refuses** agent nodes and
points at `compile`, which emits a slash command run by the user's own
authenticated Claude Code CLI.

## 6. Gates fail closed

A `human-gate` needs a person. In CI there isn't one, so a gate **fails** the run
unless `--approve-gates` is passed. Auto-approving by default would turn a
deliberate checkpoint into a no-op the first time a flow ran in CI.

## 7. Trust and consent stay with the host

- The backend module ships `enablement.default: "disabled"` with
  `promptOn: "firstUse"`, so native code runs only after the user consents.
- Flows never bypass workspace permission mode or trust level; they use the
  host's own services and IPC and inherit whatever the workspace already allows.
- Note for reviewers: extensions under `packages/extensions` are **built-in**,
  and `isBuiltinExtensionPath()` treats built-ins as the app's own trust domain
  — backend modules are auto-granted there. That is why flows enforces its own
  allowlist rather than relying on a host prompt to appear.

## 8. Run records

`.flow-runs/<run-id>.json` stores node status, outputs, session ids, timings and
usage. Node **outputs are included**, so a run record inherits the sensitivity of
whatever the flow produced — treat `.flow-runs/` like build output, and add it to
`.gitignore` if a flow handles anything sensitive.

## Checklist for a new node type or executor

- [ ] Does it take user text that reaches a shell, a URL, or a file path? Validate at the boundary that acts on it, not only at the edge that receives it.
- [ ] Can it be asked for a capability the client cannot honor? Fail, don't downgrade.
- [ ] Does it need a credential? Take an `${env:NAME}` reference; never a value.
- [ ] Does its failure message echo input? Report the shape, not the value.
- [ ] Is the enforcement tested at the process boundary, not just the caller?
