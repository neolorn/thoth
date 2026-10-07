import { describe, expect, it, vi } from 'vitest';

import { fingerprintCompilerInputs } from '../src/compiler.js';
import { testProjectConfiguration } from './fixtures.js';

/**
 * An analysis input whose file name holds backslashes.
 *
 * A compilation's state names its inputs with forward slashes, whatever the machine that wrote it
 * uses. Under POSIX rules a backslash is an ordinary character of a file name, so a name holding
 * two in a row becomes a name with nothing between two slashes once it is written the portable
 * way. No file has that name on any machine, and the input is refused.
 */

// A backslash is part of a file name only under POSIX path rules, so the compiler is given those
// rules on every platform.
vi.mock('node:path', async (original) => {
  const actual = await original<typeof import('node:path')>();
  return { ...actual.posix, default: actual.posix };
});

const owner = {
  providerId: '@example/app',
  generatedRootPath: 'src/generated/i18n',
};

const projectRoot = '/work/app';

/** The input identities of a compilation whose analysis has this one file as root and source. */
function identities(
  path: string,
  as: 'root name' | 'source',
): readonly string[] {
  return fingerprintCompilerInputs({
    owner,
    configuration: testProjectConfiguration(['en-US']),
    catalogs: [],
    analysis:
      as === 'root name'
        ? { projectRoot, rootNames: [path] }
        : { projectRoot, rootNames: [], sources: [{ path, contents: '' }] },
  }).inputs.map(({ identity }) => identity);
}

describe('an analysis input whose portable name would have an empty segment', () => {
  it.each([
    ['two backslashes in a row', 'src/pages\\\\main.ts'],
    ['a backslash after a slash', 'src/\\main.ts'],
    ['a backslash at its end', '/work/app/src/main.ts\\'],
  ])('is refused when its name holds %s', (_what, path) => {
    expect(() => identities(path, 'root name')).toThrow(TypeError);
    expect(() => identities(path, 'source')).toThrow(TypeError);
  });

  it('is named with forward slashes when no segment of it is empty', () => {
    // The control: the same rules accept a name whose every segment holds something.
    expect(identities('/work/app/src/main.ts', 'source')).toContain(
      'source:src/main.ts',
    );
    expect(identities('src/main.ts', 'root name')).toContain('analysis-graph');
  });
});
