/**
 * `ng add @neolorn/thoth-toolkit` on an application `ng new` has just made, then `ng build`, and on a
 * second application of the same workspace through `--project`.
 *
 * `specs/10-compiler-and-tooling.spec.md` section 11 says what `ng add` writes. This makes the
 * application with the installed Angular CLI's own `ng new`, runs the published schematic through
 * `ng add`, writes the two catalogs the application owns and nothing else, and builds. The build has
 * to carry the recovery message the configuration names, which reaches the bundle only through the
 * `provideLocalization` the schematic adds, and a second `ng add` has to change no file.
 *
 * The install is offline, from the document scaffold's lockfile, which records the development
 * row and the two built packages; `ng add` finds the toolkit installed, says so, and runs the
 * schematic without reaching the registry. The runtime is installed with it, so the schematic's
 * dependency entry for it is one it finds there.
 *
 * Every command is started with the installed Angular CLI's own entry file and a bound of its own.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { builtPackageLocator } from './built-package.ts';
import { OFFLINE_INSTALL, withOfflineStoreRemedy } from './offline-store.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = resolve(workspaceRoot, 'tmp/ngadd-consumer-verification');
const name = 'ngadd-consumer';
// At the depth the document scaffold is installed at, because its lockfile records the built
// packages by a path relative to it.
const consumerRoot = resolve(temporaryRoot, name);
const scaffoldRoot = resolve(
  workspaceRoot,
  'fixtures/document-consumer-scaffold',
);
const COMMAND_BOUND_MILLISECONDS = 600_000;
const RECOVERY_TEXT = 'The page could not be shown. Please reload.';

assert.ok(
  consumerRoot.startsWith(`${temporaryRoot}${sep}`),
  `Refusing path outside ${temporaryRoot}: ${consumerRoot}`,
);
await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(temporaryRoot, { recursive: true });

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

/** Runs one `ng` command to its end in a directory, printing its output as it comes. */
const ng = (
  entry: string,
  cwd: string,
  args: readonly string[],
): Promise<{ status: number | null; output: string }> =>
  new Promise((resolvePromise, rejectPromise) => {
    process.stdout.write(`$ ng ${args.join(' ')}\n`);
    const child = spawn(process.execPath, [entry, ...args], {
      cwd,
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

// The application, as `ng new` makes it with the CLI of the development row.
const created = await ng(
  resolve(workspaceRoot, 'node_modules/@angular/cli/bin/ng.js'),
  temporaryRoot,
  [
    'new',
    name,
    '--routing',
    '--style=css',
    '--ssr=false',
    '--skip-install',
    '--skip-git',
    '--defaults',
    '--package-manager=pnpm',
  ],
);
assert.equal(created.status, 0, created.output);

// Its packages held to the development row and the two built packages, which is what the scaffold's
// lockfile was resolved against.
const scaffoldManifest = JSON.parse(
  await readFile(resolve(scaffoldRoot, 'package.json'), 'utf8'),
);
const manifestPath = resolve(consumerRoot, 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.dependencies = scaffoldManifest.dependencies;
manifest.devDependencies = scaffoldManifest.devDependencies;
// pnpm resolves the package manager `ng new` records here into the lockfile, and the scaffold's
// lockfile was resolved without one.
delete manifest.packageManager;
assert.equal(
  manifest.dependencies['@neolorn/thoth'],
  builtPackageLocator(consumerRoot, workspaceRoot, 'dist/runtime'),
);
assert.equal(
  manifest.devDependencies['@neolorn/thoth-toolkit'],
  builtPackageLocator(consumerRoot, workspaceRoot, 'dist/toolkit'),
);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
  await cp(resolve(scaffoldRoot, file), resolve(consumerRoot, file));
}

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
const ADD = [
  'add',
  '@neolorn/thoth-toolkit',
  '--skip-confirmation',
  '--source-locale',
  'en-US',
  '--default-locale',
  'en-US',
  '--locale',
  'en-US',
  '--locale',
  'ar-EG',
  '--url-policy',
  'path-prefix',
];

const added = await ng(ngEntry, consumerRoot, ADD);
assert.equal(added.status, 0, added.output);
assert.match(
  added.output,
  /Skipping installation: Package already installed/u,
  'ng add reached for the registry rather than the installed toolkit.',
);

const workspace = JSON.parse(
  await readFile(resolve(consumerRoot, 'angular.json'), 'utf8'),
);
const targets = workspace.projects[name].architect;
assert.deepEqual(
  Object.fromEntries(
    Object.entries(targets).map(([target, definition]) => [
      target,
      (definition as { builder: string }).builder,
    ]),
  ),
  {
    build: '@neolorn/thoth-toolkit:build',
    serve: '@neolorn/thoth-toolkit:serve',
    test: '@neolorn/thoth-toolkit:test',
    'angular-build': '@angular/build:application',
    'angular-serve': '@angular/build:dev-server',
    'angular-test': '@angular/build:unit-test',
  },
);
const configuration = JSON.parse(
  await readFile(resolve(consumerRoot, 'thoth.config.json'), 'utf8'),
);
assert.equal(configuration.recoveryMessage, 'shell/recovery-message');
assert.equal(configuration.recoveryRetry, 'shell/recovery-retry');
await assert.rejects(lstat(resolve(consumerRoot, 'i18n')), {
  code: 'ENOENT',
});
assert.match(
  await readFile(resolve(consumerRoot, 'src/app/app.config.ts'), 'utf8'),
  /provideLocalizedRouter\(routes\)/u,
);

// A second run finds every part in place and writes nothing.
const WRITTEN = [
  'angular.json',
  'package.json',
  'thoth.config.json',
  'src/app/app.config.ts',
];
const before = await Promise.all(
  WRITTEN.map((path) => readFile(resolve(consumerRoot, path), 'utf8')),
);
const again = await ng(ngEntry, consumerRoot, ADD);
assert.equal(again.status, 0, again.output);
const after = await Promise.all(
  WRITTEN.map((path) => readFile(resolve(consumerRoot, path), 'utf8')),
);
assert.deepEqual(after, before, 'A second ng add changed a file.');

// The application's text, which is all a person writes before the first build.
await mkdir(resolve(consumerRoot, 'i18n/shell'), { recursive: true });
await writeFile(
  resolve(consumerRoot, 'i18n/shell/en-US.yaml'),
  `messages:\n  recovery-message: ${RECOVERY_TEXT}\n  recovery-retry: Try again\n`,
  'utf8',
);
await writeFile(
  resolve(consumerRoot, 'i18n/shell/ar-EG.yaml'),
  'messages:\n  recovery-message: تعذر عرض الصفحة. الرجاء إعادة التحميل.\n  recovery-retry: إعادة المحاولة\n',
  'utf8',
);

const built = await ng(ngEntry, consumerRoot, ['build']);
assert.equal(built.status, 0, built.output);
assert.match(built.output, /Thoth generated \d+ files/u);
const browserRoot = resolve(consumerRoot, 'dist', name, 'browser');
const scripts = (await readdir(browserRoot)).filter((file) =>
  file.endsWith('.js'),
);
const bundled = await Promise.all(
  scripts.map((file) => readFile(resolve(browserRoot, file), 'utf8')),
);
assert.ok(
  bundled.some((text) => text.includes(RECOVERY_TEXT)),
  `No script in dist/${name}/browser carries the recovery message, which reaches the bundle only through the provideLocalization ng add adds to app.config.ts.`,
);

// A second application in the same workspace, which `--project` sets up at its own root.
const SECOND = 'admin';
const SECOND_TEXT = 'The admin page could not be shown. Please reload.';
const generated = await ng(ngEntry, consumerRoot, [
  'generate',
  'application',
  SECOND,
  '--routing',
  '--style=css',
  '--ssr=false',
  '--skip-install',
  '--defaults',
]);
assert.equal(generated.status, 0, generated.output);
const secondRoot = resolve(consumerRoot, 'projects', SECOND);
const rootConfiguration = await readFile(
  resolve(consumerRoot, 'thoth.config.json'),
  'utf8',
);
const addedSecond = await ng(ngEntry, consumerRoot, [
  ...ADD,
  '--project',
  SECOND,
]);
assert.equal(addedSecond.status, 0, addedSecond.output);
assert.equal(
  await readFile(resolve(consumerRoot, 'thoth.config.json'), 'utf8'),
  rootConfiguration,
  'ng add --project changed the configuration of the application at the workspace root.',
);
const secondManifest = JSON.parse(
  await readFile(resolve(secondRoot, 'package.json'), 'utf8'),
);
assert.equal(secondManifest.imports['#i18n'], './src/generated/i18n/index.ts');
await lstat(resolve(secondRoot, 'thoth.config.json'));
await mkdir(resolve(secondRoot, 'i18n/shell'), { recursive: true });
await writeFile(
  resolve(secondRoot, 'i18n/shell/en-US.yaml'),
  `messages:\n  recovery-message: ${SECOND_TEXT}\n  recovery-retry: Try again\n`,
  'utf8',
);
await writeFile(
  resolve(secondRoot, 'i18n/shell/ar-EG.yaml'),
  'messages:\n  recovery-message: تعذر عرض صفحة الإدارة. الرجاء إعادة التحميل.\n  recovery-retry: إعادة المحاولة\n',
  'utf8',
);
const builtSecond = await ng(ngEntry, consumerRoot, ['build', SECOND]);
assert.equal(builtSecond.status, 0, builtSecond.output);
assert.match(builtSecond.output, /Thoth generated \d+ files/u);
const secondBrowserRoot = resolve(consumerRoot, 'dist', SECOND, 'browser');
const secondScripts = (await readdir(secondBrowserRoot)).filter((file) =>
  file.endsWith('.js'),
);
const secondBundled = await Promise.all(
  secondScripts.map((file) =>
    readFile(resolve(secondBrowserRoot, file), 'utf8'),
  ),
);
assert.ok(
  secondBundled.some((text) => text.includes(SECOND_TEXT)),
  `No script in dist/${SECOND}/browser carries its own recovery message, so its build did not read the configuration and catalogs at projects/${SECOND}.`,
);
assert.ok(
  !secondBundled.some((text) => text.includes(RECOVERY_TEXT)),
  `A script in dist/${SECOND}/browser carries the recovery message of the application at the workspace root.`,
);

process.stdout.write(
  'Thoth ng add consumer verified: on a new Angular application, ng add wrote the configuration, the builders and the providers, a second ng add changed nothing, and ng build with the two catalogs bundled the localization; a second application, set up with --project at its own root, built from its own catalogs.\n',
);
