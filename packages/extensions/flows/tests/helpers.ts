import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const ELECTRON_MAIN = path.join(REPO_ROOT, 'packages/electron/out/main/index.js');

/**
 * Launches the *built* app rather than attaching to a dev server.
 *
 * The repo's other E2E specs connect over CDP to `npm run dev`, which means a
 * human has to be running it. These specs cover a shipped artifact instead, so
 * they work unattended in CI — the flows extension is loaded from
 * `packages/extensions` exactly as it is in a dev run.
 */
export interface FlowsApp {
  app: ElectronApplication;
  page: Page;
  workspace: string;
  /** Fires the same IPC the Cmd+S menu item sends. */
  save(): Promise<void>;
  readFlow(name: string): unknown;
  runRecords(): string[];
  close(): Promise<void>;
}

export function createWorkspace(files: Record<string, unknown | string>): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-e2e-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: workspace, stdio: 'ignore' });

  // A real repo: worktree- and git-status-shaped flows need a valid HEAD.
  git('init', '-q');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'user.name', 'e2e');

  for (const [name, content] of Object.entries(files)) {
    const target = path.join(workspace, name);
    // Nested names let a fixture seed `.flow-runs/…`, which is how the history
    // and dashboard tests get deterministic data without running an agent.
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`
    );
  }
  git('add', '-A');
  git('commit', '-qm', 'fixture');

  return workspace;
}

export async function launchFlowsApp(workspace: string): Promise<FlowsApp> {
  if (!fs.existsSync(ELECTRON_MAIN)) {
    throw new Error(
      `built app not found at ${ELECTRON_MAIN}. Run: cd packages/electron && npm run build`
    );
  }

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-e2e-userdata-'));
  const { ELECTRON_RUN_AS_NODE, ELECTRON_NO_ATTACH_CONSOLE, NODE_PATH, ...cleanEnv } = process.env;

  const app = await electron.launch({
    args: [ELECTRON_MAIN, '--workspace', workspace],
    cwd: path.join(REPO_ROOT, 'packages/electron'),
    env: {
      ...Object.fromEntries(Object.entries(cleanEnv).filter(([, v]) => v !== undefined)) as Record<string, string>,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      PLAYWRIGHT: '1',
      NIMBALYST_USER_DATA_DIR: userData,
      NIMBALYST_PERMISSION_MODE: 'allow-all',
    },
    timeout: 120_000,
  });

  const page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState('domcontentloaded');
  // The workspace sidebar populates well after first paint.
  await page.waitForTimeout(11_000);

  return {
    app,
    page,
    workspace,
    save: () =>
      app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
          .find((window) => !window.isDestroyed())
          ?.webContents.send('file-save');
      }),
    readFlow: (name) => JSON.parse(fs.readFileSync(path.join(workspace, name), 'utf-8')),
    runRecords: () => {
      const dir = path.join(workspace, '.flow-runs');
      if (!fs.existsSync(dir)) return [];
      // Records only: the directory also holds the `.gitignore` that keeps them
      // out of the repository, and schedule state.
      return fs.readdirSync(dir).filter((name) => name.startsWith('run-') && name.endsWith('.json'));
    },
    close: async () => {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(workspace, { recursive: true, force: true });
    },
  };
}

/** Open a file from the project sidebar and wait for the flow editor. */
export async function openFlow(page: Page, fileName: string): Promise<void> {
  await page.getByText(fileName, { exact: false }).first().click();
  await page.locator('[data-testid="flow-editor"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2000);
}

export async function nodeStatuses(page: Page): Promise<Record<string, string | null>> {
  return await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.flow-node')].map((node) => [
        node.getAttribute('data-node-id'),
        node.getAttribute('data-node-status'),
      ])
    )
  );
}
