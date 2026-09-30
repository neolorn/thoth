/**
 * Every stage that has a self-test: what it runs, what it reads, and the defects planted into a copy
 * of what it reads.
 *
 * `verify-stage-self-test.mjs <stage>` runs one entry. The normative map names a plant as
 * `plant:<stage>:<id>`, which is a check only while `<stage>:self-test` is in the gate.
 */
import { readdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { plants as packageStructurePlants } from './package-structure-plants.mjs';
import {
  editJson,
  editText,
  replaceOnce,
  repositoryRoot,
} from './stage-self-test.mjs';

const plantText = (path, find, replace) => (root) =>
  editText(root, path, replaceOnce(find, replace));

const suiteRoot = 'standards/data/message-format-tests-48.2';

// Every `src` under `packages/` at any depth, the directories the diagnostics scan reads, so the
// copy holds each secondary entry point the scan would find in the repository.
const packageSourceRoots = () => {
  const roots = [];
  const visit = (path) => {
    for (const entry of readdirSync(resolve(repositoryRoot, path), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const child = `${path}/${entry.name}`;
      if (entry.name === 'src') roots.push(child);
      else visit(child);
    }
  };
  visit('packages');
  return roots.sort();
};

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
      'dist/runtime/types',
      ...packageSourceRoots(),
      'packages/toolkit/DIAGNOSTICS.md',
      'docs/reference/diagnostics.md',
      'tools/code-record.json',
      'tools/code-descriptions.json',
    ],
    plants: [
      {
        id: 'recorded-toolkit-code-renumbered',
        plant: plantText(
          'dist/toolkit/diagnostic-reference.js',
          '    EQ1701: ',
          '    EQ1799: ',
        ),
        refusal:
          /EQ1701 is in tools\/code-record\.json and ToolkitDiagnosticCode no longer declares it/u,
      },
      {
        id: 'recorded-failure-code-withdrawn',
        plant: plantText(
          'dist/runtime/types/neolorn-equator-core.d.ts',
          "'participant-timeout' | ",
          '',
        ),
        refusal:
          /participant-timeout is in tools\/code-record\.json and LocalizationFailureCode no longer declares it/u,
      },
      {
        id: 'runtime-event-code-moved-to-another-area',
        plant: plantText(
          'dist/runtime/types/neolorn-equator.d.ts',
          'readonly transition: "EQ-E2003";\n    readonly formatting: "EQ-E2004";',
          'readonly transition: "EQ-E2004";\n    readonly formatting: "EQ-E2003";',
        ),
        refusal:
          /EQ-E2003 is recorded for transition and RUNTIME_EVENT_CODES now declares it for formatting/u,
      },
      {
        id: 'toolkit-event-code-moved-to-another-area',
        plant: plantText(
          'dist/toolkit/observability.js',
          "interchange: 'EQ-E1002',\n    migration: 'EQ-E1003',",
          "interchange: 'EQ-E1003',\n    migration: 'EQ-E1002',",
        ),
        refusal:
          /EQ-E1002 is recorded for interchange and TOOLKIT_EVENT_CODES now declares it for migration/u,
      },
      {
        id: 'declared-code-not-recorded',
        plant: editJson('tools/code-record.json', (record) => {
          record.toolkitDiagnostics = record.toolkitDiagnostics.filter(
            (code) => code !== 'EQ1416',
          );
        }),
        refusal:
          /Declared and not in tools\/code-record\.json: EQ1416 \(ToolkitDiagnosticCode\)/u,
      },
      // A failing run that moves its own baseline the way that hides the failure: the built table the
      // stage imports renumbers a recorded code and rewrites the record to match. The stage still
      // fails on the renumbered code being raised nowhere, and prints nothing about the record, so
      // only the comparison of what the run reads can see it.
      {
        id: 'failing-run-rewrites-its-record',
        rewrites: 'tools/code-record.json',
        plant: (root) =>
          editText(root, 'dist/toolkit/diagnostic-reference.js', (text) =>
            [
              "import { readFileSync, writeFileSync } from 'node:fs';",
              "const recordUrl = new URL('../../tools/code-record.json', import.meta.url);",
              "writeFileSync(recordUrl, readFileSync(recordUrl, 'utf8').replace('\"EQ1701\"', '\"EQ1799\"'));",
              replaceOnce('    EQ1701: ', '    EQ1799: ')(text),
            ].join('\n'),
          ),
      },
      {
        id: 'declared-code-without-a-description',
        plant: editJson('tools/code-descriptions.json', (descriptions) => {
          delete descriptions.runtimeFailures['participant-timeout'];
        }),
        refusal:
          /participant-timeout is declared by LocalizationFailureCode and tools\/code-descriptions\.json has no description for it/u,
      },
      {
        id: 'description-for-an-undeclared-code',
        plant: editJson('tools/code-descriptions.json', (descriptions) => {
          descriptions.runtimeEvents['EQ-E2009'] =
            'An area the runtime does not declare.';
        }),
        refusal:
          /tools\/code-descriptions\.json describes EQ-E2009, which RUNTIME_EVENT_CODES does not declare/u,
      },
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
        id: 'vendored-notice-edited',
        plant: (root) =>
          editText(
            root,
            'standards/data/cldr-person-names-48.2.0/LICENSE',
            (text) => `${text}%%\n`,
          ),
        refusal:
          /its notice data\/cldr-person-names-48\.2\.0\/LICENSE is \d+ bytes, the lock says/u,
      },
      {
        id: 'vendored-source-records-no-notice',
        plant: plantText(
          'standards/sources.lock.json',
          ',\n        "noticeNotRequired": "IANA and the IETF place the protocol registries under the CC0 1.0 dedication, which asks for no notice on copies."',
          '',
        ),
        refusal:
          /its license records neither a noticeFile nor a noticeNotRequired reason/u,
      },
      {
        id: 'unrecorded-data-file',
        plant: (root) =>
          writeFile(resolve(root, 'standards/data/unrecorded.txt'), 'planted'),
        refusal: /data\/unrecorded\.txt is present, and no source records it/u,
      },
      {
        id: 'source-recorded-without-a-role',
        plant: editJson('standards/sources.lock.json', (lock) => {
          delete lock.dataSources.cldrJsonCore.role;
        }),
        refusal: /cldrJsonCore: the lock records no role/u,
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
      'packages/runtime/core/src/encompassed-languages.generated.ts',
      'packages/toolkit/src/plural-categories.generated.ts',
      'packages/toolkit/src/endonyms.generated.ts',
      'packages/toolkit/src/parent-locales.generated.ts',
      'packages/toolkit/src/rtl-scripts.generated.ts',
      'packages/runtime/core/src/locale-aliases.generated.ts',
      'packages/toolkit/src/locale-aliases.generated.ts',
    ],
    plants: [
      {
        id: 'alias-rule-not-the-pinned-one',
        plant: plantText(
          'packages/toolkit/src/locale-aliases.generated.ts',
          ',tw>ak,',
          ',tw>tw,',
        ),
        refusal: /The checked-in Equator locale alias table is stale/u,
      },
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
          'packages/runtime/core/src/encompassed-languages.generated.ts',
          '"zh":{"cdo":10',
          '"zh-Hant":{"zh-Hans":50},"zh":{"cdo":10',
        ),
        refusal: /The checked-in Equator encompassed-language table is stale/u,
      },
    ],
  },
  'verify:cost-reference': {
    script: 'tools/generate-cost-reference.mjs',
    args: ['--check'],
    inputs: [
      'dist/runtime',
      'dist/toolkit',
      'docs/reference/cost.md',
      ...[
        'tmp/focused-package-consumer-verification/minimal-runtime-consumer',
        'tmp/package-consumer-verification/package-consumer',
      ].flatMap((root) => [
        `${root}/src/generated/i18n`,
        `${root}/node_modules/@angular/build/package.json`,
      ]),
      'tmp/focused-package-consumer-verification/minimal-runtime-consumer/dist/minimal',
      'tmp/package-consumer-verification/package-consumer/dist/feature-lab',
    ],
    plants: [
      {
        id: 'entry-point-grew',
        plant: editJson(
          'tmp/focused-package-consumer-verification/minimal-runtime-consumer/dist/minimal/stats.json',
          (stats) => {
            const input = Object.values(stats.outputs)
              .flatMap(({ inputs }) => Object.entries(inputs ?? {}))
              .find(([path]) =>
                path.endsWith(
                  'node_modules/@neolorn/equator/fesm2022/neolorn-equator-core.mjs',
                ),
              );
            input[1].bytesInOutput += 100;
          },
        ),
        refusal:
          /docs\/reference\/cost\.md is not what the builds measure now/u,
      },
      {
        id: 'published-figure-edited',
        plant: (root) =>
          editText(root, 'docs/reference/cost.md', (text) =>
            text.replace(/\d{1,3}(?:,\d{3})+/u, (figure) =>
              (Number(figure.replaceAll(',', '')) + 1).toLocaleString('en-US'),
            ),
          ),
        refusal:
          /docs\/reference\/cost\.md is not what the builds measure now/u,
      },
      // A store layout the suffix does not match would attribute every input to nothing and print a
      // page of zeros, which a page generated the same way would agree with.
      {
        id: 'entry-point-attributed-to-nothing',
        plant: editJson(
          'tmp/focused-package-consumer-verification/minimal-runtime-consumer/dist/minimal/stats.json',
          (stats) => {
            for (const output of Object.values(stats.outputs)) {
              output.inputs = Object.fromEntries(
                Object.entries(output.inputs ?? {}).map(([path, value]) => [
                  path.replace('/@neolorn/equator/', '/@neolorn/elsewhere/'),
                  value,
                ]),
              );
            }
          },
        ),
        refusal:
          /Minimal consumer: no input of the build was attributed to @neolorn\/equator\./u,
      },
    ],
  },
  'verify:format-shapes': {
    script: 'tools/generate-format-shapes.mjs',
    args: ['--check'],
    inputs: [
      'dist/toolkit',
      'dist/runtime/types',
      'dist/runtime/fesm2022',
      'tools/format-shapes.json',
    ],
    plants: [
      {
        id: 'field-removed-under-the-same-stamp',
        plant: plantText(
          'dist/toolkit/output-host.d.ts',
          '    readonly ownerId: string;\n}\nexport interface ApplyOutputPlanRequest',
          '}\nexport interface ApplyOutputPlanRequest',
        ),
        refusal:
          /equator-work-owner\/1: \S+#WorkOwnerMarker\.ownerId: removed \(incompatible\)/u,
      },
      {
        id: 'field-added-to-a-closed-format',
        plant: plantText(
          'dist/toolkit/project-host.d.ts',
          '    readonly stateDigest: string;\n',
          '    readonly stateDigest: string;\n    readonly planted?: string;\n',
        ),
        refusal:
          /equator-compiler-cache\/1: \S+#CompilerCacheEnvelope\.planted: added as optional \(incompatible\)/u,
      },
      // Compatible, so it is not a reason to move the stamp, and still a difference the record does
      // not hold: the check is red until the record is written again.
      {
        id: 'optional-field-added-to-an-open-format',
        plant: plantText(
          'dist/toolkit/output-host.d.ts',
          '    readonly operations: readonly TransactionOperation[];\n',
          '    readonly operations: readonly TransactionOperation[];\n    readonly planted?: string;\n',
        ),
        refusal:
          /equator-output-transaction\/1: \S+#TransactionJournal\.planted: added as optional \(compatible\)/u,
      },
      {
        id: 'runtime-reader-field-retyped',
        plant: plantText(
          'dist/runtime/types/neolorn-equator-core.d.ts',
          '/** The stable name for this route, which is what every address is built from. */\n    readonly id: string;',
          '/** The stable name for this route, which is what every address is built from. */\n    readonly id: number;',
        ),
        refusal:
          /equator-route-projection\/1: \S+#GeneratedRouteProjection\.\S*\.id: type changed from "string" to "number" \(incompatible\)/u,
      },
      {
        id: 'published-schema-admits-other-data',
        plant: editJson(
          'dist/toolkit/schemas/cli-result.v1.schema.json',
          (schema) => {
            schema.properties.planted = { type: 'string' };
          },
        ),
        refusal:
          /equator-cli-result\/1: dist\/toolkit\/schemas\/cli-result\.v1\.schema\.json: the published schema admits different data \(incompatible\)/u,
      },
      {
        id: 'stamp-nothing-records',
        plant: plantText(
          'dist/toolkit/output-host.js',
          "export const WORK_OWNER_PROFILE = 'equator-work-owner/1';",
          "export const WORK_OWNER_PROFILE = 'equator-work-owner/1';\nexport const PLANTED_PROFILE = 'equator-planted-format/1';",
        ),
        refusal:
          /equator-planted-format\/1 \(in dist\/toolkit\/output-host\.js\): not a recorded format, a same-build stamp, or a digest label/u,
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
      'docs',
      'README.md',
      'packages/runtime/README.md',
      'packages/toolkit/README.md',
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
      {
        id: 'documented-example-imports-wiring',
        plant: (root) =>
          editText(
            root,
            'docs/how-to/translate-catalogs.md',
            (text) =>
              `${text}\n\`\`\`ts\nimport { ɵopenPageOutcomeChannel } from '@neolorn/equator/core';\n\`\`\`\n`,
          ),
        refusal:
          /^docs\/how-to\/translate-catalogs\.md: ɵopenPageOutcomeChannel from @neolorn\/equator\/core$/mu,
      },
      {
        id: 'fixture-reaches-wiring-through-a-namespace',
        plant: (root) =>
          editText(
            root,
            'fixtures/package-consumer-template/src/app/addresses.ts',
            (text) =>
              `${text}\nimport * as equatorCore from '@neolorn/equator/core';\nexport const planted = equatorCore.ɵopenPageOutcomeChannel;\n`,
          ),
        refusal:
          /^fixtures\/package-consumer-template\/src\/app\/addresses\.ts: ɵopenPageOutcomeChannel from @neolorn\/equator\/core$/mu,
      },
    ],
  },
  // Every run launches the three browser engines and the other Node rows, so the budget is the
  // stage's rather than the default one sized for a script that reads files.
  'verify:platform': {
    script: 'tools/verify-platform-capabilities.mjs',
    inputs: ['dist/toolkit', 'docs/reference/compatibility.md'],
    timeout: 600_000,
    plants: [
      {
        id: 'toolkit-keeps-a-deprecated-language',
        plant: plantText(
          'dist/toolkit/locales.js',
          '    const canonical = canonicalizeLanguageTag(locale);',
          "    const canonical = canonicalizeLanguageTag(locale) === 'he' ? 'iw' : canonicalizeLanguageTag(locale);",
        ),
        refusal:
          /The toolkit canonicalizes iw to iw, and the pinned CLDR alias data to he/u,
      },
      {
        id: 'canonicalizer-stops-before-the-alias-settles',
        plant: plantText(
          'dist/toolkit/language-tag.js',
          'const MAXIMUM_ALIAS_STEPS = 16;',
          'const MAXIMUM_ALIAS_STEPS = 0;',
        ),
        refusal:
          /Node v24\.18\.0 canonicalizes iw to refused, and the pinned CLDR alias data to he/u,
      },
      {
        id: 'host-gap-left-undocumented',
        plant: plantText(
          'docs/reference/compatibility.md',
          '\n| Node `22.22.3` | `Intl.DurationFormat` | `formatDuration` and the `localizedDuration` pipe |',
          '',
        ),
        refusal:
          /Node 22\.22\.3 lacks Intl\.DurationFormat, and docs\/reference\/compatibility\.md does not say so/u,
      },
      {
        id: 'host-gap-documented-and-absent',
        plant: plantText(
          'docs/reference/compatibility.md',
          '| Node `22.22.3` | `Intl.DurationFormat` | `formatDuration` and the `localizedDuration` pipe |',
          '| Node `22.22.3` | `Intl.DurationFormat` | `formatDuration` and the `localizedDuration` pipe |\n| Node `24.15.0` | `Intl.DurationFormat` | `formatDuration` and the `localizedDuration` pipe |',
        ),
        refusal:
          /docs\/reference\/compatibility\.md says Node 24\.15\.0 lacks Intl\.DurationFormat, and the probe did not find that on any host it ran/u,
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
  'verify:cost-budget': {
    script: 'tools/verify-cost-budget.mjs',
    nodeArgs: ['--expose-gc'],
    inputs: ['dist/runtime'],
    plants: [
      {
        // A heap reading needs the collector exposed. Without it both heap budgets have nothing
        // to read, and a run that reads nothing must not stand as one within budget.
        id: 'heap-growth-unmeasured',
        nodeArgs: [],
        refusal:
          /FAIL +the shared formatter store is bounded by its ceiling\n\s+not measured: node ran without --expose-gc[\s\S]*FAIL +repeated locale switching does not accumulate heap\n\s+not measured: node ran without --expose-gc/u,
      },
      {
        // The memo is what keeps a request from paying for the whole catalog. Without it every
        // context admits the catalog again, which costs the catalog's size on every request.
        id: 'catalog-admitted-on-every-request',
        plant: plantText(
          'dist/runtime/fesm2022/neolorn-equator.mjs',
          'admittedCatalogs.set(candidate, { key, catalog });',
          'void key;',
        ),
        refusal:
          /FAIL +request-scoped context construction is flat in catalog size/u,
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
