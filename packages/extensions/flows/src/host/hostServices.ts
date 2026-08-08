import type { ExtensionContext, ExtensionServices } from '@nimbalyst/extension-sdk';

/**
 * The services handed to `activate()`, kept for the editor to use later.
 *
 * `EditorHost` deliberately does not expose `services.ai` or
 * `services.filesystem`, so a custom editor that needs them has to pick them up
 * from activation. Held in one place rather than threaded through props, since
 * the editor is constructed by the host, not by us.
 */
let services: ExtensionServices | undefined;
let extensionPath: string | undefined;

export function rememberHostServices(context: ExtensionContext): void {
  services = context.services;
  extensionPath = context.extensionPath;
}

export function getHostServices(): ExtensionServices {
  if (!services) {
    throw new Error('flows extension is not activated yet');
  }
  return services;
}

export function hasHostServices(): boolean {
  return services !== undefined;
}

export function getExtensionPath(): string | undefined {
  return extensionPath;
}

/** Test seam — lets a test install fakes without running `activate`. */
export function __setHostServicesForTest(next: ExtensionServices | undefined): void {
  services = next;
}
