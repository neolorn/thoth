/**
 * Every stage that has a self-test: what it runs, what it reads, and the defects planted into a copy
 * of what it reads.
 *
 * `verify-stage-self-test.mjs <stage>` runs one entry. The normative map names a plant as
 * `plant:<stage>:<id>`, which is a check only while `<stage>:self-test` is in the gate.
 */
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { plants as packageStructurePlants } from './package-structure-plants.mjs';
import { editJson, editText, replaceOnce } from './stage-self-test.mjs';

const plantText = (path, find, replace) => (root) =>
  editText(root, path, replaceOnce(find, replace));

const suiteRoot = 'standards/data/message-format-tests-48.2';

// Made up per run, because the export gate reads this file as evidence of use, and a planted name
// written here would be one this file already uses.
const plantedExport = `planted${Date.now().toString(36)}`;

export const stageSelfTests = Object.freeze({
  'verify:packages': {
    script: 'tools/verify-package-structure.mjs',
    inputs: [
      'package.json',
      '.node-version',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'LICENSE',
      'standards/sources.lock.json',
      'standards/data/language-subtag-registry-2026-06-14.txt',
      'dist/runtime',
      'dist/toolkit',
      'packages/runtime/src',
      'packages/runtime/core/src',
      'packages/runtime/forms/src',
      'packages/runtime/http/src',
      'packages/runtime/router/src',
      'packages/runtime/ssr/src',
      'packages/runtime/testing/src',
      'packages/toolkit/src',
    ],
    plants: packageStructurePlants,
  },
  'verify:cli-options': {
    script: 'tools/generate-cli-options.mjs',
    args: ['--check'],
    inputs: ['dist/toolkit', 'packages/toolkit/src/cli-options.generated.ts'],
    plants: [
      {
        id: 'option-table-kept-by-hand',
        plant: plantText(
          'packages/toolkit/src/cli-options.generated.ts',
          "  | 'parentLocales'\n",
          '',
        ),
        refusal: /The checked-in equator init option table is stale/u,
      },
      {
        id: 'settable-field-without-a-description',
        plant: plantText(
          'dist/toolkit/schemas.js',
          "description: 'The locale the authored source catalogs are written in.',",
          '',
        ),
        refusal: /Configuration key sourceLocale has no description/u,
      },
    ],
  },
  'verify:diagnostics-reference': {
    script: 'tools/generate-diagnostics-reference.mjs',
    args: ['--check'],
    inputs: [
      'dist/toolkit',
      'packages/runtime/src',
      'packages/toolkit/src',
      'packages/toolkit/DIAGNOSTICS.md',
      'docs/reference/diagnostics.md',
    ],
    plants: [
      {
        id: 'package-reference-kept-by-hand',
        plant: plantText(
          'packages/toolkit/DIAGNOSTICS.md',
          '### EQ1701',
          '### EQ1799',
        ),
        refusal:
          /packages[\\/]toolkit[\\/]DIAGNOSTICS\.md does not match the diagnostics table/u,
      },
      {
        id: 'web-reference-kept-by-hand',
        plant: plantText(
          'docs/reference/diagnostics.md',
          '### EQ1701',
          '### EQ1799',
        ),
        refusal:
          /docs[\\/]reference[\\/]diagnostics\.md does not match the diagnostics table/u,
      },
    ],
  },
  'verify:docs-reference': {
    script: 'tools/generate-docs-reference.mjs',
    args: ['--check'],
    inputs: ['dist/runtime', 'dist/toolkit', 'docs/reference', 'README.md'],
    plants: [
      {
        id: 'compatibility-page-calls-a-range-verified',
        plant: plantText(
          'docs/reference/compatibility.md',
          '## Angular, TypeScript and RxJS',
          '## Angular, TypeScript and RxJS, all verified',
        ),
        refusal:
          /compatibility\.md is not what its source of truth produces now/u,
      },
      {
        id: 'compatibility-page-lists-an-unexecuted-row',
        plant: plantText(
          'docs/reference/compatibility.md',
          '`22.22.3`, `24.15.0`, `24.18.0`, `26.0.0`.',
          '`22.22.3`, `22.30.0`, `24.15.0`, `24.18.0`, `26.0.0`.',
        ),
        refusal:
          /compatibility\.md is not what its source of truth produces now/u,
      },
      {
        id: 'readme-range-not-the-manifest-range',
        plant: plantText(
          'README.md',
          '| RxJS       | `>=7.4.0 <8.0.0`                      |',
          '| RxJS       | `>=7.0.0 <8.0.0`                      |',
        ),
        refusal: /README\.md offers RxJS at >=7\.0\.0 <8\.0\.0/u,
      },
      {
        id: 'readme-claims-a-wider-range',
        plant: plantText(
          'README.md',
          '| Angular    | `>=22.0.0 <23.0.0`                    |',
          '| Angular    | `>=22.0.0 <24.0.0`                    |',
        ),
        refusal: /README\.md offers Angular at >=22\.0\.0 <24\.0\.0/u,
      },
    ],
  },
  'verify:standards-sources': {
    script: 'tools/verify-standards-sources.mjs',
    inputs: ['standards'],
    plants: [
      {
        id: 'vendored-source-not-its-digest',
        plant: (root) =>
          editText(
            root,
            'standards/data/language-subtag-registry-2026-06-14.txt',
            (text) => `${text}%%\n`,
          ),
        refusal:
          /language-subtag-registry-2026-06-14\.txt is \d+ bytes, the lock says/u,
      },
      {
        id: 'conformance-suite-edited',
        plant: plantText(
          `${suiteRoot}/test/README.md`,
          '# Unicode MessageFormat Test Suite',
          '# Unicode MessageFormat Test Suite (edited)',
        ),
        refusal:
          /message-format-tests-48\.2 manifest hashes to [0-9a-f]+, the lock says/u,
      },
      {
        id: 'unrecorded-data-file',
        plant: (root) =>
          writeFile(resolve(root, 'standards/data/unrecorded.txt'), 'planted'),
        refusal: /data\/unrecorded\.txt is present, and no source records it/u,
      },
    ],
  },
  'verify:locale-profile': {
    script: 'tools/generate-locale-profile.mjs',
    args: ['--check'],
    inputs: [
      'standards/sources.lock.json',
      'standards/data/language-subtag-registry-2026-06-14.txt',
      'standards/data/DerivedBidiClass-17.0.0.txt',
      'packages/runtime/core/src/locale-profile.generated.ts',
      'packages/runtime/src/encompassed-languages.generated.ts',
      'packages/toolkit/src/plural-categories.generated.ts',
      'packages/toolkit/src/endonyms.generated.ts',
      'packages/toolkit/src/parent-locales.generated.ts',
      'packages/toolkit/src/rtl-scripts.generated.ts',
    ],
    plants: [
      {
        id: 'plural-table-not-from-the-pinned-source',
        plant: plantText(
          'packages/toolkit/src/plural-categories.generated.ts',
          "export const PLURAL_DATA_PROFILE = 'cldr-48.2/equator-plurals-1' as const;",
          "export const PLURAL_DATA_PROFILE = 'cldr-48.2/equator-plurals-2' as const;",
        ),
        refusal: /The checked-in Equator plural-category table is stale/u,
      },
      {
        id: 'plural-categories-not-the-pinned-ones',
        plant: plantText(
          'packages/toolkit/src/plural-categories.generated.ts',
          '"ar":["zero","one","two","few","many","other"],"ars"',
          '"ar":["one","other"],"ars"',
        ),
        refusal: /The checked-in Equator plural-category table is stale/u,
      },
      {
        id: 'script-distance-read-as-encompassing',
        plant: plantText(
          'packages/runtime/src/encompassed-languages.generated.ts',
          '"zh":{"cdo":10',
          '"zh-Hant":{"zh-Hans":50},"zh":{"cdo":10',
        ),
        refusal: /The checked-in Equator encompassed-language table is stale/u,
      },
    ],
  },
  'verify:export-surface': {
    script: 'tools/verify-export-surface.mjs',
    inputs: [
      'dist/runtime/types',
      'dist/toolkit',
      'fixtures/package-consumer-template/src',
      'fixtures/minimal-package-consumer-template/src',
      'fixtures/semantic-analysis',
      'tools',
      'packages/toolkit/test',
      'packages/runtime/test',
    ],
    plants: [
      {
        id: 'runtime-export-nothing-reaches',
        plant: (root) =>
          editText(
            root,
            'dist/runtime/types/neolorn-equator-core.d.ts',
            (text) =>
              `${text}\nexport declare const ${plantedExport}: Readonly<object>;\n`,
          ),
        refusal: new RegExp(`core / ${plantedExport}$`, 'mu'),
      },
      {
        id: 'toolkit-export-nothing-reaches',
        plant: (root) =>
          editText(
            root,
            'dist/toolkit/index.d.ts',
            (text) => `${text}\nexport declare const ${plantedExport} = 0;\n`,
          ),
        refusal: new RegExp(`toolkit / ${plantedExport}$`, 'mu'),
      },
    ],
  },
  'verify:message-format-conformance': {
    script: 'tools/verify-message-format-conformance.mjs',
    inputs: [
      `${suiteRoot}/test/tests`,
      'tools/message-format-conformance-baseline.json',
    ],
    plants: [
      {
        id: 'divergence-class-renamed',
        plant: plantText(
          'tools/message-format-conformance-baseline.json',
          '"unregistered-function-refused": {',
          '"unregistered-function-refused-renamed": {',
        ),
        refusal:
          /The baseline class "unregistered-function-refused-renamed" has no cases left/u,
      },
      {
        id: 'suite-file-dropped',
        plant: (root) =>
          rm(resolve(root, `${suiteRoot}/test/tests/syntax.json`)),
        refusal: /Expected 16 suite files and 461 cases, found 15/u,
      },
    ],
  },
});

/** The plant identifiers by stage, which is what the normative map checks names against. */
export const stagePlants = Object.freeze(
  Object.fromEntries(
    Object.entries(stageSelfTests).map(([stage, { plants }]) => [
      stage,
      Object.freeze(plants.map(({ id }) => id)),
    ]),
  ),
);
