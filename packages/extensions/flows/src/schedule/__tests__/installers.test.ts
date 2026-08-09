// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { installPlanFor, uninstallPlanFor } from '../installers';

const options = {
  workspace: '/home/me/repo',
  cliPath: '/opt/flows/nimbalyst-flows.js',
  nodePath: '/usr/bin/node',
  everyMinutes: 30,
  home: '/home/me',
};

describe('installPlanFor — linux', () => {
  const plan = installPlanFor('linux', options);

  it('writes a systemd user service and the timer that drives it', () => {
    const names = plan.files.map((file) => file.path);

    expect(names.some((name) => name.endsWith('.service'))).toBe(true);
    expect(names.some((name) => name.endsWith('.timer'))).toBe(true);
    expect(names.every((name) => name.startsWith('/home/me/.config/systemd/user/'))).toBe(true);
  });

  it('runs the scheduler in the workspace', () => {
    const service = plan.files.find((file) => file.path.endsWith('.service'))!.content;

    expect(service).toContain('ExecStart=/usr/bin/node /opt/flows/nimbalyst-flows.js schedule run');
    expect(service).toContain('WorkingDirectory=/home/me/repo');
    expect(service).toContain('Type=oneshot');
  });

  it('wakes on the interval it was given, and not at boot', () => {
    const timer = plan.files.find((file) => file.path.endsWith('.timer'))!.content;

    expect(timer).toContain('OnUnitActiveSec=30min');
    // Firing every overdue flow the moment the machine wakes is the backlog
    // problem the catch-up window exists to avoid.
    expect(timer).toContain('Persistent=false');
  });

  it('reloads and enables through systemctl, never a shell string', () => {
    expect(plan.commands).toContainEqual(['systemctl', '--user', 'daemon-reload']);
    expect(plan.commands.some((argv) => argv.includes('enable') && argv.includes('--now'))).toBe(
      true
    );
  });
});

describe('installPlanFor — windows', () => {
  const plan = installPlanFor('win32', {
    ...options,
    workspace: 'C:\\repo',
    nodePath: 'C:\\node\\node.exe',
    cliPath: 'C:\\flows\\nimbalyst-flows.js',
    home: 'C:\\Users\\me',
  });

  it('writes a wrapper script, because schtasks cannot set a working directory', () => {
    const script = plan.files[0];

    expect(script.path.endsWith('.cmd')).toBe(true);
    expect(script.content).toContain('cd /d "C:\\repo"');
    expect(script.content).toContain('schedule run');
  });

  it('registers a repeating task through schtasks', () => {
    const create = plan.commands.find((argv) => argv[0] === 'schtasks')!;

    expect(create).toContain('/Create');
    expect(create).toContain('/SC');
    expect(create).toContain('MINUTE');
    expect(create).toContain('/MO');
    expect(create).toContain('30');
    // Overwrite, so re-installing with a new interval replaces the old task.
    expect(create).toContain('/F');
  });
});

describe('installPlanFor — unsupported', () => {
  it('says so rather than writing something that will not work', () => {
    const plan = installPlanFor('aix' as NodeJS.Platform, options);

    expect(plan.files).toEqual([]);
    expect(plan.commands).toEqual([]);
    expect(plan.summary).toContain('not supported');
  });
});

describe('uninstallPlanFor', () => {
  it('stops the timer before deleting its unit files', () => {
    const plan = uninstallPlanFor('linux', options);

    const stopIndex = plan.commands.findIndex((argv) => argv.includes('disable'));
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(plan.remove.length).toBeGreaterThan(0);
  });

  it('deletes the scheduled task on windows', () => {
    const plan = uninstallPlanFor('win32', options);

    expect(plan.commands.some((argv) => argv.includes('/Delete'))).toBe(true);
  });

  it('unloads the agent on macos', () => {
    const plan = uninstallPlanFor('darwin', options);

    expect(plan.commands.some((argv) => argv.includes('bootout'))).toBe(true);
    expect(plan.remove.some((path) => path.endsWith('.plist'))).toBe(true);
  });
});
