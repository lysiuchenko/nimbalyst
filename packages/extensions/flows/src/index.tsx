import type { ExtensionContext } from '@nimbalyst/extension-sdk';
import { FlowEditor } from './editor/FlowEditor';
import { FlowsDashboard } from './dashboard/FlowsDashboard';
import { rememberHostServices } from './host/hostServices';
import { startScheduler } from './schedule/startScheduler';
import type { FlowScheduler } from './schedule/FlowScheduler';
import './styles.css';

export async function activate(context: ExtensionContext): Promise<void> {
  // The editor is contributed declaratively through manifest.json, but running a
  // flow needs `services.ai` and `services.filesystem`, and EditorHost exposes
  // neither — so keep the activation context for the canvas to use.
  // Flows are local-only files: no collaboration codec is registered.
  rememberHostServices(context);

  // Flows that carry a schedule fire from here. Agent nodes cannot run
  // headlessly, so the app being open is what makes a scheduled run possible.
  scheduler = startScheduler(context);
}

let scheduler: FlowScheduler | null = null;

export async function deactivate(): Promise<void> {
  scheduler?.stop();
  scheduler = null;
}

export const components = {
  FlowEditor,
};

/** Full-screen dashboard, reached from its own gutter button. */
export const panels = {
  dashboard: { component: FlowsDashboard },
};

export type { Flow, FlowEdge, FlowNode, NodeType } from './schema/types';
export { parseFlowFile, serializeFlow, validateFlow } from './schema/validate';
