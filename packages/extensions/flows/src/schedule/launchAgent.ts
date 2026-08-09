import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/** Reverse-DNS label prefix, per the launchd convention. */
export const LAUNCH_AGENT_LABEL = 'com.nimbalyst.flows.schedule';

export interface LaunchAgentOptions {
  /** Repository the agent runs the scheduler in. */
  workspace: string;
  /** Absolute path to the built `nimbalyst-flows` CLI. */
  cliPath: string;
  /** Absolute path to the node binary launchd should use. */
  nodePath: string;
  /** How often launchd wakes the scheduler. */
  everyMinutes: number;
}

/** One agent per workspace, so two repositories do not overwrite each other. */
export function labelFor(workspace: string): string {
  const digest = createHash('sha256').update(workspace).digest('hex').slice(0, 8);
  return `${LAUNCH_AGENT_LABEL}.${digest}`;
}

export function launchAgentPath(workspace: string): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${labelFor(workspace)}.plist`);
}

export function logPathFor(workspace: string): string {
  return path.join(os.homedir(), 'Library', 'Logs', `${labelFor(workspace)}.log`);
}

/** launchd reads these as XML, so a path containing `&` or `<` must be escaped. */
function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * A launchd agent that runs due flows while Nimbalyst is closed.
 *
 * `RunAtLoad` is deliberately false: loading the agent — which happens at every
 * login — would otherwise fire every overdue flow at once, which is the same
 * backlog problem the 12-hour catch-up window exists to avoid.
 */
export function launchAgentPlist(options: LaunchAgentOptions): string {
  const label = labelFor(options.workspace);
  const log = logPathFor(options.workspace);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(options.nodePath)}</string>
    <string>${xml(options.cliPath)}</string>
    <string>schedule</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(options.workspace)}</string>
  <key>StartInterval</key>
  <integer>${Math.max(60, Math.round(options.everyMinutes * 60))}</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}
