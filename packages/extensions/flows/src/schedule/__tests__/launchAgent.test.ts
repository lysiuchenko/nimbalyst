// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LAUNCH_AGENT_LABEL, launchAgentPath, launchAgentPlist } from '../launchAgent';

const options = {
  workspace: '/Users/me/repo',
  cliPath: '/opt/flows/nimbalyst-flows.js',
  nodePath: '/usr/local/bin/node',
  everyMinutes: 30,
};

describe('launchAgentPlist', () => {
  it('runs the scheduler through node, in the workspace', () => {
    const plist = launchAgentPlist(options);

    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toContain('<string>/opt/flows/nimbalyst-flows.js</string>');
    expect(plist).toContain('<string>schedule</string>');
    expect(plist).toContain('<string>run</string>');
    expect(plist).toContain('<key>WorkingDirectory</key>');
    expect(plist).toContain('<string>/Users/me/repo</string>');
  });

  it('wakes on the interval it was given', () => {
    expect(launchAgentPlist(options)).toContain('<integer>1800</integer>');
  });

  it('does not run at load: a login should not fire every overdue flow at once', () => {
    expect(launchAgentPlist(options)).toContain('<key>RunAtLoad</key>\n  <false/>');
  });

  it('keeps a log so a failed overnight run can be read in the morning', () => {
    const plist = launchAgentPlist(options);

    expect(plist).toContain('StandardOutPath');
    expect(plist).toContain('StandardErrorPath');
  });

  it('escapes a path that would otherwise break the XML', () => {
    const plist = launchAgentPlist({ ...options, workspace: '/Users/me/repo & co' });

    expect(plist).toContain('/Users/me/repo &amp; co');
    expect(plist).not.toContain('repo & co');
  });

  it('labels the agent per workspace, so two repos do not collide', () => {
    const a = launchAgentPath('/Users/me/one');
    const b = launchAgentPath('/Users/me/two');

    expect(a).not.toBe(b);
    expect(a).toContain(LAUNCH_AGENT_LABEL);
    expect(a.endsWith('.plist')).toBe(true);
  });
});
