import type { ExtensionContext } from '@nimbalyst/extension-sdk';
import { FlowEditor } from './editor/FlowEditor';
import { rememberHostServices } from './host/hostServices';
import './styles.css';

export async function activate(context: ExtensionContext): Promise<void> {
  // The editor is contributed declaratively through manifest.json, but running a
  // flow needs `services.ai` and `services.filesystem`, and EditorHost exposes
  // neither — so keep the activation context for the canvas to use.
  // Flows are local-only files: no collaboration codec is registered.
  rememberHostServices(context);
}

export async function deactivate(): Promise<void> {
  // No host registrations to tear down.
}

export const components = {
  FlowEditor,
};

export type { Flow, FlowEdge, FlowNode, NodeType } from './schema/types';
export { parseFlowFile, serializeFlow, validateFlow } from './schema/validate';
