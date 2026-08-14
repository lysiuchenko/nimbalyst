import type { Flow, ValidationError } from '../schema/types';
import { serializeFlow, validateFlow } from '../schema/validate';

/**
 * Draft and edit flows from intent, guarded by the validator.
 *
 * The model never touches the canvas: its JSON passes `validateFlow` — the
 * same gate every hand-written flow passes — and an invalid draft goes back to
 * it once, as the validator's own precise error list. Still invalid after the
 * repair → the caller gets the errors and the canvas stays untouched. The
 * failure mode is a message, never a broken document.
 */

/** The one host capability the loop needs, injected for testability. */
export interface DraftModel {
  sendPrompt(options: {
    prompt: string;
    sessionName?: string;
    provider?: 'claude-code';
    mode?: 'agent';
    suppressTurnNotification?: boolean;
  }): Promise<{ sessionId: string; response: string }>;
}

export type DraftResult = { flow: Flow } | { errors: ValidationError[] };

/**
 * The schema, taught compactly. Kept in one place so the draft and edit
 * prompts cannot drift apart.
 */
const SCHEMA_GUIDE = `A flow is JSON: {"version":1,"name":string,"nodes":[...],"edges":[...],"variables":{name:defaultValue}}.

Node types (each needs "id", unique):
- {"type":"shell","run":"one allowlisted command (npm,npx,node,git,echo,ls,pwd,cat) — no pipes or && chaining","output":"portName"?}
- {"type":"agent","prompt":"what the agent should do","output":"portName"?,"model":null?,"provider":"claude-code"|"openai-codex"|"copilot-cli"?,"tools":["Read","Grep","Glob","Bash"]?,"worktree":true?,"retries":1-5?}  — never combine "tools" with a provider other than claude-code
- {"type":"fan-out","prompt":"per-item prompt using {{item}}","over":"{{ref}} or literal list, one item per line","concurrency":number?,"worktree":true? — one sub-agent per item, in parallel}
- {"type":"skill","skill":"name from .claude/skills","input":"text"?,"output":"portName"?}
- {"type":"slash-command","command":"/name","args":"text"?}
- {"type":"human-gate","message":"the question a person must answer"} — use before anything irreversible
- {"type":"write-file","path":"workspace-relative, never absolute, never .git","content":"usually a {{ref}}"} — how a flow produces an artifact

Edges: {"from":id,"to":id,"port":"the from-node's output name"?,"on":"failure"? — routes a failed step (a rejected gate included) to a handler,"when":"{{from.port}} contains|==|!= \\"literal\\""? — data-driven routing}.
A node with several incoming edges waits for all of them; give it "join":"any" to run on the first live branch (how a conditional fork rejoins). In text fields, {{node.port}} reads an upstream output, {{variable}} reads a variable, {{a.x ?? b.y ?? "fallback"}} takes the first that exists; a failed node publishes {{node.error}}.

Rules: never put secrets in the flow — name them \${env:NAME}. Prefer small flows with a human-gate before publishing or destructive steps. Omit "position"; the editor lays nodes out.`;

const EXAMPLE = `{"version":1,"name":"Release notes","nodes":[{"id":"log","type":"shell","run":"git log --oneline -30","output":"log"},{"id":"draft","type":"agent","prompt":"Write release notes from:\\n{{log.log}}","output":"notes"},{"id":"approve","type":"human-gate","message":"Publish these notes?"},{"id":"save","type":"write-file","path":"RELEASE_NOTES.md","content":"{{draft.notes}}"}],"edges":[{"from":"log","to":"draft","port":"log"},{"from":"draft","to":"approve"},{"from":"approve","to":"save"}],"variables":{}}`;

/** Pull the JSON out of a reply that may wrap it in fences or prose. */
export function extractJson(response: string): string {
  const fenced = response.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const start = response.indexOf('{');
  const end = response.lastIndexOf('}');
  if (start !== -1 && end > start) return response.slice(start, end + 1);
  return response.trim();
}

export async function draftFlow(model: DraftModel, description: string): Promise<DraftResult> {
  const prompt =
    `Design a Nimbalyst flow for this request:\n\n${description}\n\n${SCHEMA_GUIDE}\n\n` +
    `Example of the exact output format:\n${EXAMPLE}\n\n` +
    `Reply with ONLY the flow JSON. No explanation, no markdown.`;
  return generate(model, prompt, `Flow drafting`);
}

export async function editFlow(
  model: DraftModel,
  current: Flow,
  instruction: string
): Promise<DraftResult> {
  const prompt =
    `Here is an existing Nimbalyst flow:\n\n${serializeFlow(current)}\n\n` +
    `Apply this change:\n\n${instruction}\n\n${SCHEMA_GUIDE}\n\n` +
    `Reply with ONLY the complete updated flow JSON. Keep everything the change does not touch, including node positions. No explanation, no markdown.`;
  return generate(model, prompt, `Flow editing`);
}

async function generate(
  model: DraftModel,
  prompt: string,
  sessionName: string
): Promise<DraftResult> {
  let attempt = await askAndValidate(model, prompt, sessionName);
  if ('flow' in attempt) return attempt;

  // One repair turn: the validator's own error list is the best prompt there is.
  const repair =
    `${prompt}\n\nYour previous attempt was rejected by the validator:\n` +
    attempt.errors.map((error) => `- ${error.path}: ${error.message}`).join('\n') +
    `\n\nFix every listed problem and reply with ONLY the corrected flow JSON.`;
  attempt = await askAndValidate(model, repair, sessionName);
  return attempt;
}

async function askAndValidate(
  model: DraftModel,
  prompt: string,
  sessionName: string
): Promise<DraftResult> {
  const { response } = await model.sendPrompt({
    prompt,
    sessionName,
    provider: 'claude-code',
    mode: 'agent',
    suppressTurnNotification: true,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(response));
  } catch {
    return { errors: [{ path: '', message: 'the reply was not valid JSON' }] };
  }

  const result = validateFlow(parsed);
  return result.valid ? { flow: result.flow } : { errors: result.errors };
}
