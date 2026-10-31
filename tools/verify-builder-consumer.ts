/**
 * A consumer whose `ng build`, `ng serve` and `ng test` run Thoth's builders and nothing else.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 14 says generation runs inside those three
 * commands, so this consumer has no generation step of its own: the generated modules are removed
 * before each command, and each command has to produce them before Angular reads them. It is the
 * minimal consumer with the workspace file `ng add` writes, so the Angular half of each command is
 * the one every other consumer stage runs.
 *
 * Every command is started with the installed Angular CLI's own entry file and a bound of its own,
 * and the serve session is ended by this process once it has shown what it is run for.
 *
 * First, the options the Angular targets set in `angular.json` reach Angular through the three
 * builders, lists and objects included, and each target runs as `ng run` runs it on its own: a
 * production build resolves a package with the same export conditions, and the reporters of the
 * Vitest configuration reach Vitest.
 *
 * Last, the consumer declares a pseudo-locale, as section 16 of the same specification lets a project
 * do: `ng serve`, whose target asks for the pseudo-locales as `ng add` sets it, serves it with
 * nothing run beside it, and a production `ng build` of the same project holds none of it.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { builtPackageLocator } from './built-package.ts';
import { OFFLINE_INSTALL, withOfflineStoreRemedy } from './offline-store.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = resolve(
  workspaceRoot,
  'tmp/builder-consumer-verification',
);
// At the depth the minimal consumer's own stage installs at, because the committed lockfile records
// the built packages by a path relative to it.
const consumerRoot = resolve(temporaryRoot, 'builder-consumer');
const templateRoot = resolve(
  workspaceRoot,
  'fixtures/minimal-package-consumer-template',
);
const overlayRoot = resolve(workspaceRoot, 'fixtures/builder-consumer-overlay');
const generatedRoot = resolve(consumerRoot, 'src/generated/i18n');
const catalogPath = resolve(consumerRoot, 'i18n/shell/en-US.yaml');
const configurationPath = resolve(consumerRoot, 'thoth.config.json');
const PSEUDO_LOCALE = 'en-Latn-XA';
const COMMAND_BOUND_MILLISECONDS = 600_000;

assert.ok(
  consumerRoot.startsWith(`${temporaryRoot}${sep}`),
  `Refusing path outside ${temporaryRoot}: ${consumerRoot}`,
);
await rm(consumerRoot, { recursive: true, force: true });
await mkdir(temporaryRoot, { recursive: true });
await cp(templateRoot, consumerRoot, { recursive: true });
await cp(overlayRoot, consumerRoot, { recursive: true });

const manifestPath = resolve(consumerRoot, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.dependencies['@neolorn/thoth'] = builtPackageLocator(
  consumerRoot,
  workspaceRoot,
  'dist/runtime',
);
manifest.devDependencies['@neolorn/thoth-toolkit'] = builtPackageLocator(
  consumerRoot,
  workspaceRoot,
  'dist/toolkit',
);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const install =
  process.platform === 'win32'
    ? spawnSync(
        process.env['ComSpec'] ?? 'cmd.exe',
        ['/d', '/s', '/c', 'pnpm', ...OFFLINE_INSTALL],
        {
          cwd: consumerRoot,
          encoding: 'utf8',
          env: { ...process.env, CI: 'true' },
        },
      )
    : spawnSync('pnpm', OFFLINE_INSTALL, {
        cwd: consumerRoot,
        encoding: 'utf8',
        env: { ...process.env, CI: 'true' },
      });
assert.equal(
  install.status,
  0,
  withOfflineStoreRemedy(
    [install.error?.message, install.stdout, install.stderr]
      .filter(Boolean)
      .join('\n'),
  ),
);

// A package whose every export condition leaves its own mark, which the Angular build target names
// in `polyfills`. Put in place after the install, which installs only what the lockfile records.
await cp(
  resolve(workspaceRoot, 'fixtures/builder-consumer-condition-probe'),
  resolve(consumerRoot, 'node_modules/thoth-condition-probe'),
  { recursive: true },
);

const ngEntry = resolve(consumerRoot, 'node_modules/@angular/cli/bin/ng.js');

/** Ends a command and everything it started, which on Windows a signal to the parent does not. */
const end = (pid: number | undefined): void => {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
    });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone, which is the state this asks for.
    }
  }
};

/** Runs one `ng` command to its end, printing its output as it comes. */
const ng = (
  args: readonly string[],
): Promise<{ status: number | null; output: string }> =>
  new Promise((resolvePromise, rejectPromise) => {
    process.stdout.write(`$ ng ${args.join(' ')}\n`);
    const child = spawn(process.execPath, [ngEntry, ...args], {
      cwd: consumerRoot,
      env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const record = (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    const bound = setTimeout(() => {
      end(child.pid);
      rejectPromise(
        new Error(
          `ng ${args.join(' ')} ran past its ${COMMAND_BOUND_MILLISECONDS / 1000}s bound.\n${output}`,
        ),
      );
    }, COMMAND_BOUND_MILLISECONDS);
    child.once('error', rejectPromise);
    child.once('close', (status) => {
      clearTimeout(bound);
      resolvePromise({ status, output });
    });
  });

const absent = async (path: string): Promise<void> => {
  await assert.rejects(lstat(path), { code: 'ENOENT' });
};
const present = async (path: string): Promise<void> => {
  assert.equal((await lstat(path)).isDirectory(), true, `${path} is missing.`);
};
const ungenerated = async (): Promise<void> => {
  await rm(generatedRoot, { recursive: true, force: true });
  await absent(generatedRoot);
};

const originalCatalog = await readFile(catalogPath, 'utf8');
/** A placeholder that never closes, which no MessageFormat 2 parser accepts. */
const brokenCatalog = originalCatalog.replace(
  "welcome: 'Welcome, {$name}!'",
  "welcome: 'Welcome, {$name!'",
);
assert.notEqual(
  brokenCatalog,
  originalCatalog,
  'The catalog plant did not apply.',
);

/** Text without the colour codes the Angular CLI writes even without a terminal. */
const uncoloured = (text: string): string =>
  text.replace(/\u001b\[[0-9;]*m/gu, '');

/** Starts ng serve, gives its address to `check` once it serves, and ends it after. */
const whileServing = <T>(check: (origin: string) => Promise<T>): Promise<T> =>
  new Promise<T>((resolvePromise, rejectPromise) => {
    process.stdout.write('$ ng serve\n');
    const child = spawn(process.execPath, [ngEntry, 'serve'], {
      cwd: consumerRoot,
      env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let checking = false;
    const bound = setTimeout(() => {
      end(child.pid);
      rejectPromise(
        new Error(
          `ng serve ran past its ${COMMAND_BOUND_MILLISECONDS / 1000}s bound.\n${output}`,
        ),
      );
    }, COMMAND_BOUND_MILLISECONDS);
    const record = (chunk: Buffer) => {
      output += uncoloured(chunk.toString());
      process.stdout.write(chunk);
      const origin = /Local:\s+(http:\/\/localhost:\d+\/)/u.exec(output)?.[1];
      if (origin === undefined || checking) return;
      checking = true;
      check(origin).then(
        (value) => {
          clearTimeout(bound);
          end(child.pid);
          resolvePromise(value);
        },
        (error: unknown) => {
          clearTimeout(bound);
          end(child.pid);
          rejectPromise(error);
        },
      );
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    child.once('error', rejectPromise);
    child.once('close', (status) => {
      if (!checking) {
        clearTimeout(bound);
        rejectPromise(
          new Error(
            `ng serve ended with status ${status} before it served.\n${output}`,
          ),
        );
      }
    });
  });

const browserRoot = resolve(consumerRoot, 'dist/minimal/browser');

/** The export conditions `thoth-condition-probe` was resolved with in the scripts a build wrote. */
const probedConditions = async (): Promise<string> => {
  const marks = new Set<string>();
  for (const name of await readdir(browserRoot)) {
    if (!name.endsWith('.js')) continue;
    const text = await readFile(resolve(browserRoot, name), 'utf8');
    for (const match of text.matchAll(/thoth-condition-probe:(\w+)/gu)) {
      marks.add(match[1] as string);
    }
  }
  return marks.size === 0 ? 'nothing' : [...marks].sort().join(' and ');
};

/** Whether the Vitest configuration's JSON reporter wrote its report. */
const runnerReport = resolve(consumerRoot, 'runner-config-report.json');
const reported = async (): Promise<boolean> =>
  lstat(runnerReport).then(
    () => true,
    () => false,
  );

// The options each Angular target sets in angular.json reach Angular through Thoth's builder when
// the command line does not give them: arrays and objects as much as the rest. And the Angular
// target runs as it runs on its own, where the Angular CLI fills no array option it was not given:
// a production build resolves packages with the same conditions as `ng run` of the build target,
// and the reporters of the Vitest configuration reach Vitest. The verdicts are taken together, so
// one that fails does not hide the others.
const arrivals: string[] = [];
{
  await rm(resolve(consumerRoot, 'dist'), { recursive: true, force: true });
  const arrivalBuild = await ng(['build']);
  const throughThoth =
    arrivalBuild.status === 0
      ? await probedConditions()
      : `status ${arrivalBuild.status}`;
  if (arrivalBuild.status !== 0) {
    arrivals.push(`ng build ended with status ${arrivalBuild.status}.`);
  } else {
    const names = await readdir(browserRoot);
    const stylesheet = names.find((name) => /^styles-[^.]+\.css$/u.test(name));
    if (stylesheet === undefined) {
      arrivals.push(
        `ng build wrote no stylesheet, so the styles option of minimal:angular-build did not reach Angular: ${names.join(', ')}`,
      );
    } else if (
      !(await readFile(resolve(browserRoot, 'index.html'), 'utf8')).includes(
        `href="${stylesheet}"`,
      )
    ) {
      arrivals.push(
        `ng build wrote ${stylesheet}, and index.html does not link it.`,
      );
    }
    if (!names.includes('arrival.txt')) {
      arrivals.push(
        `ng build did not copy public/arrival.txt, so the assets option of minimal:angular-build did not reach Angular: ${names.join(', ')}`,
      );
    }
    if (
      !/Budget 1\.00 kB was not met by /u.test(uncoloured(arrivalBuild.output))
    ) {
      arrivals.push(
        'ng build gave no budget warning, so the budgets option of minimal:angular-build:production did not reach Angular.',
      );
    }
  }
  await rm(resolve(consumerRoot, 'dist'), { recursive: true, force: true });
  const aloneBuild = await ng(['run', 'minimal:angular-build:production']);
  const onItsOwn =
    aloneBuild.status === 0
      ? await probedConditions()
      : `status ${aloneBuild.status}`;
  if (onItsOwn !== 'production') {
    arrivals.push(
      `ng run minimal:angular-build:production resolved thoth-condition-probe with ${onItsOwn}, where Angular's default conditions for a production build pick production, so the probe does not show what it is there for.`,
    );
  }
  if (throughThoth !== onItsOwn) {
    arrivals.push(
      `ng build resolved thoth-condition-probe with ${throughThoth}, and ng run minimal:angular-build:production with ${onItsOwn}: the Angular target does not run through Thoth's builder as it runs on its own.`,
    );
  }

  await rm(runnerReport, { force: true });
  const arrivalTest = await ng(['test', '--watch=false']);
  if (arrivalTest.status !== 0) {
    arrivals.push(
      `ng test ended with status ${arrivalTest.status}, so src/setup-arrival.spec.ts failed or did not run: the setupFiles option of minimal:angular-test did not reach Angular.`,
    );
  }
  const reportedThroughThoth = await reported();
  await rm(runnerReport, { force: true });
  const aloneTest = await ng(['run', 'minimal:angular-test', '--watch=false']);
  const reportedOnItsOwn = aloneTest.status === 0 && (await reported());
  await rm(runnerReport, { force: true });
  if (!reportedOnItsOwn) {
    arrivals.push(
      `ng run minimal:angular-test (status ${aloneTest.status}) wrote no report from the reporters vitest-base.config.mjs sets, so the probe does not show what it is there for.`,
    );
  }
  if (reportedThroughThoth !== reportedOnItsOwn) {
    arrivals.push(
      `ng test ${reportedThroughThoth ? 'wrote' : 'wrote no'} report from the reporters vitest-base.config.mjs sets, and ng run minimal:angular-test ${reportedOnItsOwn ? 'did' : 'did not'}: the Angular target does not run through Thoth's builder as it runs on its own.`,
    );
  }
  const header = await whileServing(async (origin) =>
    (await fetch(origin)).headers.get('x-thoth-arrival'),
  );
  if (header !== 'angular-serve') {
    arrivals.push(
      `ng serve answered with X-Thoth-Arrival ${String(header)}, so the headers option of minimal:angular-serve did not reach Angular.`,
    );
  }
}
assert.deepEqual(arrivals, [], arrivals.join('\n'));
await rm(resolve(consumerRoot, 'dist'), { recursive: true, force: true });
await ungenerated();

// ng build, from nothing generated.
await absent(generatedRoot);
const built = await ng(['build']);
assert.equal(built.status, 0, built.output);
assert.match(built.output, /Thoth generated \d+ files/u);
await present(generatedRoot);
await present(resolve(consumerRoot, 'dist/minimal/browser'));

// The Angular target's production configuration sets hidden source maps in angular.json, and a
// plain ng build keeps them; given on the command line, the opposite reaches Angular instead.
const sourceMaps = async (): Promise<readonly string[]> =>
  (await readdir(resolve(consumerRoot, 'dist/minimal/browser'))).filter(
    (name) => name.endsWith('.js.map'),
  );
assert.notDeepEqual(
  await sourceMaps(),
  [],
  'A plain ng build wrote no source map, so what angular.json sets on minimal:angular-build:production did not reach Angular.',
);
await rm(resolve(consumerRoot, 'dist'), { recursive: true, force: true });
const withoutMaps = await ng(['build', '--source-map=false']);
assert.equal(withoutMaps.status, 0, withoutMaps.output);
assert.deepEqual(
  await sourceMaps(),
  [],
  'ng build --source-map=false wrote source maps, so the option given on the command line did not reach Angular.',
);

// ng build with a catalog that does not parse: the diagnostic is in the build's output, the exit is
// a failure, and Angular never starts.
await ungenerated();
await rm(resolve(consumerRoot, 'dist'), { recursive: true, force: true });
await writeFile(catalogPath, brokenCatalog, 'utf8');
const refused = await ng(['build']);
assert.equal(refused.status, 1, refused.output);
assert.match(
  refused.output,
  /i18n[\\/]shell[\\/]en-US\.yaml:\d+:\d+: error TH\d{4}: /u,
);
assert.match(
  refused.output,
  /Thoth generation failed, so minimal:angular-build:production did not run\./u,
);
await absent(resolve(consumerRoot, 'dist'));
await writeFile(catalogPath, originalCatalog, 'utf8');

// ng test, from nothing generated.
await ungenerated();
const tested = await ng(['test', '--watch=false']);
assert.equal(tested.status, 0, tested.output);
assert.match(tested.output, /Thoth generated \d+ files/u);
await present(generatedRoot);

// ng serve, from nothing generated, to its first output, then a catalog edit regenerated inside the
// same session, a broken catalog reported without ending it, and its repair regenerated.
await ungenerated();
await new Promise<void>((resolvePromise, rejectPromise) => {
  process.stdout.write('$ ng serve\n');
  const child = spawn(process.execPath, [ngEntry, 'serve'], {
    cwd: consumerRoot,
    env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let step = 0;
  let closed = false;
  const fail = (message: string) => {
    clearTimeout(bound);
    end(child.pid);
    rejectPromise(new Error(`${message}\n${output}`));
  };
  const bound = setTimeout(
    () =>
      fail(
        `ng serve ran past its ${COMMAND_BOUND_MILLISECONDS / 1000}s bound at step ${step}.`,
      ),
    COMMAND_BOUND_MILLISECONDS,
  );
  const count = (pattern: RegExp) => output.match(pattern)?.length ?? 0;
  const advance = () => {
    if (step === 0 && /Local:\s+http:\/\/localhost:\d+\//u.test(output)) {
      step = 1;
      void present(generatedRoot).then(
        () =>
          writeFile(
            catalogPath,
            originalCatalog.replace(
              'Thoth minimal consumer',
              'Thoth served consumer',
            ),
            'utf8',
          ),
        (error: unknown) => fail(String(error)),
      );
    } else if (step === 1 && count(/Thoth generated \d+ files/gu) >= 2) {
      step = 2;
      void writeFile(catalogPath, brokenCatalog, 'utf8');
    } else if (step === 2 && /error TH\d{4}: /u.test(output)) {
      step = 3;
      void writeFile(catalogPath, originalCatalog, 'utf8');
    } else if (step === 3 && count(/Thoth generated \d+ files/gu) >= 3) {
      step = 4;
      clearTimeout(bound);
      assert.equal(closed, false, 'ng serve ended on its own.');
      end(child.pid);
      resolvePromise();
    }
  };
  const record = (chunk: Buffer) => {
    // The dev server colours its address line even without a terminal, and the colour codes sit
    // inside the words this reads.
    output += chunk.toString().replace(/\u001b\[[0-9;]*m/gu, '');
    process.stdout.write(chunk);
    advance();
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  child.once('error', (error) => fail(String(error)));
  child.once('close', (status) => {
    closed = true;
    if (step < 4) fail(`ng serve ended with status ${status} at step ${step}.`);
  });
});
await writeFile(catalogPath, originalCatalog, 'utf8');

/** Every file under a directory, as text, keyed by its path from that directory. */
const textsUnder = async (
  root: string,
): Promise<ReadonlyMap<string, string>> => {
  const texts = new Map<string, string>();
  for (const entry of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = resolve(entry.parentPath, entry.name);
    texts.set(path.slice(root.length + 1), await readFile(path, 'utf8'));
  }
  return texts;
};
const holding = (
  texts: ReadonlyMap<string, string>,
  text: string,
): readonly string[] =>
  [...texts]
    .filter(([, contents]) => contents.includes(text))
    .map(([path]) => path);

/**
 * The scripts a served page loads, and every module they import by a path on the same server,
 * relative or from its root, each fetched from the dev server as a browser would fetch it.
 */
const servedScripts = async (
  origin: string,
): Promise<ReadonlyMap<string, string>> => {
  const page = await (await fetch(origin)).text();
  const pending = [...page.matchAll(/<script[^>]*\ssrc="([^"]+)"/gu)].map(
    (match) => new URL(match[1] as string, origin).href,
  );
  const scripts = new Map<string, string>();
  while (pending.length > 0 && scripts.size < 200) {
    const url = pending.shift() as string;
    if (scripts.has(url)) continue;
    const response = await fetch(url);
    assert.equal(response.ok, true, `${url} answered ${response.status}.`);
    const text = await response.text();
    scripts.set(url, text);
    for (const match of text.matchAll(
      /(?:from|import)\s*\(?\s*["']((?:\.{1,2})?\/[^"']+)["']/gu,
    )) {
      const imported = new URL(match[1] as string, url);
      if (imported.origin === new URL(origin).origin) {
        pending.push(imported.href);
      }
    }
  }
  return scripts;
};

// The project declares a pseudo-locale. ng serve, from nothing generated, serves it.
const originalConfiguration = await readFile(configurationPath, 'utf8');
const pseudoConfiguration = JSON.parse(originalConfiguration);
pseudoConfiguration.pseudoLocales = { [PSEUDO_LOCALE]: { lengthFactor: 0.3 } };
await writeFile(
  configurationPath,
  `${JSON.stringify(pseudoConfiguration, null, 2)}\n`,
  'utf8',
);
await ungenerated();
await new Promise<void>((resolvePromise, rejectPromise) => {
  process.stdout.write('$ ng serve (with a pseudo-locale declared)\n');
  const child = spawn(process.execPath, [ngEntry, 'serve'], {
    cwd: consumerRoot,
    env: { ...process.env, CI: 'true', NG_CLI_ANALYTICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let checking = false;
  const finish = (error?: unknown) => {
    clearTimeout(bound);
    end(child.pid);
    if (error === undefined) resolvePromise();
    else rejectPromise(new Error(`${String(error)}\n${output}`));
  };
  const bound = setTimeout(
    () =>
      finish(
        `ng serve ran past its ${COMMAND_BOUND_MILLISECONDS / 1000}s bound.`,
      ),
    COMMAND_BOUND_MILLISECONDS,
  );
  const record = (chunk: Buffer) => {
    // Without the dev server's colour codes, as the session above reads it.
    output += chunk.toString().replace(/\u001b\[[0-9;]*m/gu, '');
    process.stdout.write(chunk);
    const origin = /Local:\s+(http:\/\/localhost:\d+\/)/u.exec(output)?.[1];
    if (origin === undefined || checking) return;
    checking = true;
    void (async () => {
      assert.notDeepEqual(
        holding(await textsUnder(generatedRoot), PSEUDO_LOCALE),
        [],
        `ng serve generated nothing for ${PSEUDO_LOCALE}.`,
      );
      const served = await servedScripts(origin);
      assert.notDeepEqual(
        holding(served, PSEUDO_LOCALE),
        [],
        `None of the ${served.size} scripts ng serve serves holds ${PSEUDO_LOCALE}: ${[...served.keys()].join(', ')}`,
      );
    })().then(() => finish(), finish);
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  child.once('error', finish);
  child.once('close', (status) => {
    if (!checking) {
      finish(`ng serve ended with status ${status} before it served.`);
    }
  });
});

/**
 * What a build emitted that the project's generated modules could reach: every file but the source
 * maps, and of each source map the sources under `src/generated/`. The rest of a source map is the
 * packages' own sources, which name the pseudo-locales whether the project generated one or not.
 */
const emittedTexts = async (
  root: string,
): Promise<ReadonlyMap<string, string>> => {
  const texts = new Map<string, string>();
  for (const [path, text] of await textsUnder(root)) {
    if (!path.endsWith('.map')) {
      texts.set(path, text);
      continue;
    }
    const map = JSON.parse(text) as {
      readonly sources?: readonly string[];
      readonly sourcesContent?: readonly (string | null)[];
    };
    (map.sources ?? []).forEach((source, index) => {
      if (/(?:^|[\\/])src[\\/]generated[\\/]/u.test(source)) {
        texts.set(`${path} ${source}`, map.sourcesContent?.[index] ?? '');
      }
    });
  }
  return texts;
};

// A production ng build of the same project holds none of it, after a serve that generated it.
await rm(resolve(consumerRoot, 'dist'), { recursive: true, force: true });
const production = await ng(['build']);
assert.equal(production.status, 0, production.output);
assert.deepEqual(
  holding(await emittedTexts(resolve(consumerRoot, 'dist')), PSEUDO_LOCALE),
  [],
  `The production build holds ${PSEUDO_LOCALE}.`,
);
assert.deepEqual(
  holding(await textsUnder(generatedRoot), PSEUDO_LOCALE),
  [],
  `The production build left ${PSEUDO_LOCALE} in the generated modules.`,
);
await writeFile(configurationPath, originalConfiguration, 'utf8');

process.stdout.write(
  `Thoth builder consumer verified: ng build, ng test and ng serve generate before Angular runs, a broken catalog ends ng build with its diagnostic, ng serve regenerates on catalog edits and reports a broken catalog without ending, ng serve serves the declared pseudo-locale ${PSEUDO_LOCALE}, and a production ng build holds none of it.\n`,
);
