# Launch from anywhere, and see what fan-out actually built

**Date:** 2026-08-12
**Status:** design
**Scope:** `packages/extensions/flows` only. No core change — both features ride
on host surfaces that already exist.

## Item 1 — open Flows from anywhere (`ctrl+shift+l`)

The audit asked for command-palette contributions. Measured against the host:
there is no command palette for extension commands, and no SDK surface for an
extension to register a command *handler* — `contributions.commands` is
declarative only. What the host **does** consume is `contributions.keybindings`
(`useExtensionKeybindings` reads every loaded manifest), and `PanelRegistry`
auto-registers a `<panelId>.toggle` command for every panel.

So the honest extension-side maximum is one manifest entry:

```json
{ "key": "ctrl+shift+l", "command": "com.nimbalyst.flows.dashboard.toggle" }
```

Combined with the Run buttons that just shipped, this completes "launch a flow
from anywhere": hotkey → Flows home → Run on a row. The binding also appears in
the host's keyboard-shortcuts dialog automatically, because that dialog reads
the same registry. `ctrl+shift+g` (git) is the only extension binding taken;
`ctrl+shift+l` collides with nothing found in the shortcuts dialog.

A palette entry and file-tree context menu remain host gaps, out of extension
reach — recorded here rather than worked around.

## Item 2 — the worktree review surface

Fan-out with `worktree: true` creates one isolated branch per sub-agent — and
then loses them. `createWorktree` returns `{id, path, branch}` and the client
uses only `id`, so the record never learns the branch existed. After the run,
the most impressive thing the runner does is invisible.

### Record it

`AgentRunResult` gains `worktree?: {id, branch, path}`; the client returns what
it created. The fan-out executor stamps it on each child (`ChildProgress`), the
agent executor returns it for single nodes (`NodeExecutorResult`), and the DAG
executor copies it onto the `NodeExecution` — so it lands in the run record and
survives the app closing.

### Show it

In a run's expanded detail, every node or sub-agent that ran in a worktree gets
a **branch chip**. Clicking the chip asks `worktree:get-status` (host IPC that
already exists, backed by `GitWorktreeService`) and shows what a reviewer
actually wants to know: modified files, commits ahead, merged or not. Fetched
on demand, not on expand — a run detail with eight branches must not fire eight
git status calls the moment it opens.

A worktree that has since been deleted degrades to the branch name with "status
unavailable" — the record outlives the checkout, and the chip must not lie
about that.

### Honest limits

This shows the branches; it does not merge or delete them. Merging is a
decision with conflicts and review attached — a button that "just merges" would
be the permission-system bypass the security model forbids by another name.
The chip's job is to make the work *findable*: branch name on screen, status a
click away, session one more.

## Tests

Item 1: e2e — the shortcut toggles the panel open and closed.
Item 2: unit — the client returns the worktree it made; fan-out stamps children;
the agent path stamps the execution; the DAG copies it into state. E2E — a
seeded record with worktree-bearing children renders branch chips, and the
status degrade path shows "unavailable" rather than nothing.
