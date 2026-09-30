import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyOutputPlan } from '../src/output-host.js';
import { createOutputPlan } from '../src/output-plan.js';

/**
 * The generated root and the work root are two separate trees, and neither sits inside a tree
 * that belongs to someone else: the authored catalogs, a dependency, or the build output.
 *
 * Each is disposable and each is cleaned by deleting what its own manifest lists, so a root inside
 * another root, or inside a tree a package manager or a bundler rewrites, is one where a clean or
 * an install removes the other's files.
 */

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(root);
  return root;
}

const OWNER_ID = `sha256-${'A'.repeat(43)}`;

describe('the generated root and the work root', () => {
  it('are refused when one is, contains, or lies inside the other', async () => {
    const owner = await temporary('root-separation-');
    const plan = createOutputPlan([
      { path: 'index.ts', contents: 'export {};\n' },
    ]);
    if (!plan.ok) throw new Error(JSON.stringify(plan.diagnostics));
    for (const [generatedRoot, workRoot] of [
      ['.equator', '.equator'],
      ['.equator/generated', '.equator'],
      ['src/generated/i18n', 'src/generated/i18n/.work'],
    ] as const) {
      const applied = await applyOutputPlan({
        ownerRoot: owner,
        generatedRoot: resolve(owner, generatedRoot),
        workRoot: resolve(owner, workRoot),
        ownerId: OWNER_ID,
        plan: plan.value,
      });
      expect(applied.ok, `${generatedRoot} and ${workRoot}`).toBe(false);
      expect(applied.diagnostics[0]?.code).toBe('EQ1601');
    }
    expect(await readdir(owner)).toEqual([]);
  });
});
