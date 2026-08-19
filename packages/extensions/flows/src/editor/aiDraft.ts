import type { Flow, ValidationError } from '../schema/types';
import { NODE_TYPES, type NodeType } from '../schema/types';
import { serializeFlow, validateFlow } from '../schema/validate';
import { LIBRARY_FLOWS } from '../library/catalog';

/**
 * Draft and edit flows from intent, guarded by the validator.
 *
 * The model never touches the canvas: its JSON passes `validateFlow` — the
 * same gate every hand-written flow passes — and an invalid draft goes back to
 * it, as the validator's own precise error list, for up to MAX_REPAIR_TURNS
 * corrections. Still invalid after the budget is spent → the caller gets the
 * errors and the canvas stays untouched. The failure mode is a message, never
 * a broken document.
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

/** The field each palette type cannot do without. Record<NodeType> makes a
 *  new node type a compile error until its required fields are declared —
 *  the guide cannot silently omit a type. */
const REQUIRED_FIELDS: Record<NodeType, readonly string[]> = {
  agent: ['prompt'],
  'fan-out': ['prompt', 'over'],
  'slash-command': ['command'],
  skill: ['skill'],
  shell: ['run'],
  'human-gate': ['message'],
  'write-file': ['path', 'content'],
};

/** The commonly useful optional fields per type, shown so the model knows the
 *  levers exist. Not an invariant — informational only. */
const OPTIONAL_FIELDS: Record<NodeType, readonly string[]> = {
  agent: ['model', 'provider', 'effortLevel', 'tools', 'worktree', 'retries', 'output'],
  'fan-out': ['concurrency', 'model', 'provider', 'effortLevel', 'tools', 'worktree', 'output'],
  'slash-command': ['args'],
  skill: ['input', 'output'],
  shell: ['cwd', 'output'],
  'human-gate': [],
  'write-file': [],
};

/** Semantic rules that are not derivable from the palette (edge routing,
 *  interpolation, the no-secrets rule). Hand-written on purpose — these are
 *  behavior, not the shape that drifts. */
const SEMANTIC_RULES = `Edges: {"from":id,"to":id,"port":"the from-node's output name"?,"on":"failure"? — routes a failed step to a handler,"when":"{{from.port}} contains|==|!= \\"literal\\""? — data-driven routing}. Every edge "from"/"to" must reference a declared node "id". A node with several incoming edges waits for all of them; give it "join":"any" to run on the first live branch. In text fields {{node.port}} reads an upstream output, {{variable}} reads a variable, {{a.x ?? b.y ?? "fallback"}} takes the first that exists; a failed node publishes {{node.error}}.

Rules: emit ONLY node types from the palette above. Never put secrets in the flow — name them \${env:NAME}. Prefer small flows with a human-gate before publishing or destructive steps. Omit "position"; the editor lays nodes out. A shell "run" must be a single allowlisted command (npm, npx, node, git, echo, ls, pwd, cat) — no pipes or && chaining.`;

/** One real, validated flow from the library, serialized as few-shot. Real
 *  flows are stronger anchors than a toy inline example. */
function fewShot(id: string): string {
  const entry = LIBRARY_FLOWS.find((f) => f.id === id);
  if (!entry) throw new Error(`fewShot: no LIBRARY_FLOWS entry "${id}"`);
  return serializeFlow(entry.flow);
}

/**
 * The schema, taught from the real registry so draft and edit prompts cannot
 * drift from `NODE_TYPES`/`FlowNode`. A new node type appears here automatically.
 */
export function buildSchemaGuide(): string {
  const palette = NODE_TYPES.map((type) => {
    const req = REQUIRED_FIELDS[type].map((f) => `"${f}"`).join(', ');
    const opt = OPTIONAL_FIELDS[type].map((f) => `"${f}"`).join(', ');
    const optClause = opt ? ` — optional: ${opt}` : '';
    return `- "${type}": requires "id"${req ? `, ${req}` : ''}${optClause}`;
  }).join('\n');

  return `A flow is JSON: {"version":1,"name":string,"nodes":[...],"edges":[...],"variables":{name:defaultValue}}.

Node types (the entire palette — emit only these; each node needs a unique "id"):
${palette}

${SEMANTIC_RULES}

Examples of real, valid flows in the exact output format:
${fewShot('pr-review')}

${fewShot('release-notes')}`;
}

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
    `Design a Nimbalyst flow for this request:\n\n${description}\n\n${buildSchemaGuide()}\n\n` +
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
    `Apply this change:\n\n${instruction}\n\n${buildSchemaGuide()}\n\n` +
    `Reply with ONLY the complete updated flow JSON. Keep everything the change does not touch, including node positions. No explanation, no markdown.`;
  return generate(model, prompt, `Flow editing`);
}

const MAX_REPAIR_TURNS = 3;

async function generate(
  model: DraftModel,
  prompt: string,
  sessionName: string
): Promise<DraftResult> {
  // Turn 0 drafts; turns 1..MAX_REPAIR_TURNS feed the validator's own error
  // list back — the best repair prompt there is — until valid or budget spent.
  let attempt = await askAndValidate(model, prompt, sessionName);
  for (let turn = 1; turn <= MAX_REPAIR_TURNS && !('flow' in attempt); turn += 1) {
    const repair =
      `${prompt}\n\nYour previous attempt was rejected by the validator:\n` +
      attempt.errors.map((error) => `- ${error.path}: ${error.message}`).join('\n') +
      `\n\nFix every listed problem and reply with ONLY the corrected flow JSON.`;
    attempt = await askAndValidate(model, repair, sessionName);
  }
  return attempt; // on exhaustion this is the last validator errors — unchanged contract
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
