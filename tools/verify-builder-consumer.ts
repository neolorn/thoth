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
