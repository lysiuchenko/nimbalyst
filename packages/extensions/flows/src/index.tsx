import type { ExtensionContext } from '@nimbalyst/extension-sdk';
import { FlowEditor } from './editor/FlowEditor';
import './styles.css';

export async function activate(_context: ExtensionContext): Promise<void> {
  // The flow editor is contributed declaratively through manifest.json; there is
  // nothing to register imperatively. Flows are local-only files, so this
  // extension deliberately registers no collaboration codec.
}

export async function deactivate(): Promise<void> {
  // No host registrations to tear down.
}

export const components = {
  FlowEditor,
};

export type { Flow, FlowEdge, FlowNode, NodeType } from './schema/types';
export { parseFlowFile, serializeFlow, validateFlow } from './schema/validate';
