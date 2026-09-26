/**
 * A real application, built from the published packages and run in a browser and on a server.
 *
 * `specs/02-packages-and-platform.spec.md` section 11 lists what a distributable has to establish,
 * and most of it is only visible from outside: whether the export map resolves, whether one Angular
 * instance ends up in the graph, whether server rendering and the browser agree. The consumer is
 * materialized from a fixture and installs Equator the way anyone else would, because a consumer
 * wired to the workspace would resolve the sources instead of the published files.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import {
  lstat,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import {
  openCapabilityEvidence,
  recordCapabilityClaim,
} from './capability-evidence.mjs';
import {
  readConsumerAddresses,
  readConsumerBuilds,
  SITE_ORIGIN_DECLARATION,
} from './consumer-addresses.mjs';
import {
  claimExercisedContext,
  claimExercisedControls,
  claimExercisedExtensions,
  claimExercisedFormats,
  claimExercisedPipes,
  claimOverlayLocale,
  claimSheetParameter,
  exerciseSheetNames,
  exerciseAuthority,
  readExerciseSources,
  readExerciseInputs,
  sheetInDocument,
} from './exercise-sheet.mjs';
import { locateNode, withNodeFirst } from './node-runtimes.mjs';
import { withOfflineStoreRemedy } from './offline-store.mjs';

import {
  resolveAngularVersion,
  resolveConsumerProfile,
} from './package-consumer-profiles.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumerName = process.argv[2] ?? 'package-consumer';
const consumerProfile = resolveConsumerProfile(consumerName);
const consumerRoot = resolve(
  workspaceRoot,
  'tmp/package-consumer-verification',
  consumerName,
);

// A row on another Node line runs every step on that Node: this script, the package manager, and
// each tool the consumer's scripts start. Started again here rather than by the caller, so every
// caller gets the row's Node: the gate, the runtime assurance stage, and a person running the row.
if (
  consumerProfile.node !== undefined &&
  process.versions.node !== consumerProfile.node
) {
  const { executable, failure } = await locateNode(
    consumerProfile.node,
    consumerName,
  );
  if (failure !== undefined) throw new Error(failure);
  const rerun = spawnSync(
    executable,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: withNodeFirst(process.env, executable) },
  );
  process.exit(rerun.status ?? 1);
}

// The package manager this process was started by, run on this process's Node. Its command shim
// starts the machine's default Node whatever the search path says, which on a row for another Node
// line would install and build on the wrong one.
const pnpmEntry = process.env.npm_execpath;
assert.ok(
  pnpmEntry !== undefined && pnpmEntry !== '',
  'npm_execpath is not set, so there is no package manager to run the consumer with. Start this through "pnpm run", as the gate does.',
);

const spawnPnpm = (args, env = {}) =>
  spawnSync(process.execPath, [pnpmEntry, ...args], {
    cwd: consumerRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', ...env },
  });

const run = (args, expectedStatus = 0, env = {}) => {
  const result = spawnPnpm(args, env);

  assert.equal(
    result.status,
    expectedStatus,
    withOfflineStoreRemedy(
      [result.error?.message, result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n'),
    ),
  );
  return result;
};

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const verifyWatchCommand = async () => {
  const cliPath = resolve(
    consumerRoot,
    'node_modules/@neolorn/equator-toolkit/cli.js',
  );
  const sourcePath = resolve(consumerRoot, 'src/app/app.ts');
  const originalSource = await readFile(sourcePath, 'utf8');
  const child = spawn(process.execPath, [cliPath, 'watch'], {
    cwd: consumerRoot,
    env: { ...process.env, CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let changed = false;
  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    await writeFile(sourcePath, originalSource, 'utf8');
  };
  const completed = new Promise((resolvePromise, rejectPromise) => {
    // Bounded by progress rather than by elapsed time, for the same reason the test timeout is: it
    // is a hang detector, not a performance assertion. What this probe claims is that the watcher
    // reacts to a change, and nothing it claims is about speed, but a fixed budget had to cover
    // booting the CLI, two compile cycles and a Windows watch event, so it also measured how busy
    // the machine was. Three consumer stages went red together on one saturated run and all three
    // passed on the resume, same tree, same commit. Silence still fails, which is the failure worth
    // detecting; the ceiling still catches a watcher that talks without finishing.
    const IDLE_MILLISECONDS = 30_000;
    const CEILING_MILLISECONDS = 300_000;
    let idleTimer;
    let ceilingTimer;
    const fail = (why) => {
      clearTimeout(idleTimer);
      clearTimeout(ceilingTimer);
      child.kill('SIGTERM');
      rejectPromise(
        new Error(`Equator watch probe ${why}.\n${stdout}\n${stderr}`),
      );
    };
    const progressed = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => fail(`produced no output for ${IDLE_MILLISECONDS / 1000}s`),
        IDLE_MILLISECONDS,
      );
    };
    ceilingTimer = setTimeout(
      () => fail(`ran past its ${CEILING_MILLISECONDS / 1000}s ceiling`),
      CEILING_MILLISECONDS,
    );
    progressed();
    child.stdout.on('data', (chunk) => {
      progressed();
      stdout += chunk.toString();
      if (!changed && /Equator watch cycle 1:/u.test(stdout)) {
        changed = true;
        setTimeout(() => {
          void writeFile(sourcePath, `${originalSource}\n`, 'utf8');
        }, 100);
      }
      if (/Equator watch cycle 2:/u.test(stdout)) {
        void restore().then(() => child.kill('SIGTERM'));
      }
    });
    child.stderr.on('data', (chunk) => {
      progressed();
      stderr += chunk.toString();
    });
    child.once('error', rejectPromise);
    child.once('close', () => {
      clearTimeout(idleTimer);
      clearTimeout(ceilingTimer);
      resolvePromise(undefined);
    });
  });
  try {
    await completed;
  } finally {
    await restore();
  }
  assert.match(stdout, /Equator watch cycle 1:/u, stderr);
  assert.match(stdout, /Equator watch cycle 2:/u, stderr);
};

// The consumer names the package manager it is installed with, and it is the one this process was
// started by, so the install is the one the lock was written for.
assert.equal(
  `pnpm@${run(['--version']).stdout.trim()}`,
  (await readJson(resolve(consumerRoot, 'package.json'))).packageManager,
  'The consumer is installed with a package manager other than the one it names.',
);

run(['install', '--offline', '--frozen-lockfile']);

// The Node the consumer's own tools start on, asked of the consumer. A row whose tools ran on
// another Node would otherwise pass and leave only its claims to say so.
assert.equal(
  run(['exec', 'node', '--eval', 'process.stdout.write(process.versions.node)'])
    .stdout,
  consumerProfile.node ?? process.versions.node,
  "The consumer's tools start on a Node other than the one this row runs on.",
);

const help = run(['run', 'equator:help']);
assert.match(
  help.stdout,
  /Compile and safely publish generated #i18n artifacts/,
);
assert.match(help.stdout, /Reconcile changes in one foreground process/);

const parseMachineResult = (result) => {
  const value = JSON.parse(result.stdout.trim());
  assert.equal(value.profile, 'equator-cli-result/1');
  return value;
};

const invalidInvocation = parseMachineResult(
  run(['exec', 'equator', 'check', '--unknown-option', '--json'], 2),
);
assert.equal(invalidInvocation.status, 'invocation-or-configuration-failure');
assert.equal(invalidInvocation.diagnostics[0]?.code, 'EQ1701');

// Invoked directly rather than through a consumer script. Running `pnpm run equator:init` would
// prove that a human had typed that script into the fixture manifest, because Equator writes no
// such entry.
//
// One statement of what init is asked for, used both to invoke it and to say what it must produce.
// Comparing Equator's file against a literal copied from the fixture's own equator.config.json
// detects drift and locks no contract; the template ships no such file, so what is asserted is what
// init authored from these flags.
const INIT_REQUEST = Object.freeze({
  sourceLocale: 'en-US',
  defaultLocale: 'en-US',
  locales: ['en-US', 'ar-EG'],
});
const initArguments = [
  'exec',
  'equator',
  'init',
  '--source-locale',
  INIT_REQUEST.sourceLocale,
  '--default-locale',
  INIT_REQUEST.defaultLocale,
  ...INIT_REQUEST.locales.flatMap((locale) => ['--locale', locale]),
];
const initialized = run(initArguments);
// The template no longer ships the Equator-owned scripts, so the first init has real work to do.
// That is the point: a fixture that pre-types them answers the question this gate is asking.
// Both files, because the template ships neither: init is what authors them.
assert.match(
  initialized.stdout,
  /Equator init updated: equator\.config\.json, package\.json/u,
);
const reinitialized = run(initArguments);
assert.match(reinitialized.stdout, /Equator init is already complete/u);

// The minimal declaration `specs/10-compiler-and-tooling.spec.md` section 10 specifies: exactly
// these keys, no more, and every value traceable to what init was asked for. The run around it
// is section 14 of `specs/10-compiler-and-tooling.spec.md`, an ordinary first run through the
// built packages and their public exports. An extra key Equator started writing would fail here,
// which comparing against a fixture's own file could never do.
//
// Asserted here rather than after the build. What it states is what *init* authored, and after
// the build the file also carries the consumer's own declarations, so asserting it there would
// mean either weakening it to tolerate them or forbidding a consumer from adding a key Equator
// supports.
assert.deepEqual(await readJson(resolve(consumerRoot, 'equator.config.json')), {
  schemaVersion: 1,
  sourceLocale: INIT_REQUEST.sourceLocale,
  defaultLocale: INIT_REQUEST.defaultLocale,
  locales: [...INIT_REQUEST.locales],
});

// Two consumer edits to the configuration, and the only ones this gate makes. First the two
// pseudo-locales the toolkit generates. Declaring them changes no build, because
// `pnpm run build` still runs a plain `equator generate` and produces neither, and the fixture's
// `test` script runs
// `equator generate --pseudo`, so the page spec has a real generated catalog to render.
const PSEUDO_LOCALES = Object.freeze({
  'en-Latn-XA': { lengthFactor: 0.4, markers: true },
  'en-Arab-XB': { lengthFactor: -0.4, markers: true },
});
// Second, how one locale is written: declared for a pseudo-locale, and that is the case worth
// gating. `pseudoLocales` is part of the configuration whether or not `--pseudo` asked for one, so
// a production build's generated locale table does not list them; a formatting entry that survived
// into that table would name a locale the runtime does not have and would be refused on arrival.
// The fixture builds both ways, so both are proved here.
//
// Not `en-US` or `ar-EG`: nine specs in the lab assert digits in those two, and a declaration here
// would have made every one of them pass or fail for a reason it was not written for. What the
// runtime does with the table is asserted in `locale-formatting.spec.ts`, which builds its own.
const LOCALE_FORMATTING = Object.freeze({
  'en-Arab-XB': { numberingSystem: 'arab' },
});
await writeFile(
  resolve(consumerRoot, 'equator.config.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      sourceLocale: INIT_REQUEST.sourceLocale,
      defaultLocale: INIT_REQUEST.defaultLocale,
      locales: [...INIT_REQUEST.locales],
      pseudoLocales: PSEUDO_LOCALES,
      formatting: LOCALE_FORMATTING,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
// And the script entries Equator claims to own are asserted against Equator's own declaration, so
// this fails if Equator stops writing one rather than if a fixture stops listing one.
const { PACKAGE_SCRIPTS } = await import(
  pathToFileURL(
    resolve(
      consumerRoot,
      'node_modules/@neolorn/equator-toolkit/project-host.js',
    ),
  ).href
);
const consumerScripts = (await readJson(resolve(consumerRoot, 'package.json')))
  .scripts;
for (const [name, command] of Object.entries(PACKAGE_SCRIPTS)) {
  assert.equal(
    consumerScripts?.[name],
    command,
    `equator init did not write the ${name} script it declares`,
  );
}
run(['exec', 'equator', 'format']);
const canonicalFormat = parseMachineResult(
  run(['exec', 'equator', 'format', '--dry-run', '--json']),
);
assert.equal(canonicalFormat.status, 'success');
assert.equal(canonicalFormat.result.changed, false);

const firstGeneration = parseMachineResult(
  run(['exec', 'equator', 'generate', '--json']),
);
assert.equal(firstGeneration.status, 'success');
assert.equal(firstGeneration.result.changed, true);
assert.ok(firstGeneration.result.written.length > 0);
assert.ok(firstGeneration.result.catalogs >= 2);
assert.ok(firstGeneration.result.messages >= 4);
assert.ok(firstGeneration.result.routes >= 2);

// EQ1401 forwards a TypeScript finding from the consumer's own program, so one raised here is a
// report against the application's own lines. The fixture compiles under its own build, which
// leaves the generated modules the analysis reads in place of them as the thing that does not.
const forwardedTypeFindings = firstGeneration.diagnostics.filter(
  ({ code }) => code === 'EQ1401',
);
assert.deepEqual(
  forwardedTypeFindings,
  [],
  `Generation forwarded TypeScript findings against the consumer's own source:\n${JSON.stringify(forwardedTypeFindings, null, 2)}`,
);

const generatedManifestPath = resolve(
  consumerRoot,
  'src/generated/i18n/.equator-manifest.json',
);
const firstManifestTimestamp = (await lstat(generatedManifestPath)).mtimeMs;
const unchangedGeneration = parseMachineResult(
  run(['exec', 'equator', 'generate', '--json']),
);
assert.equal(unchangedGeneration.result.changed, false);
assert.equal(unchangedGeneration.result.invalidation.kind, 'none');
assert.equal(
  (await lstat(generatedManifestPath)).mtimeMs,
  firstManifestTimestamp,
);

const checked = parseMachineResult(run(['exec', 'equator', 'check', '--json']));
assert.equal(checked.status, 'success');
assert.equal(checked.result.fresh, true);

const dryClean = parseMachineResult(
  run(['exec', 'equator', 'clean', '--dry-run', '--json']),
);
assert.equal(dryClean.result.changed, true);
assert.ok(dryClean.result.removed.length > 0);
const cleaned = parseMachineResult(run(['exec', 'equator', 'clean', '--json']));
assert.equal(cleaned.result.changed, true);
await assert.rejects(lstat(resolve(consumerRoot, 'src/generated/i18n')), {
  code: 'ENOENT',
});
await assert.rejects(lstat(resolve(consumerRoot, '.equator')), {
  code: 'ENOENT',
});
const regenerated = parseMachineResult(
  run(['exec', 'equator', 'generate', '--json']),
);
assert.equal(regenerated.result.changed, true);

const generatedManifest = await readJson(generatedManifestPath);
assert.equal(generatedManifest.profile, 'equator-completion-manifest/1');
for (const required of [
  'index.ts',
  'shell.ts',
  'routes.ts',
  'recovery.ts',
  'catalog-set.json',
  'catalog-set.ts',
  'catalog-loaders.ts',
  'recovery-payload.ts',
  'resource-summary.json',
]) {
  assert.ok(
    generatedManifest.files.some(({ path }) => path === required),
    `Generated Equator output is missing ${required}`,
  );
}
const generatedShell = await readFile(
  resolve(consumerRoot, 'src/generated/i18n/shell.ts'),
  'utf8',
);
assert.match(generatedShell, /GeneratedMessageHandle/);
assert.match(generatedShell, /defineMessageFamily/);
assert.match(generatedShell, /feature:uppercase/);
assert.match(generatedShell, /feature:badge/);
const generatedIndex = await readFile(
  resolve(consumerRoot, 'src/generated/i18n/index.ts'),
  'utf8',
);
assert.match(generatedIndex, /extensionDescriptors/);
assert.match(generatedIndex, /feature:sku-format/);
assert.match(generatedIndex, /feature:sku-parse/);

// The names the switcher renders come from the build, not from whatever CLDR the visitor's engine
// carries. Asserted on the emitted module rather than on the table it was read from: what a
// consumer ships is this line, and a lookup that silently stopped emitting would leave every
// engine free to disagree again with nothing failing.
assert.ok(
  generatedIndex.includes(
    `localeNames: Object.freeze({"en-US":"American English","ar-EG":"العربية (مصر)"} as const)`,
  ),
  'The generated configuration does not carry an endonym for each configured locale.',
);
assert.match(
  await readFile(resolve(consumerRoot, 'src/generated/i18n/routes.ts'), 'utf8'),
  /profile: 'equator-route-projection\/1'/,
);
const generatedRoutes = await readFile(
  resolve(consumerRoot, 'src/generated/i18n/routes.ts'),
  'utf8',
);
// Derived, because this route declares no identity. Only the three parameterised routes pin one.
assert.match(generatedRoutes, /id: "route:second", path: "second"/);
assert.match(generatedRoutes, /id: "item", path: "items\/:id"/);
// A const tuple, not `readonly string[]`. A route's parameter names are part of its contract:
// erased to an array, the type that requires codecs cannot tell a parameterised route from a
// parameterless one.
assert.match(
  generatedRoutes,
  /parameterNames: Object\.freeze\(\["id"\] as const\)/,
);
assert.match(generatedRoutes, /identity: "sha256-[A-Za-z0-9_-]{43}"/);
assert.match(
  await readFile(
    resolve(consumerRoot, '.equator/cache/compiler-state.json'),
    'utf8',
  ),
  /equator-compiler-cache\/1/,
);

const negativeCatalogPath = resolve(consumerRoot, 'i18n/shell/ar-EG.yaml');
const validNegativeCatalog = await readFile(negativeCatalogPath, 'utf8');
await writeFile(negativeCatalogPath, 'messages:\n  app-title: [\n', 'utf8');
const invalidCheck = parseMachineResult(
  run(['exec', 'equator', 'check', '--json'], 1),
);
assert.equal(invalidCheck.status, 'diagnostic-failure');
assert.ok(
  invalidCheck.diagnostics.some(
    ({ code, span }) =>
      code === 'EQ1101' && span?.sourcePath === 'i18n/shell/ar-EG.yaml',
  ),
  'Machine-readable catalog diagnostics are not source-located',
);
await writeFile(negativeCatalogPath, validNegativeCatalog, 'utf8');
assert.equal(
  parseMachineResult(run(['exec', 'equator', 'check', '--json'])).status,
  'success',
);

// Stale-translation detection, end to end, through the sequence that produces it rather than
// through a state file written here.
//
// The unit tests cover the reconciliation and the mutation gate covers its branches, but nothing
// exercised the whole chain: a real run writes the record, an English message moves afterwards,
// and the next run reports the translation that no longer describes it. A checked-in fixture state
// file would not have tested this: it would have tested a file authored alongside the assertion,
// which is the failure this gate exists to avoid.
const translationStatePath = resolve(
  consumerRoot,
  '.equator-translation-state.json',
);
const recordedState = JSON.parse(await readFile(translationStatePath, 'utf8'));
assert.equal(
  recordedState.profile,
  'equator-translation-state/1',
  'No translation state was recorded by the runs above',
);
// Keyed by provider, scope, message and target locale, so the assertion names the parts it
// depends on rather than a whole key it would have to be rewritten to match.
assert.ok(
  Object.keys(recordedState.entries).some((key) =>
    key.endsWith(':shell:app-title:ar-EG'),
  ),
  'The translation state records no entry for a translated message',
);

const sourceCatalogPath = resolve(consumerRoot, 'i18n/shell/en-US.yaml');
const originalSourceCatalog = await readFile(sourceCatalogPath, 'utf8');
await writeFile(
  sourceCatalogPath,
  originalSourceCatalog.replace(
    'app-title: Equator feature lab',
    'app-title: Equator feature laboratory',
  ),
  'utf8',
);
assert.notEqual(
  await readFile(sourceCatalogPath, 'utf8'),
  originalSourceCatalog,
  'The stale-translation probe did not change the source message',
);

// The release gate, end to end, on the artifact a pipeline actually runs.
//
// Two runs of the same command, one configuration line apart, asserted on the **exit status**
// because that is the only part of this a pipeline reads. The lab ships a `source-only` message
// that `ar-EG` deliberately does not translate, and the source catalog is edited above, so this
// consumer is incomplete in two of the family's four ways at once: a message is missing, and a
// translation now answers a superseded English message.
//
// The first run has no declaration and must fail, reporting both members at `error`. The second
// declares `ar-EG` still in progress and must pass, with both findings still reported, at
// `warning`, carrying the declared reason. That is the whole contract: an exemption is not a
// silence, and neither is an escalation.
//
// `check` is used rather than `generate` on purpose. `check` reports what it sees and leaves the
// translation record alone; `generate` publishes and re-stamps it, which retires the staleness.
// Running these after the `generate` below would assert against a condition it had consumed.
const gatedRun = parseMachineResult(
  run(['exec', 'equator', 'check', '--require-complete', '--json'], 1),
);
// Both members, and not only the first one found. A run that returns as soon as an escalated
// `EQ1307` fails the catalog analysis inspects neither output freshness nor the translation
// record, so the missing translation and the superseded one arrive as one finding rather than two,
// and turning the gate on gives the pipeline that asked for more information less. A run reports
// every member it can observe.
for (const code of ['EQ1307', 'EQ1309']) {
  assert.ok(
    gatedRun.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === code && diagnostic.severity === 'error',
    ),
    `The release gate did not report ${code} against a locale that is both incomplete and stale: ${JSON.stringify(
      gatedRun.diagnostics,
    )}`,
  );
}

const consumerConfigurationPath = resolve(consumerRoot, 'equator.config.json');
const consumerConfiguration = await readFile(consumerConfigurationPath, 'utf8');
await writeFile(
  consumerConfigurationPath,
  `${JSON.stringify(
    {
      ...JSON.parse(consumerConfiguration),
      inProgress: {
        'ar-EG': { note: 'Arabic copy lands with the Q4 launch.' },
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
);
const exemptRun = parseMachineResult(
  run(['exec', 'equator', 'check', '--require-complete', '--json'], 0),
);
for (const code of ['EQ1307', 'EQ1309']) {
  assert.ok(
    exemptRun.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === code &&
        diagnostic.severity === 'warning' &&
        diagnostic.summary.includes('ar-EG is declared still in progress') &&
        diagnostic.summary.includes('Q4 launch'),
    ),
    `${code} did not survive the in-progress declaration as a warning carrying its reason: ${JSON.stringify(
      exemptRun.diagnostics,
    )}`,
  );
}
// The fourth member is in the family because the declaration reached it. `EQ1309` is raised from
// the project host rather than the catalog analysis, so nothing but this says the two halves read
// the same rule.
await writeFile(consumerConfigurationPath, consumerConfiguration, 'utf8');

const staleRun = parseMachineResult(
  run(['exec', 'equator', 'generate', '--json']),
);
const staleReport = staleRun.diagnostics.filter(
  ({ code }) => code === 'EQ1309',
);
assert.ok(
  staleReport.some(
    ({ summary, severity }) =>
      severity === 'warning' &&
      summary.includes('"app-title"') &&
      summary.includes('ar-EG'),
  ),
  `A translation whose source moved was not reported as stale: ${JSON.stringify(staleReport)}`,
);

await writeFile(sourceCatalogPath, originalSourceCatalog, 'utf8');
assert.equal(
  parseMachineResult(
    run(['exec', 'equator', 'generate', '--json']),
  ).diagnostics.filter(({ code }) => code === 'EQ1309').length,
  0,
  'A translation was still reported stale after its source was restored',
);

/**
 * A person-name locale an application declares but is not translated into.
 *
 * Without this key the failure is quiet in the worst way: a Japanese name inside an English
 * interface is ordered correctly, English's own data says Japanese names are surname-first,
 * and spaced wrongly, because the spacing belongs to `ja` and `ja` was never generated. Nothing
 * errors, nothing is reported, and only a reader of the language sees it. So the check is that
 * declaring the locale actually changes the artifact, run through `equator generate` rather than
 * through the library.
 */
async function verifyDeclaredPersonNameLocales() {
  const configurationPath = resolve(consumerRoot, 'equator.config.json');
  const original = await readFile(configurationPath, 'utf8');
  const personNamesPath = resolve(
    consumerRoot,
    'src/generated/i18n/person-names.ts',
  );

  const rowTags = async () => {
    const module = await readFile(personNamesPath, 'utf8');
    const rows = /"rows":\[(.*)\]\}/su.exec(module)?.[1] ?? '';
    return [...rows.matchAll(/\["([a-zA-Z0-9-]+)",\[/gu)].map(([, tag]) => tag);
  };

  // The configured locales and nothing else, which is the default this key exists to widen.
  assert.deepEqual(
    await rowTags(),
    ['ar', 'en'],
    'The generated person-name artifact did not carry exactly the configured locales',
  );

  const declared = JSON.parse(original);
  await writeFile(
    configurationPath,
    `${JSON.stringify({ ...declared, personNameLocales: ['ja'] }, null, 2)}\n`,
    'utf8',
  );
  run(['exec', 'equator', 'generate', '--json']);
  assert.deepEqual(
    await rowTags(),
    ['ar', 'en', 'ja'],
    'Declaring a person-name locale did not add its profile to the generated artifact',
  );

  // A locale the pinned release does not cover has to say so. Silence here would be the same
  // silence the key exists to break, one level up.
  await writeFile(
    configurationPath,
    `${JSON.stringify({ ...declared, personNameLocales: ['zxx'] }, null, 2)}\n`,
    'utf8',
  );
  const uncovered = parseMachineResult(
    run(['exec', 'equator', 'generate', '--json']),
  ).diagnostics.filter(({ code }) => code === 'EQ1004');
  assert.ok(
    uncovered.some(
      ({ severity, summary }) =>
        severity === 'warning' && summary.includes('"zxx"'),
    ),
    `A declared person-name locale with no CLDR patterns was not reported: ${JSON.stringify(uncovered)}`,
  );

  await writeFile(configurationPath, original, 'utf8');
  run(['exec', 'equator', 'generate', '--json']);
  assert.deepEqual(
    await rowTags(),
    ['ar', 'en'],
    'The person-name artifact did not return to the configured locales',
  );
}

await verifyDeclaredPersonNameLocales();

await verifyWatchCommand();

// Code that must not compile. The only way to prove a type error is reported is to compile
// something that should produce it and check that it did; a passing test cannot express the
// absence of a rejection. The whole fixture tree once had three @ts-expect-error lines, every
// one on the direct API and none in a template, so the contract LocalizePipe, LocalizedMessage
// and the route builder carry was unverified in the places it exists for.
//
// One file at a time, because the Angular compiler reports template diagnostics only when the
// program it is checking has no ordinary TypeScript errors: a file carrying both kinds would
// silently prove only half of what it claims.
const negativeFiles = (await readdir(resolve(consumerRoot, 'src')))
  .filter((name) => name.endsWith('.negative.ts'))
  .sort();
assert.ok(
  negativeFiles.length > 0,
  'The consumer fixture declares no negative compilation files',
);
for (const negativeFile of negativeFiles) {
  const negativeSource = await readFile(
    resolve(consumerRoot, 'src', negativeFile),
    'utf8',
  );
  const expectedNegatives = [
    ...negativeSource.matchAll(/^\/\/ EXPECT: (.+)$/gmu),
  ].map(([, text]) => text.trim());
  assert.ok(
    expectedNegatives.length > 0,
    `${negativeFile} declares no expected diagnostics`,
  );
  await writeFile(
    resolve(consumerRoot, 'tsconfig.negative.json'),
    `${JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: { noEmit: true, types: ['node'] },
        include: [`src/${negativeFile}`],
      },
      null,
      2,
    )}
`,
    'utf8',
  );
  const negative = run(['exec', 'ngc', '-p', 'tsconfig.negative.json'], 1);
  const negativeOutput = `${negative.stdout}
${negative.stderr}`;
  for (const expected of expectedNegatives) {
    assert.ok(
      negativeOutput.includes(expected),
      `${negativeFile} did not report ${JSON.stringify(expected)}:
${negativeOutput}`,
    );
  }
}

// A spec file that stops being collected passes silently. The runner reports success for the files
// it did collect and exits zero, so the status this call already asserts cannot tell forty-three
// specs from forty-two: the defect `verify-document-blocks.mjs` fixed for the README block,
// left standing here over the lab's whole suite.
//
// The number to check against is counted from the consumer's sources rather than written down, so
// adding a spec needs no edit here and deleting one is the same failure as failing to collect it.
// Vitest colours its summary, so the counts are read off the plain text rather than off whatever
// the terminal was told to draw. Both lines are matched loosely because a skipped file or case puts
// `| n skipped` between the count and the total: a spec written for an address only some URL
// policies have is skipped under the others, and is still collected.
// Node 25 turned on its own Web Storage, and without a storage file its `localStorage` is
// undefined. Vitest 4 keeps a global Node already defines instead of taking jsdom's, so the specs
// would read Node's rather than the browser's jsdom stands in for. Vitest 5 takes jsdom's
// (vitest-dev/vitest#10293), and Angular 22's test builder accepts Vitest 4 only. So the specs'
// process turns Node's off where Node has it. The server bundle keeps it, as a server on that Node
// does.
const tested = run(
  ['test'],
  0,
  'localStorage' in globalThis
    ? {
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--no-experimental-webstorage']
          .filter(Boolean)
          .join(' '),
      }
    : {},
);
const testedOutput = `${tested.stdout}\n${tested.stderr}`.replaceAll(
  /\u001B\[[0-9;]*m/gu,
  '',
);
const specFiles = (
  await readdir(resolve(consumerRoot, 'src'), { recursive: true })
).filter((entry) => entry.endsWith('.spec.ts'));
assert.ok(
  specFiles.length > 0,
  'The consumer carries no spec files, so the count below would assert nothing',
);
const collectedFiles =
  /Test Files\s+(?:(\d+) failed\s+\|\s+)?(\d+) passed(?:\s+\|\s+(\d+) skipped)?\s+\((\d+)\)/u.exec(
    testedOutput,
  );
assert.ok(
  collectedFiles !== null,
  `The consumer's test run reported no file count:\n${testedOutput}`,
);
assert.equal(
  Number(collectedFiles[4]),
  specFiles.length,
  `The consumer has ${specFiles.length} spec file(s) and the run collected ${collectedFiles[4]}:\n${testedOutput}`,
);
assert.equal(
  Number(collectedFiles[2]) + Number(collectedFiles[3] ?? 0),
  Number(collectedFiles[4]),
  `The consumer's test run did not pass every spec file:\n${testedOutput}`,
);
const collectedCases = /Tests\s+(\d+) passed[^\n(]*\((\d+)\)/u.exec(
  testedOutput,
);
assert.ok(
  collectedCases !== null && Number(collectedCases[1]) > 0,
  `The consumer's test run reported no passing cases:\n${testedOutput}`,
);

// The test script generated the pseudo-locales; the build must not carry them. Regenerating
// without the flag is what returns the generated output to production shape, and doing it here
// rather than trusting the build to is the difference between asserting the switch works and
// assuming it does: every check below reads what this produced.
run(['exec', 'equator', 'generate']);
run(['exec', 'ng', 'build', '--stats-json']);

const configuration = await readJson(
  resolve(consumerRoot, 'equator.config.json'),
);
// What init wrote is asserted above, at init. What is asserted here is that nothing since has
// changed it except the two declarations this gate made, so a key appearing from anywhere else
// still fails. `equator format` rewrote the file between those two points and both survived it.
assert.deepEqual(configuration, {
  schemaVersion: 1,
  sourceLocale: INIT_REQUEST.sourceLocale,
  defaultLocale: INIT_REQUEST.defaultLocale,
  locales: [...INIT_REQUEST.locales],
  pseudoLocales: PSEUDO_LOCALES,
  formatting: LOCALE_FORMATTING,
});

// The production build ran a plain `equator generate`, so neither pseudo-locale is in what it
// produced: declared and not generated, which is the whole separation. The control is `ar-EG`
// in the same text: without it these two absences would pass for a file that was never read.
//
// The formatting declaration above names one of those pseudo-locales, so this now proves the
// emission filter too: a table that carried an entry for a locale the production build's own
// locale list does not have would name it here, and the runtime would refuse the configuration on
// arrival rather than at build time.
const generatedRoot = resolve(consumerRoot, 'src/generated/i18n');
const generatedLocaleTable = await readFile(
  resolve(generatedRoot, 'index.ts'),
  'utf8',
);
for (const tag of Object.keys(PSEUDO_LOCALES)) {
  assert.ok(
    !generatedLocaleTable.includes(tag),
    `The production build's locale table contains the pseudo-locale ${tag}`,
  );
}
assert.ok(
  generatedLocaleTable.includes('ar-EG'),
  'The generated locale table was not read, so the absences above mean nothing',
);

const consumerPackage = await readJson(resolve(consumerRoot, 'package.json'));
assert.deepEqual(consumerPackage.imports, {
  '#i18n': './src/generated/i18n/index.ts',
  '#i18n/*': './src/generated/i18n/*.ts',
});
// Checked against Equator's own declaration above, not against a list copied here. This block used
// to hardcode an `equator:init` entry with the fixture's exact locale flags: a value Equator never
// writes and a human had typed.
for (const [name, command] of Object.entries(PACKAGE_SCRIPTS)) {
  assert.equal(
    consumerPackage.scripts[name],
    command,
    `The generated manifest lost the ${name} script Equator declares`,
  );
}
for (const locale of configuration.locales) {
  assert.match(
    await readFile(resolve(consumerRoot, `i18n/shell/${locale}.yaml`), 'utf8'),
    /^messages:\s*$/mu,
    `${locale} golden catalog is not wired`,
  );
}

assert.equal(
  (
    await readJson(
      resolve(consumerRoot, 'node_modules/@angular/core/package.json'),
    )
  ).version,
  consumerProfile.angular,
);
// Angular's tooling train can sit ahead of the framework train, so the row is only pinned if both
// halves are asserted. Reading only `@angular/core` would let the tooling drift unnoticed.
assert.equal(
  (
    await readJson(
      resolve(consumerRoot, 'node_modules/@angular/ssr/package.json'),
    )
  ).version,
  resolveAngularVersion(consumerProfile, '@angular/ssr'),
);
assert.equal(
  (
    await readJson(
      resolve(consumerRoot, 'node_modules/typescript/package.json'),
    )
  ).version,
  consumerProfile.typescript,
);
assert.equal(
  (await readJson(resolve(consumerRoot, 'node_modules/rxjs/package.json')))
    .version,
  consumerProfile.rxjs,
);
assert.equal(
  (
    await readJson(
      resolve(consumerRoot, 'node_modules/@neolorn/equator/package.json'),
    )
  ).name,
  '@neolorn/equator',
);
assert.equal(
  (
    await readJson(
      resolve(
        consumerRoot,
        'node_modules/@neolorn/equator-toolkit/package.json',
      ),
    )
  ).name,
  '@neolorn/equator-toolkit',
);

const stats = await readJson(
  resolve(consumerRoot, 'dist/feature-lab/stats.json'),
);
assert.equal(typeof stats.inputs, 'object', 'Angular stats inputs are absent');
assert.equal(
  typeof stats.outputs,
  'object',
  'Angular stats outputs are absent',
);

const installedRuntimeRoot = await realpath(
  resolve(consumerRoot, 'node_modules/@neolorn/equator'),
);
const installedToolkitRoot = await realpath(
  resolve(consumerRoot, 'node_modules/@neolorn/equator-toolkit'),
);
const installedRuntimePackage = await readJson(
  resolve(installedRuntimeRoot, 'package.json'),
);
const testingEntry = await realpath(
  resolve(
    installedRuntimeRoot,
    installedRuntimePackage.exports['./testing'].default,
  ),
);
const formsEntry = await realpath(
  resolve(
    installedRuntimeRoot,
    installedRuntimePackage.exports['./forms'].default,
  ),
);
const routerEntry = await realpath(
  resolve(
    installedRuntimeRoot,
    installedRuntimePackage.exports['./router'].default,
  ),
);
const isWithin = (candidate, owner) => {
  const path = relative(owner, candidate);
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  );
};
const resolveStatsInput = async (input) => {
  const candidate = resolve(consumerRoot, input);
  try {
    return await realpath(candidate);
  } catch {
    return undefined;
  }
};

const productionInputs = new Set();
for (const output of Object.values(stats.outputs)) {
  for (const input of Object.keys(output.inputs ?? {})) {
    productionInputs.add(input);
  }
}
const canonicalProductionInputs = new Set(
  (
    await Promise.all(
      [...productionInputs].map((input) => resolveStatsInput(input)),
    )
  ).filter((input) => input !== undefined),
);
assert.equal(
  canonicalProductionInputs.has(formsEntry),
  true,
  'Production feature lab did not consume the Equator Forms entrypoint',
);
assert.equal(
  canonicalProductionInputs.has(routerEntry),
  true,
  'Production feature lab did not consume the Equator Router entrypoint',
);
for (const input of productionInputs) {
  const canonicalInput = await resolveStatsInput(input);
  if (canonicalInput === undefined) {
    continue;
  }

  assert.equal(
    isWithin(canonicalInput, installedToolkitRoot),
    false,
    `Production output contains toolkit input: ${input}`,
  );
  assert.notEqual(
    canonicalInput,
    testingEntry,
    `Production output contains the Equator testing entrypoint: ${input}`,
  );
}

const browserEntry = Object.entries(stats.outputs).find(
  ([, output]) => output.entryPoint === 'src/main.ts',
);
assert.notEqual(browserEntry, undefined, 'Browser entry metadata is absent');
const pendingBrowserOutputs = [browserEntry[0]];
const visitedBrowserOutputs = new Set();
while (pendingBrowserOutputs.length > 0) {
  const outputName = pendingBrowserOutputs.pop();
  if (visitedBrowserOutputs.has(outputName)) {
    continue;
  }
  visitedBrowserOutputs.add(outputName);
  const output = stats.outputs[outputName];
  assert.notEqual(output, undefined, `Browser output ${outputName} is absent`);

  for (const input of Object.keys(output.inputs ?? {})) {
    for (const imported of stats.inputs[input]?.imports ?? []) {
      assert.equal(
        isBuiltin(imported.path),
        false,
        `Browser graph imports Node built-in ${imported.path} from ${input}`,
      );
    }
  }
  for (const imported of output.imports ?? []) {
    assert.equal(
      isBuiltin(imported.path),
      false,
      `Browser output imports Node built-in ${imported.path}`,
    );
    const importedOutput = imported.path.replace(/^\.\//u, '');
    if (!imported.external && stats.outputs[importedOutput] !== undefined) {
      pendingBrowserOutputs.push(importedOutput);
    }
  }
}

const browserRoot = resolve(consumerRoot, 'dist/feature-lab/browser');
const serverRoot = resolve(consumerRoot, 'dist/feature-lab/server');
const collectJavaScript = async (root) => {
  const files = [];

  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScript(path)));
    } else if (['.js', '.mjs'].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
};

const browserFiles = await collectJavaScript(browserRoot);
assert.ok(browserFiles.length > 0, 'Browser build emitted no JavaScript');
assert.ok(
  (await collectJavaScript(serverRoot)).length > 0,
  'SSR build is absent',
);
/**
 * Every prerendered address, as a set.
 *
 * A set rather than a count, and read from disk rather than from the build's own report. A
 * prerendered route whose component throws is dropped and still counted: the build exits 0, writes
 * no file at that address, and reports the route anyway. On 22.0.6, 22.1.3 and 22.1.5, one
 * component throwing gives 2 files on disk against `Prerendered 4 static routes.` and 4 entries in
 * `prerendered-routes.json`. Under the two-layer table every address a visitor reaches is a
 * locale-branch address, so a branch that fails to render leaves a hole at the only address anyone
 * uses while the canonical branch, which nobody uses, looks fine.
 *
 * **Fixed upstream and released in 22.1.7** (`f1fd823`, angular/angular-cli#33965). Re-measured on
 * the bump with the same injected throw: the build now fails, exit 1, `Application bundle
 * generation failed.`, naming `/en-us/second` and `/ar-eg/second` and reporting `Prerendered 2
 * static routes.`. The two that rendered, not the four declared. No `dist` is written at all.
 *
 * The set comparison stays, and the reason it stays is not that Angular might regress. It is that
 * a missing prerendered file has causes that are not Angular's (a route the projection did not
 * emit, a canonical suppression that stopped suppressing, a locale branch that resolved to
 * nothing) and the set is what catches every one of them. A count or an exit code was only ever
 * reading one of the causes, and reads it correctly now by accident of someone else's fix.
 *
 * It is also what holds the canonical suppression. `localizedServerRoutes` declares the canonical
 * spelling of every route `RenderMode.Server`, so `/index.html`, `/second/index.html` and
 * `/articles/handbook/index.html` are never written. Asserting only that the four expected
 * files exist would pass with all seven present, which is how this was passing before: nothing
 * suppressed the canonical branch and the consumer's `**` fallback happened to catch it.
 *
 * `second` is spelled `second` in both locales because this fixture declares no `localizedPaths`.
 * Only the article slug is translated, through its codec, which is the harder half anyway, since
 * the two article addresses share no path segment.
 */
const collectPrerendered = async (root, prefix = '') => {
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      paths.push(
        ...(await collectPrerendered(
          resolve(root, entry.name),
          `${prefix}${entry.name}/`,
        )),
      );
    } else if (entry.name === 'index.html') {
      paths.push(`${prefix}index.html`);
    }
  }
  return paths;
};

// Where each page lives, read from the address table the consumer's own specs read, and where each
// build answers.
const addresses = await readConsumerAddresses(consumerRoot);
const builds = await readConsumerBuilds(consumerRoot);
const policySource = await readFile(builds.policyPath, 'utf8');

/**
 * The file prerendering writes a page to, or nothing where the page is not prerendered or has no
 * address. In a build that generates pseudo-locales, an address one of them also spells is rendered
 * on request instead, which the table says where it happens.
 */
const prerenderedFile = (page, locale, { pseudo = false } = {}) =>
  addresses.prerendered.includes(page) &&
  addresses.has(page, locale) &&
  !(pseudo && addresses.sharedWithPseudoLocales(page, locale))
    ? addresses.file(page, locale)
    : undefined;

/** Every file the prerender writes for these locales. */
const prerenderedFiles = (locales, options) =>
  locales.flatMap((locale) =>
    addresses.prerendered
      .map((page) => prerenderedFile(page, locale, options))
      .filter((file) => file !== undefined),
  );

/** The origins these locales are served at, each once. A locale with no address has none. */
const originsOf = (locales) => [
  ...new Set(
    locales
      .map((locale) => addresses.origin(locale))
      .filter((origin) => origin !== undefined),
  ),
];

/** The locales among these that the build answering at `origin` serves. */
const servedAt = (origin, locales) =>
  locales.filter((locale) => addresses.origin(locale) === origin);

/**
 * Builds the consumer as its deployment at `origin` is built, into `output`.
 *
 * At the declared origin that is the source as it stands. At any other it is the same source with
 * `SITE_ORIGIN` changed, which is how a deployment that puts each locale on its own origin builds
 * for the rest, put back even when the build fails, because every later step reads the declared
 * build and its source.
 */
async function buildAt(origin, output) {
  if (origin === builds.siteOrigin) {
    run(['exec', 'ng', 'build', '--output-path', output]);
    return;
  }
  await writeFile(
    builds.policyPath,
    policySource.replace(
      SITE_ORIGIN_DECLARATION,
      () => `export const SITE_ORIGIN = '${origin}';`,
    ),
    'utf8',
  );
  try {
    run(['exec', 'ng', 'build', '--output-path', output]);
  } finally {
    await writeFile(builds.policyPath, policySource, 'utf8');
  }
}

/**
 * What the build at `root`, answering at `origin`, prerendered: exactly the files of the pages its
 * own locales have addresses for, each rendering its page in its locale.
 */
async function verifyPrerendered(root, origin, locales) {
  const served = servedAt(origin, locales);
  const emitted = (await collectPrerendered(root)).sort();
  const expected = prerenderedFiles(served).sort();
  assert.deepEqual(
    emitted,
    expected,
    `The prerendered address set at ${origin} is wrong.\nEmitted:\n  ${emitted.join('\n  ')}\nExpected:\n  ${expected.join('\n  ')}`,
  );

  for (const locale of served) {
    const file = prerenderedFile('second', locale);
    // No address in that locale is no file, which the set above has already held the build to.
    if (file === undefined) continue;
    assert.match(
      await readFile(resolve(root, file), 'utf8'),
      /data-route-view="second"/u,
      `${locale} prerendered route is absent`,
    );
  }

  // One declaration per route, expanded to every locale by the policy Equator already has. The
  // article route is the one that is hard by hand: its slug is spelled differently per locale, so
  // its two prerendered addresses share no path segment. A hand-written table that missed one
  // would not fail anywhere: it would ship a page that exists in English and 404s in Arabic.
  for (const language of served) {
    const file = prerenderedFile('article', language);
    if (file === undefined) continue;
    const prerendered = await readFile(resolve(root, file), 'utf8');
    assert.match(
      prerendered,
      /data-route-view="article"/u,
      `${language} prerendered article route is absent`,
    );
    assert.match(
      prerendered,
      new RegExp(`lang="${language}"`, 'u'),
      `${language} prerendered article was rendered in the wrong locale`,
    );
    // The measurement the server-side locale source rests on.
    //
    // Equator reads the address being rendered from `PlatformLocation`, because `@angular/ssr`
    // provides `REQUEST` and `REQUEST_CONTEXT` only when the render mode is `Server`: a
    // prerendered page has neither. Two things had to be true for that to work and only one of
    // them was ever measured: that `PlatformLocation` is injectable from an application-config-level
    // factory, and that under prerendering it carries the address being rendered rather than `/`.
    // This is a prerendered page, so its own address here is that second fact, observed.
    const probe = /"feature-lab-ssr-probe":(\{.*?\})/su.exec(prerendered);
    assert.ok(
      probe,
      `${language} prerendered article carried no SSR probe state`,
    );
    const platformPath = JSON.parse(probe[1]).platformPath;
    assert.notEqual(
      platformPath,
      'unavailable',
      'PlatformLocation did not resolve during prerendering, so the server locale source has no address to read',
    );
    // Decoded on both sides, because which of the two spellings `pathname` holds is Angular's.
    assert.equal(
      decodeURIComponent(platformPath),
      decodeURIComponent(addresses.path('article', language)),
      `PlatformLocation reported ${JSON.stringify(platformPath)} while prerendering the ${language} article, so it does not carry the rendered address`,
    );
  }
}

// One build for each origin the locales are served at. Under a path policy that is the one build
// above; under a host policy each origin prerenders its own locale's pages and no other's.
for (const origin of originsOf(INIT_REQUEST.locales)) {
  const output = builds.output(origin);
  if (origin !== builds.siteOrigin) await buildAt(origin, output);
  await verifyPrerendered(
    resolve(consumerRoot, output, 'browser'),
    origin,
    INIT_REQUEST.locales,
  );
}

// What these builds' servers answer, asked on this row's Node. The browser stage asks the same
// servers, on the gate's own Node only, so without this a row for another Node line would build a
// server and never start it.
openCapabilityEvidence('consumer-stage', { consumer: consumerRoot });

/** The answers of the builds above to these requests, in order: `[{ origin, path, headers }]`. */
function serverAnswers(requests) {
  const answersFile = resolve(consumerRoot, 'tmp/server-answers.json');
  mkdirSync(dirname(answersFile), { recursive: true });
  const asked = spawnSync(
    process.execPath,
    [
      resolve(workspaceRoot, 'tools/consumer-server-answers.mjs'),
      consumerRoot,
      answersFile,
    ],
    {
      input: JSON.stringify(requests),
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  assert.equal(
    asked.status,
    0,
    `The consumer's server did not answer.\n${asked.error ?? ''}${asked.stdout}${asked.stderr}`,
  );
  return JSON.parse(readFileSync(answersFile, 'utf8'));
}

function verifyServerAnswers() {
  const locales = INIT_REQUEST.locales.filter((locale) =>
    addresses.has('home', locale),
  );
  const asked = [
    ...locales.map((locale) => ({ page: 'home', locale })),
    { page: 'missing', locale: INIT_REQUEST.sourceLocale },
  ];
  const answers = serverAnswers(
    asked.map(({ page, locale }) => ({
      origin: addresses.origin(locale),
      path: addresses.path(page, locale),
    })),
  );
  asked.forEach(({ page, locale }, index) => {
    const { status, headers, body } = answers[index];
    const where = `${page} in ${locale} at ${addresses.path(page, locale)}`;
    assert.equal(status, page === 'missing' ? 404 : 200, where);
    assert.equal(
      headers['content-language'],
      locale,
      `${where}: the language the @neolorn/equator/http request handler resolved`,
    );
    assert.match(body, new RegExp(`<html[^>]* lang="${locale}"`, 'u'), where);
    assert.match(
      body,
      /\bng-server-context="ssr"/u,
      `${where} was not rendered for the request`,
    );
    recordCapabilityClaim(
      `${consumerName}: server answers`,
      'entry:@neolorn/equator/http',
      { document: body },
    );
  });
}
verifyServerAnswers();

/**
 * The exercise sheet, as these servers answer it and as these builds wrote it, in every locale
 * they serve. Each line is held to what this Node's own formatters write for the same input, on
 * the Node the server and the build ran on.
 */
async function verifyExerciseSheets() {
  const inputs = await readExerciseInputs(consumerRoot);
  const verifySheet = async (check, locale, document, rendered, page) => {
    const sheet = sheetInDocument(document);
    assert.equal(sheet.locale, locale, `${check} shows ${sheet.locale}`);
    assert.ok(
      document.includes(`ng-server-context="${rendered}"`),
      `${check} was not written by the ${rendered === 'ssr' ? 'server' : 'build'} that provideLocalizedServerRendering from @neolorn/equator/ssr sets up`,
    );
    const sources = await readExerciseSources(consumerRoot, locale, inputs);
    const expected = exerciseAuthority({ inputs, locale, ...sources });
    const observed = { document, policy: sheet.policy };
    recordCapabilityClaim(
      check,
      'feature:provideLocalizedServerRendering',
      observed,
    );
    recordCapabilityClaim(check, 'entry:@neolorn/equator/ssr', observed);
    claimSheetParameter(
      check,
      sheet,
      exerciseSheetNames[page],
      locale,
      observed,
    );
    claimExercisedContext(check, sheet, expected, observed);
    claimExercisedPipes(check, sheet, expected, observed);
    claimExercisedFormats(check, sheet, expected, observed);
    claimExercisedControls(check, sheet, expected, inputs.controls, observed);
    claimExercisedExtensions(check, sheet, expected, observed);
    claimOverlayLocale(check, sheet, locale, sources.direction, observed);
  };

  const served = INIT_REQUEST.locales.filter((locale) =>
    addresses.has('exercise', locale),
  );
  const answers = serverAnswers(
    served.map((locale) => ({
      origin: addresses.origin(locale),
      path: addresses.path('exercise', locale),
    })),
  );
  for (const [index, locale] of served.entries()) {
    assert.equal(answers[index].status, 200, `exercise in ${locale}`);
    await verifySheet(
      `${consumerName}: exercise sheet in ${locale}, rendered on request`,
      locale,
      answers[index].body,
      'ssr',
      'exercise',
    );
  }
  for (const locale of INIT_REQUEST.locales) {
    if (!addresses.has('exercise values', locale)) continue;
    const document = await readFile(
      resolve(
        consumerRoot,
        builds.output(addresses.origin(locale)),
        'browser',
        addresses.file('exercise values', locale),
      ),
      'utf8',
    );
    await verifySheet(
      `${consumerName}: exercise sheet in ${locale}, prerendered`,
      locale,
      document,
      'ssg',
      'exercise values',
    );
  }
}
await verifyExerciseSheets();

const browserText = (
  await Promise.all(browserFiles.map((path) => readFile(path, 'utf8')))
).join('\n');
for (const forbidden of [
  '@neolorn/equator-toolkit',
  'supported testing entry point remains intentionally empty',
  'equator-cli-result/1',
  'node:fs',
]) {
  assert.equal(
    browserText.includes(forbidden),
    false,
    `Browser output contains forbidden toolkit/Node text: ${forbidden}`,
  );
}

/*
 * The pseudo-locale outside the browser.
 *
 * Everything above ran against a production build. This rebuilds the same consumer, unchanged
 * except for the flag on `equator generate`, and asks whether a pseudo-locale renders where there
 * is no browser to switch in: prerendering, which has no request and therefore no negotiation, so
 * every locale's copy has to be a separate address that exists in the build.
 *
 * It builds to its own output path and puts the generated source back afterwards, so what this
 * step hands on is the production build every later step expects. Building over
 * `dist/feature-lab` and leaving it there has `verify:browser-assurance` read a six-address
 * prerender manifest where it expects four, and report `PASS` in one second, because importing the
 * consumer's server bundle installs Angular's `attachNodeGlobalErrorHandlers` and a log-only
 * `uncaughtException` handler stops Node exiting non-zero.
 */
run(['exec', 'equator', 'generate', '--pseudo']);

// One pseudo build for each origin the two pages read below are served at, which is one under a
// path policy. The address set is exact for the same reason as above: a prerendered route whose
// component throws is dropped silently, and the pseudo-locale's pages appearing is only half the
// claim. The other half is that there are no others: `en-Latn-XA` is declared and generated too,
// and the policy gives it no address, so it must produce no file at all.
const pseudoLocales = [...INIT_REQUEST.locales, ...Object.keys(PSEUDO_LOCALES)];
const pseudoRoots = new Map();
for (const origin of originsOf([INIT_REQUEST.sourceLocale, 'en-Arab-XB'])) {
  const output = builds.output(origin, 'dist/feature-lab-pseudo');
  await buildAt(origin, output);
  const root = resolve(consumerRoot, output, 'browser');
  const emitted = (await collectPrerendered(root)).sort();
  const expected = prerenderedFiles(servedAt(origin, pseudoLocales), {
    pseudo: true,
  }).sort();
  assert.deepEqual(
    emitted,
    expected,
    `The pseudo build's prerendered address set at ${origin} is wrong.\nEmitted:\n  ${emitted.join('\n  ')}\nExpected:\n  ${expected.join('\n  ')}`,
  );
  pseudoRoots.set(origin, root);
}
/** The pseudo build that prerendered the locale's pages. */
const pseudoRootOf = (locale) => pseudoRoots.get(addresses.origin(locale));

/**
 * The pseudo-locale's prerendered pages, where the policy gives it addresses of its own. Under a
 * locale-neutral policy it has none, because it spells every address the way English does, and the
 * set above has already held its builds to writing no page for it.
 */
async function verifyPseudoPages() {
  const routeViewText = (html, view) => {
    const match = new RegExp(
      `<p[^>]*data-route-view="${view}"[^>]*>(.*?)</p>`,
      'su',
    ).exec(html);
    assert.ok(match, `No ${view} route view in the prerendered page`);
    return match[1].replace(/<!--.*?-->/gsu, '').trim();
  };

  const pseudoPage = await readFile(
    resolve(pseudoRootOf('en-Arab-XB'), addresses.file('second', 'en-Arab-XB')),
    'utf8',
  );
  const englishPage = await readFile(
    resolve(
      pseudoRootOf(INIT_REQUEST.sourceLocale),
      addresses.file('second', INIT_REQUEST.sourceLocale),
    ),
    'utf8',
  );

  // Direction and language, read off the rendered document rather than off configuration. The tag
  // carries the script and the script carries the direction, so a prerendered page that is not RTL
  // means the tag did not survive to the renderer, which is the failure this locale exists to make
  // impossible to bolt on afterwards.
  assert.match(
    pseudoPage,
    /<html[^>]*\slang="en-Arab-XB"/u,
    'The prerendered pseudo-locale page did not carry its own language tag',
  );
  assert.match(
    pseudoPage,
    /<html[^>]*\sdir="rtl"/u,
    'The prerendered pseudo-locale page was not rendered right to left',
  );

  const pseudoText = routeViewText(pseudoPage, 'second');
  const englishText = routeViewText(englishPage, 'second');
  assert.ok(
    pseudoText.startsWith('⟦') && pseudoText.endsWith('⟧'),
    `The prerendered pseudo-locale page carried untransformed text: ${JSON.stringify(pseudoText)}`,
  );
  assert.notEqual(
    pseudoText,
    englishText,
    'The prerendered pseudo-locale page rendered the source locale',
  );
  // The control for the two assertions above. Both would pass on a build where the transform ran
  // over everything, which is the one thing a pseudo-locale must never do to the locales that ship.
  assert.ok(
    !englishText.includes('⟦'),
    `A pseudo build transformed the English page: ${JSON.stringify(englishText)}`,
  );

  /*
   * The same text the client renders, and the reason that is checkable at all.
   *
   * The transform ran at build time, so what prerendering and the browser each received is one
   * compiled catalog. Asserting the rendered string appears in that catalog is what ties the two
   * ends together: `pseudo-locale-page.spec.ts` proved the browser renders this catalog's messages
   * with their markers, and this proves the page written without a browser carries the same
   * catalog's text, byte for byte.
   *
   * Escapes are decoded first. A generated module may write a non-ASCII character literally or as
   * `\uXXXX`, in either hex case: the bundle gate in `verify-package-structure.mjs` was green
   * against a real leak for exactly this reason.
   */
  const decodeEscapes = (value) =>
    value.replace(/\\u([0-9a-fA-F]{4})/gu, (_match, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  /*
   * Every compiled catalog this build wrote for one locale, joined.
   *
   * Located by name rather than by path, because compiled catalogs live under a set directory whose
   * name is a content-addressed identity: a literal path here would be a fingerprint to re-edit.
   * All of them rather than the first: an application has one catalog per scope per locale, and the
   * first found is whichever scope sorted first. That was this check's own first defect, and it read
   * as the transform having failed.
   */
  const readGeneratedCatalogs = async (name, root = generatedRoot) => {
    const found = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) {
        found.push(...(await readGeneratedCatalogs(name, path)));
      } else if (entry.name === name) {
        found.push(decodeEscapes(await readFile(path, 'utf8')));
      }
    }
    return found;
  };
  const catalogsFor = async (name) => {
    const found = await readGeneratedCatalogs(name);
    assert.ok(found.length > 0, `No generated ${name} under ${generatedRoot}`);
    return found.join('\n');
  };
  const pseudoCatalog = await catalogsFor('en-Arab-XB.ts');
  assert.ok(
    pseudoCatalog.includes(pseudoText),
    `The prerendered text is not in the compiled pseudo catalog: ${JSON.stringify(pseudoText)}`,
  );
  // The control. Without it the assertion above passes for a search that never worked, against the
  // wrong file, or against text no catalog could hold.
  const sourceCatalog = await catalogsFor('en-US.ts');
  assert.ok(
    sourceCatalog.includes(englishText),
    'The English page text is not in the compiled source catalog, so the search above proves nothing',
  );

  /*
   * Criterion 2, on a page nobody rendered in a browser.
   *
   * The article's title is content this application owns. Equator never sees it, so nothing could
   * pseudo-localize it, and the source supplies the English representation for a locale it has no
   * article in, which is what makes this page the clearest case the criterion has: an
   * application-owned string sitting untransformed beside shell messages that all carry markers.
   * That is what a developer is meant to notice, and here it is in a file written with no browser
   * involved.
   */
  const pseudoArticle = await readFile(
    resolve(
      pseudoRootOf('en-Arab-XB'),
      addresses.file('article', 'en-Arab-XB'),
    ),
    'utf8',
  );
  assert.ok(
    pseudoArticle.includes('The Equator localization handbook'),
    'The application-owned article title is not on the prerendered pseudo-locale page',
  );
  // And the shell around it did go through Equator. Without this the assertion above passes for a
  // page where the transform never ran at all.
  assert.ok(
    pseudoArticle.includes('⟦'),
    'The prerendered pseudo-locale article page carries no transformed message',
  );
}
if (prerenderedFile('second', 'en-Arab-XB', { pseudo: true }) !== undefined) {
  await verifyPseudoPages();
}

// And the generated source goes back to production shape, because the steps after this one rebuild
// this consumer from it. The `dist/` they read was never touched; this is the other half of the
// same tree.
run(['exec', 'equator', 'generate']);
const restoredLocaleTable = await readFile(
  resolve(generatedRoot, 'index.ts'),
  'utf8',
);
for (const tag of Object.keys(PSEUDO_LOCALES)) {
  assert.ok(
    !restoredLocaleTable.includes(tag),
    `The consumer was left with ${tag} generated, so every step after this one reads a pseudo build`,
  );
}
assert.ok(
  restoredLocaleTable.includes('ar-EG'),
  'The restored locale table was not read, so the absences above mean nothing',
);

/**
 * A route listed for prerender that the build has to refuse.
 *
 * `specs/07-routing-rendering-and-seo.spec.md` section 9. The route is listed where an application
 * lists it, in its own published routes, so the refusal is met the way a release meets it. The three
 * answers are gathered before any is asserted, so a build that lets the page through reports every
 * way it did. `@angular/build` before 22.1.7 drops a page whose navigation fails and still
 * succeeds, which is why the written files are read as well as the status. Built to its own output
 * path and put back afterwards, because the steps after this one read the production build and its
 * source.
 */
const serverRoutesPath = resolve(consumerRoot, 'src/app/published-routes.ts');
const serverRoutes = await readFile(serverRoutesPath, 'utf8');
async function verifyRefusedPrerender({
  page,
  routeId,
  listed,
  listing,
  refusal,
}) {
  assert.equal(
    serverRoutes.split(listed).length,
    2,
    `The published routes no longer carry the entry the refused ${routeId} is listed by`,
  );
  await writeFile(
    serverRoutesPath,
    serverRoutes.replace(listed, listing),
    'utf8',
  );
  const refusedRoot = resolve(consumerRoot, 'dist/feature-lab-refused');
  await rm(refusedRoot, { force: true, recursive: true });
  let refusedBuild;
  try {
    refusedBuild = spawnPnpm([
      'exec',
      'ng',
      'build',
      '--output-path',
      'dist/feature-lab-refused',
    ]);
  } finally {
    await writeFile(serverRoutesPath, serverRoutes, 'utf8');
  }
  const refusedOutput = [refusedBuild.stdout, refusedBuild.stderr].join('\n');
  const refusedFile = new RegExp(`(?:^|/)${page}/index\\.html$`, 'u');
  const refusedPages = (
    await readdir(refusedRoot).then(
      () => collectPrerendered(refusedRoot),
      () => [],
    )
  ).filter((path) => refusedFile.test(path));
  // The refusal names the address it met, which is one of the page's, as a path.
  const pageAddresses = INIT_REQUEST.locales
    .filter((locale) => addresses.has(page, locale))
    .map((locale) => addresses.path(page, locale));
  const namesTheRefusal = new RegExp(
    `Route ${routeId} at "(?:${pageAddresses
      .map((address) => address.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
      .join('|')})" ${refusal}`,
    'u',
  );
  assert.deepEqual(
    [
      ...refusedPages.map((path) => `it wrote ${path}`),
      ...(refusedBuild.status === 1
        ? []
        : [`it exited ${String(refusedBuild.status)}`]),
      ...(namesTheRefusal.test(refusedOutput)
        ? []
        : ['its output does not name the route and the refusal']),
    ],
    [],
    `The build prerendered ${routeId}, which it has to refuse:\n${refusedOutput}`,
  );
  assert.equal(
    await readFile(serverRoutesPath, 'utf8'),
    serverRoutes,
    'The published routes were not put back after the refused build',
  );
}

// `route:lazy` is per visitor, which its route declares.
const listedBefore = "  { routeId: 'item', renderMode: RenderMode.Client },\n";
await verifyRefusedPrerender({
  page: 'lazy',
  routeId: 'route:lazy',
  listed: listedBefore,
  listing: `${listedBefore}  { routeId: 'route:lazy', renderMode: RenderMode.Prerender },\n`,
  refusal: 'is per-visitor, and it is being rendered ahead of a request',
});
// Under a locale-neutral policy `/second` is spelled alike in every locale, so it is per visitor
// whatever its route declares, and the application lists it for rendering on request.
if (addresses.policy === 'locale-neutral') {
  const onRequest =
    "  { routeId: 'route:second', renderMode: RenderMode.Server },\n";
  await verifyRefusedPrerender({
    page: 'second',
    routeId: 'route:second',
    listed: onRequest,
    listing: onRequest.replace('RenderMode.Server', 'RenderMode.Prerender'),
    refusal:
      'is spelled alike in more than one locale, so which locale it is in depends on the visitor, and it is being rendered ahead of a request',
  });
}

process.stdout.write(
  `Equator package consumer verified: ${consumerProfile.label}, Angular ${consumerProfile.angular}, TypeScript ${consumerProfile.typescript}, RxJS ${consumerProfile.rxjs}, ${collectedFiles[2]} spec file(s) and ${collectedCases[1]} case(s) passing.\n`,
);
