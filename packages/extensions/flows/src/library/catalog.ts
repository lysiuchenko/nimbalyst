import type { Flow } from '../schema/types';

/**
 * The flow library: proven, complete flows compiled into the extension.
 *
 * Curated in code rather than fetched — no network, no supply-chain surface —
 * and every entry must pass `validateFlow`, which the catalog unit test
 * enforces by looping this list. An invalid library flow cannot ship.
 */
export interface LibraryEntry {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** What the workspace must provide, shown on the card. */
  needs: string[];
  flow: Flow;
}

/** `<id>.flow.json`, walking -2, -3… when the workspace already has one. */
export function uniqueFlowFileName(id: string, existing: Set<string>): string {
  let candidate = `${id}.flow.json`;
  for (let n = 2; existing.has(candidate); n += 1) candidate = `${id}-${n}.flow.json`;
  return candidate;
}

export const LIBRARY_FLOWS: LibraryEntry[] = [
  {
    id: 'pr-review',
    title: 'PR review',
    description:
      'Reviews every changed file in parallel, runs a security pass, writes one report, and asks before publishing it.',
    icon: 'rate_review',
    needs: ['skill: security-review', 'skill: review-report'],
    flow: {
      version: 1,
      name: 'PR review',
      variables: { base: 'main' },
      manualBaselineMinutes: 45,
      nodes: [
        { id: 'scope', type: 'shell', label: 'What changed', run: 'git diff {{base}}...HEAD --stat', output: 'stat', position: { x: 0, y: 0 } },
        { id: 'files', type: 'shell', label: 'Changed files', run: 'git diff {{base}}...HEAD --name-only', output: 'list', position: { x: 0, y: 160 } },
        { id: 'commits', type: 'shell', label: 'Commit log', run: 'git log {{base}}..HEAD --oneline', output: 'log', position: { x: 0, y: 320 } },
        {
          id: 'review', type: 'fan-out', label: 'Review each file',
          prompt:
            'You are reviewing one file of a pull request against the {{base}} branch.\n\nFile: {{item}}\n\nOverall shape of the PR for context:\n{{scope.stat}}\n\nFirst run `git diff {{base}}...HEAD -- {{item}}` to see exactly what changed, then read enough of the surrounding code to judge it. Report only findings a reviewer would act on: correctness bugs, security issues, missing error handling, breaking API changes, dead code, tests that assert nothing.\n\nFor each finding give file:line, a severity (blocker / major / minor), the problem in one sentence, and the fix in one sentence. If the change is clean, say "No findings" plus one sentence on what the change does. Do not restyle code, do not praise.',
          tools: ['Read', 'Grep', 'Glob', 'Bash'], over: '{{files.list}}', concurrency: 3, output: 'findings', position: { x: 320, y: 40 },
        },
        {
          id: 'security', type: 'skill', label: 'Security pass', skill: 'security-review',
          input:
            'Review this pull request diff for authentication, authorisation and input-validation weaknesses. Run `git diff {{base}}...HEAD` yourself to read the full change.\n\nShape of the change:\n{{scope.stat}}\n\nChanged files:\n{{files.list}}',
          output: 'security_md', position: { x: 320, y: 280 },
        },
        {
          id: 'report', type: 'skill', label: 'Write the report', skill: 'review-report',
          input:
            'Commits under review:\n{{commits.log}}\n\nPer-file findings:\n{{review.findings}}\n\nSecurity pass:\n{{security.security_md}}',
          output: 'report_md', position: { x: 640, y: 160 },
        },
        { id: 'publish_gate', type: 'human-gate', label: 'Publish?', message: 'The review report is drafted. Publish it to PR_REVIEW.md?', position: { x: 960, y: 160 } },
        { id: 'publish', type: 'write-file', label: 'Publish the review', path: 'PR_REVIEW.md', content: '{{report.report_md}}', position: { x: 1280, y: 60 } },
        {
          id: 'draft', type: 'write-file', label: 'Keep as draft', path: 'PR_REVIEW_DRAFT.md',
          content: '> Not published: {{publish_gate.error}}\n> Edit and re-run, or publish by hand.\n\n{{report.report_md}}',
          position: { x: 1280, y: 280 },
        },
      ],
      edges: [
        { from: 'scope', to: 'review', port: 'stat' },
        { from: 'files', to: 'review', port: 'list' },
        { from: 'scope', to: 'security' },
        { from: 'files', to: 'security' },
        { from: 'commits', to: 'report', port: 'log' },
        { from: 'review', to: 'report', port: 'findings' },
        { from: 'security', to: 'report', port: 'security_md' },
        { from: 'report', to: 'publish_gate' },
        { from: 'publish_gate', to: 'publish' },
        { from: 'publish_gate', to: 'draft', on: 'failure' },
      ],
    } as unknown as Flow,
  },
  {
    id: 'bugfix',
    title: 'Bug fix, full cycle',
    description:
      'Ticket in: triage, smallest fix with a test, suite run with self-repair, per-file review, sign-off gate, report out.',
    icon: 'bug_report',
    needs: ['skill: review-report'],
    flow: {
      version: 1,
      name: 'Bug fix, full cycle',
      variables: { ticket: 'Paste the bug ticket here: id, summary, steps to reproduce, expected vs actual.' },
      manualBaselineMinutes: 120,
      nodes: [
        {
          id: 'triage', type: 'agent', label: 'Triage',
          prompt:
            'You are triaging a bug report in this repository.\n\nTicket:\n{{ticket}}\n\nReproduce it if you can, locate the fault, and write a triage note with exactly these sections:\n\n## Root cause\nfile:line and the mechanism, or your best-supported hypothesis clearly marked as one.\n\n## Fix plan\nThe files to touch and the change to make, small as possible.\n\n## How to verify\nThe command or steps that prove the fix, including which test should cover it.\n\nInvestigate with the tools; do not guess where reading would answer. Do not change any file at this stage.',
          tools: ['Read', 'Grep', 'Glob', 'Bash'], output: 'triage_md', position: { x: 0, y: 0 },
        },
        {
          id: 'fix', type: 'agent', label: 'Implement the fix',
          prompt:
            'Implement this fix plan in the working tree:\n\n{{triage.triage_md}}\n\nRules:\n- Smallest change that fixes the root cause; no drive-by refactors.\n- Add or extend a test that fails without your change and passes with it.\n- Do not commit; leave the change in the working tree for review.\n\nWhen done, summarise: what changed, why, and which test now covers it.',
          output: 'fix_md', position: { x: 300, y: 0 },
        },
        {
          id: 'verify', type: 'agent', label: 'Run tests, repair if red',
          prompt:
            "The working tree carries this fix:\n\n{{fix.fix_md}}\n\nRun the project's test suite. If anything fails, repair the fix (not the tests, unless a test is genuinely asserting the old broken behaviour) and run again, until green or until you are certain the failure is pre-existing on the base branch — prove that with `git stash`/`git stash pop` around a re-run if needed.\n\nReport: the final test command and result, what you had to repair, and any pre-existing failures you excluded with evidence.",
          tools: ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'], output: 'verify_md', position: { x: 600, y: 0 },
        },
        { id: 'files', type: 'shell', label: 'Changed files', run: 'git diff HEAD --name-only', output: 'list', position: { x: 900, y: 0 } },
        {
          id: 'review', type: 'fan-out', label: 'Review each file',
          prompt:
            'You are reviewing one file of an uncommitted bug fix.\n\nFile: {{item}}\n\nThe triage that motivated it:\n{{triage.triage_md}}\n\nRun `git diff HEAD -- {{item}}` to see the change, and read enough surrounding code to judge it. Check specifically: does the change match the stated root cause, could it regress anything sharing this code path, and does the new test actually fail without the fix? For each finding give file:line, severity (blocker / major / minor), the problem in one sentence, the fix in one sentence. If clean, say "No findings" plus one sentence on what the change does.',
          over: '{{files.list}}', concurrency: 3, tools: ['Read', 'Grep', 'Glob', 'Bash'], output: 'findings', position: { x: 900, y: 200 },
        },
        {
          id: 'report', type: 'skill', label: 'Write the report', skill: 'review-report',
          input:
            'This reviews an uncommitted bug fix.\n\nTicket:\n{{ticket}}\n\nTriage:\n{{triage.triage_md}}\n\nPer-file findings:\n{{review.findings}}',
          output: 'report_md', position: { x: 600, y: 300 },
        },
        { id: 'signoff', type: 'human-gate', label: 'Ship it?', message: 'Fix implemented, tests run, review written. Accept the fix and file the report?', position: { x: 300, y: 300 } },
        {
          id: 'publish', type: 'write-file', label: 'File the report', path: 'BUGFIX_REPORT.md',
          content: '{{report.report_md}}\n\n---\n\n## Verification\n\n{{verify.verify_md}}\n', position: { x: 0, y: 240 },
        },
        {
          id: 'parked', type: 'write-file', label: 'Park as draft', path: 'BUGFIX_DRAFT.md',
          content: '> Sign-off declined: {{signoff.error}}\n> The fix is still in the working tree — revise or `git checkout -- .` to drop it.\n\n{{report.report_md}}\n',
          position: { x: 0, y: 420 },
        },
      ],
      edges: [
        { from: 'triage', to: 'fix', port: 'triage_md' },
        { from: 'fix', to: 'verify', port: 'fix_md' },
        { from: 'verify', to: 'files' },
        { from: 'files', to: 'review', port: 'list' },
        { from: 'triage', to: 'review' },
        { from: 'review', to: 'report', port: 'findings' },
        { from: 'report', to: 'signoff' },
        { from: 'verify', to: 'signoff' },
        { from: 'signoff', to: 'publish' },
        { from: 'signoff', to: 'parked', on: 'failure' },
      ],
    } as unknown as Flow,
  },
  {
    id: 'release-notes',
    title: 'Release notes',
    description: 'Drafts notes from the recent commit log and asks before saving them.',
    icon: 'description',
    needs: [],
    flow: {
      version: 1,
      name: 'Release notes',
      variables: {},
      nodes: [
        { id: 'log', type: 'shell', label: 'Recent commits', run: 'git log --oneline -30', output: 'log', position: { x: 0, y: 0 } },
        { id: 'draft', type: 'agent', label: 'Draft the notes', prompt: 'Write release notes from:\n{{log.log}}\n\nGroup by feature, fixes, and internal changes; one line each; no hype.', output: 'notes', position: { x: 300, y: 0 } },
        { id: 'approve', type: 'human-gate', label: 'Publish?', message: 'Publish these notes to RELEASE_NOTES.md?', position: { x: 600, y: 0 } },
        { id: 'save', type: 'write-file', label: 'Save the notes', path: 'RELEASE_NOTES.md', content: '{{draft.notes}}', position: { x: 900, y: 0 } },
      ],
      edges: [
        { from: 'log', to: 'draft', port: 'log' },
        { from: 'draft', to: 'approve' },
        { from: 'approve', to: 'save' },
      ],
    } as unknown as Flow,
  },
  {
    id: 'codex-check',
    title: 'Codex handshake',
    description: 'A Claude step hands off to an OpenAI Codex step — the per-step provider feature, proven in one minute.',
    icon: 'swap_horiz',
    needs: ['OpenAI Codex CLI, signed in'],
    flow: {
      version: 1,
      name: 'Codex check',
      variables: {},
      nodes: [
        { id: 'claude', type: 'agent', label: 'Claude step', prompt: 'Reply with exactly the word READY and nothing else.', output: 'word', position: { x: 0, y: 0 } },
        { id: 'codex', type: 'agent', label: 'Codex step', provider: 'openai-codex', prompt: 'The previous step said: {{claude.word}}. Reply with exactly the word CONFIRMED and nothing else.', output: 'word', position: { x: 300, y: 0 } },
        { id: 'save', type: 'write-file', label: 'Record the handshake', path: 'CODEX_CHECK.md', content: 'claude: {{claude.word}}\ncodex: {{codex.word}}\n', position: { x: 600, y: 0 } },
      ],
      edges: [
        { from: 'claude', to: 'codex', port: 'word' },
        { from: 'codex', to: 'save', port: 'word' },
      ],
    } as unknown as Flow,
  },
  {
    id: 'jira-import',
    title: 'Jira import',
    description:
      'Pulls your open Jira items onto the tracker board — deduplicated by key, descriptions carried over. Pair it with the bug-fix flow.',
    icon: 'move_to_inbox',
    needs: ['Jira access: an MCP server, or JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN in the environment'],
    flow: {
      version: 1,
      name: 'Jira import',
      variables: { jql: 'assignee = currentUser() AND statusCategory != Done' },
      nodes: [
        {
          id: 'fetch', type: 'agent', label: 'Fetch open items',
          prompt:
            'Fetch the Jira issues matching this JQL: {{jql}}\n\nUse Jira MCP tools if this workspace has them; otherwise call the Jira REST API with curl using the JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN environment variables (never print the token). For every issue output one block:\n\nKEY | issue type | priority | summary\n<the description, as markdown>\n---\n\nIf Jira cannot be reached or nothing matches, reply with exactly NOTHING_TO_IMPORT and one sentence why.',
          output: 'items', position: { x: 0, y: 0 },
        },
        {
          id: 'board', type: 'agent', label: 'Create board items',
          prompt:
            'These Jira issues were fetched:\n\n{{fetch.items}}\n\nFor each block: first search the board with tracker_list for the Jira KEY; skip it if an item already carries that key. Otherwise call tracker_create — type "bug" for bug-shaped issues and "task" for everything else, title "[KEY] summary", label "jira", the description as the markdown body, ending with a link line back to the Jira issue. Reply with one line per issue, "created" or "skipped", then a final line "Imported N, skipped M." If the input says NOTHING_TO_IMPORT, create nothing and reply "Imported 0, skipped 0."',
          output: 'report', position: { x: 320, y: 0 },
        },
        {
          id: 'note', type: 'write-file', label: 'Leave the receipt',
          path: 'JIRA_IMPORT.md', content: '{{board.report}}', position: { x: 640, y: 0 },
        },
      ],
      edges: [
        { from: 'fetch', to: 'board', port: 'items' },
        { from: 'board', to: 'note', port: 'report' },
      ],
    } as unknown as Flow,
  },
  {
    id: 'docs-watcher',
    title: 'Docs watcher',
    description:
      'When docs change, rewrites a one-page index of them. Ships with the trigger disabled — enable it when ready.',
    icon: 'visibility',
    needs: [],
    flow: {
      version: 1,
      name: 'Docs watcher',
      variables: {},
      trigger: { type: 'file-change', glob: 'docs/**/*.md', debounceSeconds: 60, enabled: false },
      nodes: [
        { id: 'list', type: 'shell', label: 'The docs', run: 'ls docs', output: 'files', position: { x: 0, y: 0 } },
        {
          id: 'index', type: 'agent', label: 'Write the index',
          prompt:
            'These files live in docs/:\n{{list.files}}\n\nRead each one and write DOCS_INDEX content: for every doc, its title as a link and one sentence on when to read it. Nothing else.',
          tools: ['Read', 'Glob'], output: 'index_md', position: { x: 300, y: 0 },
        },
        { id: 'save', type: 'write-file', label: 'Save the index', path: 'DOCS_INDEX.md', content: '{{index.index_md}}', position: { x: 600, y: 0 } },
      ],
      edges: [
        { from: 'list', to: 'index', port: 'files' },
        { from: 'index', to: 'save', port: 'index_md' },
      ],
    } as unknown as Flow,
  },
];
