import { labelFor, launchAgentPlist, logPathFor } from './launchAgent';

export interface InstallOptions {
  /** Repository the scheduler runs in. */
  workspace: string;
  /** Absolute path to the built `nimbalyst-flows` CLI. */
  cliPath: string;
  /** Absolute path to the node binary the OS scheduler should use. */
  nodePath: string;
  everyMinutes: number;
  /** Home directory; injected so the plan is testable off-platform. */
  home: string;
}

export interface InstallPlan {
  /** Files to write before running any command. */
  files: { path: string; content: string }[];
  /** Argv arrays, never shell strings — no quoting to get wrong. */
  commands: string[][];
  /** What to tell the user afterwards. */
  summary: string;
}

export interface UninstallPlan {
  commands: string[][];
  remove: string[];
  summary: string;
}

/** POSIX-ish join; the plan is built for the target OS, not the current one. */
function join(...parts: string[]): string {
  const separator = parts[0].includes('\\') && !parts[0].startsWith('/') ? '\\' : '/';
  return parts.join(separator).replace(/([^:])[\\/]{2,}/g, `$1${separator}`);
}

function unitName(workspace: string): string {
  return `nimbalyst-flows-${labelFor(workspace).split('.').pop()}`;
}

/**
 * How each platform is asked to run the scheduler on a timer.
 *
 * Every plan is data — files plus argv arrays — rather than code that runs
 * immediately, so all three can be asserted on any machine and printed with
 * `schedule install --print` before anything touches the system.
 */
export function installPlanFor(platform: NodeJS.Platform, options: InstallOptions): InstallPlan {
  if (platform === 'darwin') return macosPlan(options);
  if (platform === 'linux') return linuxPlan(options);
  if (platform === 'win32') return windowsPlan(options);

  return {
    files: [],
    commands: [],
    summary:
      `Scheduling while the app is closed is not supported on ${platform}. ` +
      `Run \`nimbalyst-flows schedule run\` from your own cron or task runner instead.`,
  };
}

export function uninstallPlanFor(
  platform: NodeJS.Platform,
  options: InstallOptions
): UninstallPlan {
  const name = unitName(options.workspace);

  if (platform === 'darwin') {
    const target = join(options.home, 'Library', 'LaunchAgents', `${labelFor(options.workspace)}.plist`);
    return {
      commands: [['launchctl', 'bootout', `gui/\${UID}/${labelFor(options.workspace)}`]],
      remove: [target],
      summary: `Removed ${target}.`,
    };
  }

  if (platform === 'linux') {
    const dir = join(options.home, '.config', 'systemd', 'user');
    return {
      // Disabling stops the timer and drops the symlink; removing the units
      // first would leave systemd holding a unit it can no longer read.
      commands: [
        ['systemctl', '--user', 'disable', '--now', `${name}.timer`],
        ['systemctl', '--user', 'daemon-reload'],
      ],
      remove: [join(dir, `${name}.timer`), join(dir, `${name}.service`)],
      summary: `Removed the ${name} timer.`,
    };
  }

  if (platform === 'win32') {
    return {
      commands: [['schtasks', '/Delete', '/TN', name, '/F']],
      remove: [join(options.home, '.nimbalyst-flows', `${name}.cmd`)],
      summary: `Removed the ${name} scheduled task.`,
    };
  }

  return { commands: [], remove: [], summary: `Nothing to remove on ${platform}.` };
}

function macosPlan(options: InstallOptions): InstallPlan {
  const label = labelFor(options.workspace);
  const target = join(options.home, 'Library', 'LaunchAgents', `${label}.plist`);

  return {
    files: [{ path: target, content: launchAgentPlist(options) }],
    commands: [
      ['launchctl', 'bootout', `gui/\${UID}/${label}`],
      ['launchctl', 'bootstrap', 'gui/\${UID}', target],
    ],
    summary:
      `Scheduled flows will run every ${options.everyMinutes}m while Nimbalyst is closed.\n` +
      `  agent: ${target}\n  log:   ${logPathFor(options.workspace)}`,
  };
}

function linuxPlan(options: InstallOptions): InstallPlan {
  const name = unitName(options.workspace);
  const dir = join(options.home, '.config', 'systemd', 'user');

  const service = `[Unit]
Description=Run due Nimbalyst flows in ${options.workspace}

[Service]
Type=oneshot
WorkingDirectory=${options.workspace}
ExecStart=${options.nodePath} ${options.cliPath} schedule run
`;

  // Persistent=false on purpose: a machine that was off all night should not
  // fire every overdue flow the moment it wakes.
  const timer = `[Unit]
Description=Nimbalyst flows schedule for ${options.workspace}

[Timer]
OnBootSec=${options.everyMinutes}min
OnUnitActiveSec=${options.everyMinutes}min
Persistent=false

[Install]
WantedBy=timers.target
`;

  return {
    files: [
      { path: join(dir, `${name}.service`), content: service },
      { path: join(dir, `${name}.timer`), content: timer },
    ],
    commands: [
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'enable', '--now', `${name}.timer`],
    ],
    summary:
      `Scheduled flows will run every ${options.everyMinutes}m while Nimbalyst is closed.\n` +
      `  timer: ${join(dir, `${name}.timer`)}\n` +
      `  logs:  journalctl --user -u ${name}.service`,
  };
}

function windowsPlan(options: InstallOptions): InstallPlan {
  const name = unitName(options.workspace);
  const scriptDir = join(options.home, '.nimbalyst-flows');
  const script = join(scriptDir, `${name}.cmd`);

  // schtasks has no working-directory option, so the task runs a wrapper that
  // changes into the workspace first.
  const content = `@echo off\r\ncd /d "${options.workspace}"\r\n"${options.nodePath}" "${options.cliPath}" schedule run\r\n`;

  return {
    files: [{ path: script, content }],
    commands: [
      [
        'schtasks',
        '/Create',
        '/TN',
        name,
        '/TR',
        `"${script}"`,
        '/SC',
        'MINUTE',
        '/MO',
        String(options.everyMinutes),
        '/F',
      ],
    ],
    summary:
      `Scheduled flows will run every ${options.everyMinutes}m while Nimbalyst is closed.\n` +
      `  task:   ${name}\n  script: ${script}`,
  };
}
