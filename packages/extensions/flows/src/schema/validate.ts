import {
  NODE_TYPES,
  type Flow,
  type FlowEdge,
  type FlowNode,
  type NodeType,
  type ValidationError,
  type ValidationResult,
} from './types';

/** The field each node type cannot do without, and the fields it may also carry. */
const NODE_SHAPES: Record<NodeType, { required: string; optional: readonly string[] }> = {
  agent: { required: 'prompt', optional: ['model', 'tools', 'worktree'] },
  'slash-command': { required: 'command', optional: ['args'] },
  skill: { required: 'skill', optional: ['input'] },
  shell: { required: 'run', optional: ['cwd'] },
  'human-gate': { required: 'message', optional: [] },
};

/**
 * Credential shapes a `.flow.json` must never contain.
 *
 * Flow files are committed and shared, so a pasted key would be leaked by the
 * act of saving. A flow names a credential with `${env:NAME}` and lets the host
 * resolve it; it never carries the value.
 */
const CREDENTIAL_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'an Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9-]{20,}/ },
  { label: 'an OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { label: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { label: 'an AWS access key id', pattern: /\bAKIA[A-Z0-9]{12,}/ },
  { label: 'a private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** Reports the kind of credential found, never the value itself. */
function credentialIn(value: string): string | undefined {
  return CREDENTIAL_PATTERNS.find(({ pattern }) => pattern.test(value))?.label;
}

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate an already-parsed `.flow.json` document.
 *
 * Every problem is reported, not just the first, so the editor can show a
 * complete list rather than making the user fix errors one save at a time.
 */
export function validateFlow(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  if (!isPlainObject(input)) {
    return { valid: false, errors: [{ path: '', message: 'flow must be a JSON object' }] };
  }

  if (input.version !== 1) {
    fail('version', `version must be 1, got ${JSON.stringify(input.version)}`);
  }
  if (!isNonEmptyString(input.name)) {
    fail('name', 'name must be a non-empty string');
  }

  const nodes = validateNodes(input.nodes, fail);
  const edges = validateEdges(input.edges, nodes, fail);
  const variables = validateVariables(input.variables, fail);

  if (edges) detectCycle(nodes ?? [], edges, fail);

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    flow: {
      version: 1,
      name: (input.name as string).trim(),
      nodes: nodes ?? [],
      edges: edges ?? [],
      variables,
    },
  };
}

type Fail = (path: string, message: string) => void;

/** Returns the normalized nodes, or `undefined` when `nodes` is not even an array. */
function validateNodes(raw: unknown, fail: Fail): FlowNode[] | undefined {
  if (!Array.isArray(raw)) {
    fail('nodes', 'nodes must be an array');
    return undefined;
  }

  const seen = new Set<string>();
  const nodes: FlowNode[] = [];

  raw.forEach((entry, index) => {
    const path = `nodes[${index}]`;
    if (!isPlainObject(entry)) {
      fail(path, 'node must be an object');
      return;
    }

    if (!isNonEmptyString(entry.id)) {
      fail(`${path}.id`, 'node id must be a non-empty string');
    } else if (seen.has(entry.id)) {
      fail(`${path}.id`, `duplicate node id ${JSON.stringify(entry.id)}`);
    } else {
      seen.add(entry.id);
    }

    const type = entry.type;
    if (!isNodeType(type)) {
      fail(
        `${path}.type`,
        `unknown node type ${JSON.stringify(type)}, expected one of: ${NODE_TYPES.join(', ')}`
      );
      return;
    }

    const node = validateNodeBody(entry, type, path, fail);
    if (node) nodes.push(node);
  });

  return nodes;
}

function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

function validateNodeBody(entry: Json, type: NodeType, path: string, fail: Fail): FlowNode | null {
  const { required } = NODE_SHAPES[type];
  const requiredValue = entry[required];

  if (!isNonEmptyString(requiredValue)) {
    fail(`${path}.${required}`, `${type} node requires a non-empty ${required}`);
  } else if (type === 'slash-command' && !requiredValue.startsWith('/')) {
    fail(
      `${path}.${required}`,
      `slash command must start with "/", got ${JSON.stringify(requiredValue)}`
    );
  }

  for (const [key, value] of Object.entries(entry)) {
    if (typeof value !== 'string') continue;
    const credential = credentialIn(value);
    if (credential) {
      fail(
        `${path}.${key}`,
        `value looks like a credential (${credential}); reference it as \${env:NAME} instead of storing it in the flow`
      );
    }
  }

  if (entry.label !== undefined && !isNonEmptyString(entry.label)) {
    fail(`${path}.label`, 'label must be a non-empty string when present');
  }
  if (entry.output !== undefined && !isNonEmptyString(entry.output)) {
    fail(`${path}.output`, 'output must be a non-empty string when present');
  }
  if (entry.position !== undefined && !isPosition(entry.position)) {
    fail(`${path}.position`, 'position must be { x: number, y: number }');
  }
  if (type === 'agent' && entry.tools !== undefined && !isStringArray(entry.tools)) {
    fail(`${path}.tools`, 'tools must be an array of strings');
  }

  const node: Json = { id: entry.id, type };
  for (const key of ['label', required, ...NODE_SHAPES[type].optional, 'output', 'position']) {
    if (entry[key] !== undefined) node[key] = entry[key];
  }

  return node as unknown as FlowNode;
}

function isPosition(value: unknown): boolean {
  return isPlainObject(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Returns the normalized edges, or `undefined` when `edges` is not even an array. */
function validateEdges(raw: unknown, nodes: FlowNode[] | undefined, fail: Fail): FlowEdge[] | undefined {
  if (!Array.isArray(raw)) {
    fail('edges', 'edges must be an array');
    return undefined;
  }

  const byId = new Map((nodes ?? []).map((node) => [node.id, node]));
  const edges: FlowEdge[] = [];

  raw.forEach((entry, index) => {
    const path = `edges[${index}]`;
    if (!isPlainObject(entry)) {
      fail(path, 'edge must be an object');
      return;
    }

    let resolved = true;
    for (const end of ['from', 'to'] as const) {
      const id = entry[end];
      if (!isNonEmptyString(id)) {
        fail(`${path}.${end}`, `edge ${end} must be a non-empty string`);
        resolved = false;
      } else if (!byId.has(id)) {
        fail(`${path}.${end}`, `edge references unknown node ${JSON.stringify(id)}`);
        resolved = false;
      }
    }
    if (!resolved) return;

    if (entry.from === entry.to) {
      fail(path, `node ${JSON.stringify(entry.from)} cannot connect to itself`);
      return;
    }

    if (entry.port !== undefined) {
      const source = byId.get(entry.from as string);
      if (!isNonEmptyString(entry.port)) {
        fail(`${path}.port`, 'port must be a non-empty string when present');
        return;
      }
      if (source?.output !== entry.port) {
        fail(
          `${path}.port`,
          `node ${JSON.stringify(entry.from)} does not declare an output named ${JSON.stringify(entry.port)}`
        );
        return;
      }
    }

    const edge: FlowEdge = { from: entry.from as string, to: entry.to as string };
    if (entry.port !== undefined) edge.port = entry.port as string;
    edges.push(edge);
  });

  return edges;
}

function validateVariables(raw: unknown, fail: Fail): Record<string, string> {
  if (raw === undefined) return {};
  if (!isPlainObject(raw)) {
    fail('variables', 'variables must be an object');
    return {};
  }

  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') {
      fail(`variables.${key}`, 'variable values must be strings');
      continue;
    }
    const credential = credentialIn(value);
    if (credential) {
      fail(
        `variables.${key}`,
        `value looks like a credential (${credential}); reference it as \${env:NAME} instead of storing it in the flow`
      );
      continue;
    }
    variables[key] = value;
  }
  return variables;
}

/**
 * Depth-first cycle detection. Reports the first cycle found as the path that
 * closes it (`a -> b -> a`), which is what a user needs to break it.
 */
function detectCycle(nodes: FlowNode[], edges: FlowEdge[], fail: Fail): void {
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) outgoing.set(node.id, []);
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);

  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'visiting') {
      return [...stack.slice(stack.indexOf(id)), id];
    }

    state.set(id, 'visiting');
    stack.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle) {
      fail('edges', `flow contains a cycle: ${cycle.join(' -> ')}`);
      return;
    }
  }
}

/** Parse `.flow.json` text. Malformed JSON is a validation error, never a throw. */
export function parseFlowFile(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, errors: [{ path: '', message: `not valid JSON: ${message}` }] };
  }
  return validateFlow(parsed);
}

const NODE_KEY_ORDER = ['id', 'type', 'label', 'prompt', 'command', 'skill', 'run', 'message'];
const NODE_TAIL_KEY_ORDER = ['model', 'tools', 'worktree', 'args', 'input', 'cwd', 'output', 'position'];

/**
 * Serialize a flow with a canonical key order, so saving from the canvas
 * produces a stable diff instead of reshuffling the file every time.
 */
export function serializeFlow(flow: Flow): string {
  const document = {
    version: flow.version,
    name: flow.name,
    nodes: flow.nodes.map((node) => orderKeys(node as unknown as Json, [...NODE_KEY_ORDER, ...NODE_TAIL_KEY_ORDER])),
    edges: flow.edges.map((edge) => orderKeys(edge as unknown as Json, ['from', 'to', 'port'])),
    variables: flow.variables ?? {},
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

function orderKeys(value: Json, order: string[]): Json {
  const ordered: Json = {};
  for (const key of order) {
    if (value[key] !== undefined) ordered[key] = value[key];
  }
  // Anything the schema does not know about still round-trips rather than being
  // silently dropped on save.
  for (const key of Object.keys(value)) {
    if (!(key in ordered) && value[key] !== undefined) ordered[key] = value[key];
  }
  return ordered;
}
