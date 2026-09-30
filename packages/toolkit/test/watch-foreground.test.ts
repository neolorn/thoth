import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { initializeProject, watchProject } from '../src/project-host.js';

/**
 * Watch is the calling process, for exactly as long as the caller keeps it, and nothing of it
 * remains once the caller stops it.
 *
 * Observed through the process's own list of active resources, where the platform watcher shows up
 * while it is open. A watcher left open after the call returns is a background process in all but
 * name: it keeps the host alive and keeps consuming events nobody reads.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, path: string, text: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'));
  await mkdir(resolve(absolute, '..'), { recursive: true });
  await writeFile(absolute, text, 'utf8');
}

const watchers = (): number =>
  process.getActiveResourcesInfo().filter((name) => name === 'FSEventWrap')
    .length;

describe('watch', () => {
  it('holds a platform watcher only between its start and its return', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'watch-foreground-'));
    roots.push(root);
    await write(
      root,
      'package.json',
      `${JSON.stringify({ name: '@example/watch-foreground', private: true, type: 'module' }, null, 2)}\n`,
    );
    const initialized = await initializeProject({
      project: root,
      configuration: {
        sourceLocale: 'en-US',
        defaultLocale: 'en-US',
        locales: ['en-US'],
      },
    });
    expect(initialized.ok).toBe(true);
    await write(
      root,
      'tsconfig.app.json',
      `${JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', resolvePackageJsonImports: true }, include: ['src/**/*.ts'] }, null, 2)}\n`,
    );
    await write(
      root,
      'src/app.ts',
      "import { messages } from '#i18n/shell';\n\nexport const title = messages.appTitle.messageId;\n",
    );
    await write(
      root,
      'i18n/shell/en-US.yaml',
      'messages:\n  app-title: Foreground\n',
    );

    const before = watchers();
    const controller = new AbortController();
    let during = -1;
    let returned = false;
    const watched = watchProject({
      project: root,
      signal: controller.signal,
      onCycle: () => {
        during = watchers();
        controller.abort();
      },
    }).finally(() => {
      returned = true;
    });
    const deadline = Date.now() + 15_000;
    while (during < 0 && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 20));
    }
    expect(during).toBeGreaterThan(before);
    const result = await watched;
    expect(returned).toBe(true);
    expect(result.ok).toBe(true);
    expect(watchers()).toBe(before);
  });
});
