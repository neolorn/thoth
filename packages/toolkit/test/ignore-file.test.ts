import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { uninstallProject } from '../src/index.js';
import { initializeProject } from '../src/project-host.js';

/**
 * The owner's `.gitignore` after `thoth init` and `thoth uninstall`.
 *
 * The generated root is rewritten by every build and the cache is disposable, so neither belongs in
 * a project's history, and setting a project up includes saying so. An owner without a
 * `.gitignore` may not use git at all, so none is created.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const CONFIGURATION = {
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US'],
};

async function owner(ignore?: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'ignore-file-'));
  roots.push(root);
  await writeFile(
    resolve(root, 'package.json'),
    `${JSON.stringify({ name: '@example/ignore', private: true }, null, 2)}\n`,
  );
  if (ignore !== undefined)
    await writeFile(resolve(root, '.gitignore'), ignore);
  return root;
}

const read = (root: string) => readFile(resolve(root, '.gitignore'), 'utf8');

describe('the owner .gitignore', () => {
  it('gains the generated root and the cache at init, once', async () => {
    const root = await owner('node_modules/\n');

    const first = await initializeProject({
      project: root,
      configuration: CONFIGURATION,
    });
    expect(first.ok, JSON.stringify(first.diagnostics)).toBe(true);
    expect(await read(root)).toBe(
      'node_modules/\nsrc/generated/i18n/\n.thoth/\n',
    );
    if (first.ok) expect(first.value.files).toContain('.gitignore');

    const second = await initializeProject({
      project: root,
      configuration: CONFIGURATION,
    });
    expect(second.ok).toBe(true);
    expect(await read(root)).toBe(
      'node_modules/\nsrc/generated/i18n/\n.thoth/\n',
    );
  });

  it('keeps its line endings and a spelling that already names a path', async () => {
    const root = await owner('/dist\r\n/.thoth\r\nnode_modules');

    await initializeProject({ project: root, configuration: CONFIGURATION });

    expect(await read(root)).toBe(
      '/dist\r\n/.thoth\r\nnode_modules\r\nsrc/generated/i18n/\r\n',
    );
  });

  it('is not created where the owner has none', async () => {
    const root = await owner();

    const result = await initializeProject({
      project: root,
      configuration: CONFIGURATION,
    });

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.ok) expect(result.value.files).not.toContain('.gitignore');
    await expect(stat(resolve(root, '.gitignore'))).rejects.toThrow();
  });

  it('loses the two lines at uninstall, and keeps the rest', async () => {
    const root = await owner('node_modules/\n');
    await initializeProject({ project: root, configuration: CONFIGURATION });

    const removed = await uninstallProject({ project: root });

    expect(removed.ok, JSON.stringify(removed.diagnostics)).toBe(true);
    expect(await read(root)).toBe('node_modules/\n');
  });
});
