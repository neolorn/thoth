/**
 * The work around a mutation reading: what to read again, what to read on its own, how a second
 * reading's verdicts go back into the first, and the survivors a person has to answer.
 *
 * A reading (`pnpm run mutation`, `pnpm run mutation:toolkit`) scores each mutant by running the
 * tests that cover it, and two of its verdicts are about time rather than about the tests. A mutant
 * scored `Timeout` ran out of the multiple of its dry run that the configuration allows, and a
 * mutant scored killed by a test's own time limit ("Test timed out in N ms") failed on a clock. Both
 * count as detected, and both can be load beside the run rather than the mutant, so a survivor can
 * hide in them. `doubtful` writes a configuration that reads exactly those mutants again, one runner
 * at a time; `merge` puts the second reading's verdict for each of them into the first reading's
 * report and incremental baseline, and leaves every other verdict as it was.
 *
 * A mutate range takes every node inside it, so a range around one doubtful mutant also takes the
 * mutants on the nodes within it, and a static one among them runs the whole suite. The
 * configuration `doubtful` writes therefore loads an ignore plugin, written beside it, that marks
 * those neighbours `Ignored`. Stryker ignores the whole subtree of a node an ignore plugin names, so
 * the plugin never names a node that is, or contains, a listed mutant's node: the other mutators'
 * mutants on a listed node stay, and so do the mutants of a node between two nested listed ones.
 * `selection` instruments the files of such a configuration as Stryker would, without running a
 * test, and sorts the mutants left to read into the listed ones, those two kinds, and any other,
 * which fails it. `merge` takes an `Ignored` verdict as not read, and fails before writing anything
 * when a listed mutant is absent from the second reading or `Ignored` in it.
 *
 * `ranges` writes a configuration that mutates only the given line ranges, for lines a reading does
 * not instrument because no configuration names their file. `survivors` prints the mutants a
 * report did not detect, with the text each one replaced, and `skeletons` prints them as entries
 * of `tools/mutation-reasons.json` with the category and the reason left to write.
 *
 * `changed` takes every line of package source added or changed between two commits and says what
 * shows that it runs: nothing to show (a blank line, a comment, an import, a type), a removed line
 * it only respells (`--rename <old>=<new>`, as often as needed, for a change that renamed
 * something), a mutant on it that a reading killed, or an assurance injection whose text covers
 * it. The rest are open, listed for reading by hand with `--list <file>`, and `--ranges <file>`
 * writes the open lines of files no reading mutates as ranges for `ranges`. The twins
 * (`tools/twin-sources.json`) are left out of those ranges, because instrumenting either copy
 * breaks the test that holds them to the same bytes.
 *
 * A configuration written here extends a base configuration given on the command line, so it reads
 * with every setting the base reads with: the runner, the sandbox's contents, the time multiple.
 * It is written into the folder named for it, with the reports and the sandbox beside it, so
 * nothing of a reading in progress is touched. Run it with `node tools/run-mutation.ts <config>`,
 * which takes the lock every heavy job takes.
 *
 * Usage:
 *
 *     node tools/mutation-reading.ts doubtful <report.json> <base config> <out folder> [--timeouts]
 *         [--name <configuration file name>]
 *     node tools/mutation-reading.ts selection <configuration> <doubtful.json> [--root <folder>]
 *         [--out <file>]
 *     node tools/mutation-reading.ts ranges <ranges.json> <base config> <out folder>
 *     node tools/mutation-reading.ts merge <doubtful.json> <second report.json> <summary.json> <report or baseline>...
 *     node tools/mutation-reading.ts survivors <report.json> [<file>:<line> | <status>]...
 *     node tools/mutation-reading.ts skeletons <report.json> <file>:<line>...
 *     node tools/mutation-reading.ts changed <base> <tip> <report.json>... [--list <file>]
 *         [--ranges <file>] [--rename <old>=<new>]...
 *
 * `--timeouts` takes only the mutants scored `Timeout`, for testing each of a second reading's
 * timeouts once more on its own. `--name` names the configuration file, `stryker.config.mjs` unless
 * given, so a new one can be written beside one in use; the list (`doubtful.json`) and the ignore
 * plugin (`doubtful-ignorer.mjs`) are written beside it under their own names. `selection` takes the
 * mutate ranges against `--root`, the folder Stryker runs in, which is the repository unless given,
 * and `--out` writes every mutant it instrumented with the kind it sorted it into.
 * `merge` keeps each file it changes beside it as `<file>.before-merge`.
 * `tools/mutation-reading-self-test.ts` is the self-test of `doubtful`, `selection` and `merge`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import { injections as unitInjections } from './assurance-injections.ts';
import { injections as runtimeInjections } from './assurance-runtime-injections.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A position in a Stryker report: lines and columns both counted from 1. */
interface Position {
  readonly line: number;
  readonly column: number;
}
interface Mutant {
  readonly id: string;
  readonly mutatorName: string;
  readonly replacement?: string;
  readonly location: { readonly start: Position; readonly end: Position };
  status: string;
  statusReason?: string;
  readonly static?: boolean;
  readonly coveredBy?: readonly string[];
  [field: string]: unknown;
}
interface Report {
  readonly files: Record<
    string,
    { readonly source: string; readonly mutants: Mutant[] }
  >;
}
/** A mutant to read again, as `doubtful` lists it and `merge` finds it. */
interface Doubtful {
  readonly file: string;
  readonly id: string;
  readonly mutator: string;
  readonly replacement: string | undefined;
  readonly start: Position;
  readonly end: Position;
  readonly status: string;
  readonly static: boolean;
}

const readReport = (path: string): Report =>
  JSON.parse(readFileSync(resolve(path), 'utf8')) as Report;

/** A report names a file by the path Stryker was handed; the key here is the repository path. */
const repositoryPath = (file: string): string =>
  file.replaceAll('\\', '/').replace(/^.*?(?=packages\/)/u, '');

const span = (start: Position, end: Position): string =>
  `${start.line}:${start.column}-${end.line}:${end.column}`;
const mutantKey = (file: string, mutant: Mutant): string =>
  `${repositoryPath(file)}|${span(mutant.location.start, mutant.location.end)}|${mutant.mutatorName}|${mutant.replacement ?? ''}`;
const doubtfulKey = (entry: Doubtful): string =>
  `${entry.file}|${span(entry.start, entry.end)}|${entry.mutator}|${entry.replacement ?? ''}`;

const TIME_LIMIT = /^Test timed out in \d+ms/u;

/** The text a mutant replaced, from the source the report carries. */
function originalText(source: string, mutant: Mutant): string {
  const lines = source.split('\n');
  const { start, end } = mutant.location;
  if (start.line === end.line) {
    return (lines[start.line - 1] ?? '').slice(
      start.column - 1,
      end.column - 1,
    );
  }
  return [
    (lines[start.line - 1] ?? '').slice(start.column - 1),
    ...lines.slice(start.line, end.line - 1),
    (lines[end.line - 1] ?? '').slice(0, end.column - 1),
  ].join('\n');
}

/** A path as a Stryker configuration in the repository's root reads it. */
const fromRoot = (path: string): string =>
  relative(workspaceRoot, resolve(path)).split(sep).join('/');

/** The name the ignore plugin of a doubtful reading is declared under, and its file. */
const IGNORER = 'thoth-doubtful';
const IGNORER_FILE = 'doubtful-ignorer.mjs';
const IGNORE_REASON =
  'Not a doubtful mutant: only the listed ones are read again.';

/**
 * The ignore plugin's body. It is the `Ignorer` of `@stryker-mutator/api/ignore`, declared as
 * `declareValuePlugin(PluginKind.Ignore, ...)` from `@stryker-mutator/api/plugin` would declare it,
 * written out so the file loads without a package beside it. `SPANS` is put before it: per
 * repository path, the listed mutants' spans as Babel gives a node's, lines counted from 1 and
 * columns from 0. The file name is the one the instrumenter hands Babel for the file.
 */
const IGNORER_BODY =
  String.raw`
const repositoryPath = (file) => {
  const path = file.replaceAll('\\', '/');
  const at = path.indexOf('packages/');
  return at < 0 ? path : path.slice(at);
};

const contains = (loc, [startLine, startColumn, endLine, endColumn]) =>
  (loc.start.line < startLine ||
    (loc.start.line === startLine && loc.start.column <= startColumn)) &&
  (loc.end.line > endLine ||
    (loc.end.line === endLine && loc.end.column >= endColumn));

export const strykerPlugins = [
  {
    kind: 'Ignore',
    name: IGNORER,
    value: {
      shouldIgnore(path) {
        const loc = path.node.loc;
        if (loc == null) return undefined;
        const file = path.hub?.file?.opts?.filename;
        if (typeof file !== 'string') {
          throw new Error(` +
  "`${IGNORER} was handed a node without its file's name.`" +
  String.raw`);
        }
        const spans = SPANS.get(repositoryPath(file)) ?? [];
        return spans.some((span) => contains(loc, span)) ? undefined : REASON;
      },
    },
  },
];
`;

/** The ignore plugin that marks `Ignored` every mutant but the listed ones, the other mutators' on their nodes, and the ones on a node that contains one. */
function writeIgnorer(folder: string, listed: readonly Doubtful[]): void {
  const spans: Record<string, number[][]> = {};
  const seen = new Set<string>();
  for (const { file, start, end } of listed) {
    const babel = [start.line, start.column - 1, end.line, end.column - 1];
    if (seen.has(`${file}|${babel.join(',')}`)) continue;
    seen.add(`${file}|${babel.join(',')}`);
    (spans[file] ??= []).push(babel);
  }
  writeFileSync(
    resolve(folder, IGNORER_FILE),
    `// The ignore plugin of a doubtful reading, written by \`tools/mutation-reading.ts doubtful\` beside
// the configuration that loads it. It names every node the reading's ranges take that neither is
// nor contains a listed mutant's node, and Stryker marks the mutants inside a named node Ignored.
const IGNORER = ${JSON.stringify(IGNORER)};
const REASON = ${JSON.stringify(IGNORE_REASON)};
const SPANS = new Map(Object.entries(${JSON.stringify(spans, null, 1)}));
${IGNORER_BODY}`,
  );
}

/** The configuration that extends the base and reads the given ranges into the given folder. */
function writeConfiguration(
  folder: string,
  base: string,
  mutate: readonly string[],
  purpose: string,
  oneRunner: boolean,
  name = 'stryker.config.mjs',
  ignorer = false,
): string {
  const out = resolve(folder);
  mkdirSync(out, { recursive: true });
  let imported = relative(out, resolve(base)).split(sep).join('/');
  if (!imported.startsWith('.')) imported = `./${imported}`;
  const at = fromRoot(out);
  const path = resolve(out, name);
  writeFileSync(
    path,
    `${ignorer ? "import { fileURLToPath } from 'node:url';\n\n" : ''}import base from '${imported}';

// ${purpose}
export default {
  ...base,
  mutate: ${JSON.stringify(mutate, null, 2)},
${
  ignorer
    ? `  // A range takes every mutant inside it; the plugin beside this file marks the unlisted ones Ignored.
  plugins: [
    ...(base.plugins ?? ['@stryker-mutator/*']),
    fileURLToPath(new URL('./${IGNORER_FILE}', import.meta.url)),
  ],
  ignorers: [...(base.ignorers ?? []), '${IGNORER}'],
`
    : ''
}${oneRunner ? '  concurrency: 1,\n' : ''}  incremental: false,
  htmlReporter: { fileName: '${at}/index.html' },
  jsonReporter: { fileName: '${at}/report.json' },
  tempDirName: '${at}/sandbox',
};
`,
  );
  return path;
}

function doubtful(args: readonly string[]): void {
  const { values, positional } = options(args, ['--name']);
  const timeoutsOnly = positional.includes('--timeouts');
  const [reportPath, base, folder, ...unknown] = positional.filter(
    (arg) => arg !== '--timeouts',
  );
  assert.ok(
    reportPath !== undefined &&
      base !== undefined &&
      folder !== undefined &&
      unknown.length === 0,
    'doubtful <report.json> <base config> <out folder> [--timeouts] [--name <configuration file name>]',
  );
  const name = values.get('--name')?.at(-1) ?? 'stryker.config.mjs';
  assert.ok(
    /^[\w.-]+\.mjs$/u.test(name) && name !== IGNORER_FILE,
    `--name takes a file name ending in .mjs, not ${name}.`,
  );
  const report = readReport(reportPath);
  const listed: Doubtful[] = [];
  for (const [file, entry] of Object.entries(report.files)) {
    for (const mutant of entry.mutants) {
      const timeLimit =
        mutant.status === 'Killed' &&
        TIME_LIMIT.test(mutant.statusReason ?? '');
      if (mutant.status !== 'Timeout' && (timeoutsOnly || !timeLimit)) {
        continue;
      }
      listed.push({
        file: repositoryPath(file),
        id: mutant.id,
        mutator: mutant.mutatorName,
        replacement: mutant.replacement,
        start: mutant.location.start,
        end: mutant.location.end,
        status: mutant.status,
        static: mutant.static === true,
      });
    }
  }
  // A mutate range takes lines counted from 1 and columns counted from 0.
  const ranges = [
    ...new Set(
      listed.map(
        ({ file, start, end }) =>
          `${file}:${start.line}:${start.column - 1}-${end.line}:${end.column - 1}`,
      ),
    ),
  ];
  mkdirSync(resolve(folder), { recursive: true });
  writeFileSync(
    resolve(folder, 'doubtful.json'),
    `${JSON.stringify(listed, null, 1)}\n`,
  );
  writeIgnorer(folder, listed);
  const config = writeConfiguration(
    folder,
    base,
    ranges,
    timeoutsOnly
      ? 'Every mutant a reading scored as a timeout, read again with one runner and nothing beside it.'
      : "Every mutant a reading scored as a timeout or as killed by a test's time limit, read again with one runner and nothing beside it.",
    true,
    name,
    true,
  );
  const timeouts = listed.filter(({ status }) => status === 'Timeout').length;
  process.stdout.write(
    `${listed.length} doubtful (${timeouts} timeouts, ${listed.length - timeouts} killed by a time limit) in ${ranges.length} ranges: ${fromRoot(config)}\n`,
  );
}

function ranges(args: readonly string[]): void {
  const [rangesPath, base, folder] = args;
  assert.ok(
    rangesPath !== undefined && base !== undefined && folder !== undefined,
    'ranges <ranges.json> <base config> <out folder>',
  );
  const listed = JSON.parse(
    readFileSync(resolve(rangesPath), 'utf8'),
  ) as unknown;
  assert.ok(Array.isArray(listed), `${rangesPath} holds no list.`);
  for (const range of listed) {
    assert.ok(
      typeof range === 'string' && /^packages\/[^:]+\.ts:\d+-\d+$/u.test(range),
      `Not a line range of a package source: ${String(range)}`,
    );
  }
  const config = writeConfiguration(
    folder,
    base,
    listed as string[],
    'Lines no reading mutates, read on their own.',
    false,
  );
  const files = new Set(
    (listed as string[]).map((range) => range.split(':')[0]),
  );
  process.stdout.write(
    `${listed.length} ranges over ${files.size} files: ${fromRoot(config)}\n`,
  );
}

/** The fields of a verdict, which a second reading replaces and nothing else. */
const VERDICT_FIELDS = [
  'status',
  'statusReason',
  'killedBy',
  'testsCompleted',
  'coveredBy',
  'duration',
] as const;

function merge(args: readonly string[]): void {
  const [listPath, secondPath, summaryPath, ...targets] = args;
  assert.ok(
    listPath !== undefined &&
      secondPath !== undefined &&
      summaryPath !== undefined &&
      targets.length > 0,
    'merge <doubtful.json> <second report.json> <summary.json> <report or baseline>...',
  );
  const listed = JSON.parse(
    readFileSync(resolve(listPath), 'utf8'),
  ) as Doubtful[];
  const wanted = new Set(listed.map(doubtfulKey));
  const second = new Map<string, Mutant>();
  for (const [file, entry] of Object.entries(readReport(secondPath).files)) {
    for (const mutant of entry.mutants)
      second.set(mutantKey(file, mutant), mutant);
  }
  // A listed mutant the second reading did not read leaves the merge with nothing to put in its
  // place, so nothing is merged; this is checked before any file is written.
  const unread = [...wanted].filter(
    (key) => (second.get(key)?.status ?? 'Ignored') === 'Ignored',
  );
  assert.deepEqual(
    unread,
    [],
    `${secondPath} did not read ${unread.length} listed mutant(s), absent or Ignored there:\n${unread.join('\n')}`,
  );
  // An Ignored mutant was not read: it is a neighbour the ignore plugin kept out.
  for (const [key, mutant] of second) {
    if (mutant.status === 'Ignored') second.delete(key);
  }
  const replaced: {
    where: string;
    was: string;
    now: string;
    nowReason: string;
  }[] = [];
  const differing: { where: string; reading: string; second: string }[] = [];
  const summary = {
    doubtful: wanted.size,
    targets: [] as { path: string; replaced: number; missing: number }[],
    missing: [] as string[],
    replaced,
    // A range also takes in mutants beside the doubtful one, and those the ignore plugin cannot keep
    // out are read with it. Their first verdict stands, because only the doubtful ones were read for
    // a second opinion; where the two differ it is listed.
    alsoRead: 0,
    alsoReadDiffering: differing,
  };
  for (const [index, target] of targets.entries()) {
    const path = resolve(target);
    const report = readReport(path);
    const found = new Set<string>();
    for (const [file, entry] of Object.entries(report.files)) {
      for (const mutant of entry.mutants) {
        const key = mutantKey(file, mutant);
        const now = second.get(key);
        if (now === undefined) continue;
        if (!wanted.has(key)) {
          if (index === 0) {
            summary.alsoRead += 1;
            if (now.status !== mutant.status) {
              differing.push({
                where: key,
                reading: mutant.status,
                second: now.status,
              });
            }
          }
          continue;
        }
        found.add(key);
        if (index === 0) {
          const verdict = (status: string, reason: string | undefined) =>
            TIME_LIMIT.test(reason ?? '') ? `${status} (time limit)` : status;
          replaced.push({
            where: key,
            was: verdict(mutant.status, mutant.statusReason),
            now: verdict(now.status, now.statusReason),
            nowReason: (now.statusReason ?? '').slice(0, 120),
          });
        }
        // The fields are copied as the second report holds them, whatever their shape.
        const into = mutant as Record<string, unknown>;
        for (const field of VERDICT_FIELDS) {
          if (now[field] === undefined) delete into[field];
          else into[field] = now[field];
        }
      }
    }
    const missing = [...wanted].filter((key) => !found.has(key));
    summary.targets.push({
      path: fromRoot(path),
      replaced: found.size,
      missing: missing.length,
    });
    if (index === 0) summary.missing = missing;
    copyFileSync(path, `${path}.before-merge`);
    writeFileSync(path, JSON.stringify(report));
  }
  writeFileSync(resolve(summaryPath), `${JSON.stringify(summary, null, 1)}\n`);
  const moves: Record<string, number> = {};
  for (const { was, now } of replaced) {
    moves[`${was} -> ${now}`] = (moves[`${was} -> ${now}`] ?? 0) + 1;
  }
  process.stdout.write(
    `${JSON.stringify({ doubtful: wanted.size, missing: summary.missing.length, moves, alsoRead: summary.alsoRead, alsoReadDiffering: differing.length }, null, 1)}\n`,
  );
}

/** The mutants a report did not detect, at the given `file:line` keys or of the given statuses. */
function undetected(
  reportPath: string,
  filters: readonly string[],
  statuses: readonly string[],
): { key: string; file: string; mutant: Mutant; original: string }[] {
  const wanted = new Set(filters);
  const found = [];
  for (const [file, entry] of Object.entries(readReport(reportPath).files)) {
    for (const mutant of entry.mutants) {
      if (!statuses.includes(mutant.status)) continue;
      const path = repositoryPath(file);
      const key = `${path}:${mutant.location.start.line}`;
      if (wanted.size > 0 && !wanted.has(key) && !wanted.has(mutant.status)) {
        continue;
      }
      found.push({
        key,
        file: path,
        mutant,
        original: originalText(entry.source, mutant),
      });
    }
  }
  return found;
}

const oneLine = (text: string, length: number): string =>
  text.slice(0, length).replaceAll('\n', '\\n');

function survivors(args: readonly string[]): void {
  const [reportPath, ...filters] = args;
  assert.ok(
    reportPath !== undefined,
    'survivors <report.json> [<file>:<line> | <status>]...',
  );
  for (const { key, mutant, original } of undetected(reportPath, filters, [
    'Survived',
    'NoCoverage',
    'Timeout',
  ])) {
    process.stdout.write(
      `${mutant.status} ${key}:${mutant.location.start.column} ${mutant.mutatorName} id=${mutant.id} tests=${mutant.coveredBy?.length ?? 0} | ${oneLine(original, 160)} => ${oneLine(String(mutant.replacement), 80)}\n`,
    );
  }
}

function skeletons(args: readonly string[]): void {
  const [reportPath, ...keys] = args;
  assert.ok(
    reportPath !== undefined && keys.length > 0,
    'skeletons <report.json> <file>:<line>...',
  );
  const entries = undetected(reportPath, keys, ['Survived', 'NoCoverage'])
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.mutant.location.start.line - b.mutant.location.start.line,
    )
    .map(({ file, mutant, original }) => ({
      file,
      mutator: mutant.mutatorName,
      original,
      replacement: mutant.replacement,
      category: '',
      reason: '',
    }));
  process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
}

/** The lines of a source that carry a token outside a type, an import or a comment. */
function behaviorLines(text: string, path: string): Set<number> {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (
      (node.kind >= ts.SyntaxKind.FirstJSDocNode &&
        node.kind <= ts.SyntaxKind.LastJSDocNode) ||
      ts.isTypeNode(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isImportDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.isTypeOnly)
    ) {
      return;
    }
    const children = node.getChildren(source);
    if (children.length === 0) {
      if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
      const start = node.getStart(source);
      const first = source.getLineAndCharacterOfPosition(start).line + 1;
      const last =
        source.getLineAndCharacterOfPosition(Math.max(start, node.getEnd() - 1))
          .line + 1;
      for (let line = first; line <= last; line += 1) lines.add(line);
      return;
    }
    for (const child of children) visit(child);
  };
  visit(source);
  return lines;
}

/** The value after each occurrence of an option, and the arguments that are not options. */
function options(
  args: readonly string[],
  names: readonly string[],
): { readonly values: Map<string, string[]>; readonly positional: string[] } {
  const values = new Map<string, string[]>(names.map((name) => [name, []]));
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    const list = values.get(arg);
    if (list === undefined) {
      positional.push(arg);
      continue;
    }
    const value = args[index + 1];
    assert.ok(value !== undefined, `${arg} needs a value.`);
    list.push(value);
    index += 1;
  }
  return { values, positional };
}

function changed(args: readonly string[]): void {
  const { values, positional } = options(args, [
    '--list',
    '--ranges',
    '--rename',
  ]);
  const [base, tip, ...reports] = positional;
  assert.ok(
    base !== undefined && tip !== undefined && reports.length > 0,
    'changed <base> <tip> <report.json>... [--list <file>] [--ranges <file>] [--rename <old>=<new>]...',
  );
  const renames = (values.get('--rename') ?? []).map((pair) => {
    const at = pair.indexOf('=');
    assert.ok(at > 0, `--rename takes <old>=<new>, not ${pair}.`);
    return [pair.slice(0, at), pair.slice(at + 1)] as const;
  });
  const respell = (line: string): string =>
    renames.reduce((text, [from, to]) => text.replaceAll(from, to), line);
  const git = (...gitArgs: string[]): string =>
    execFileSync('git', gitArgs, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });

  const files = git(
    'diff',
    '--name-only',
    '--diff-filter=AM',
    base,
    tip,
    '--',
    'packages',
  )
    .split('\n')
    .filter(
      (path) =>
        /\/src\/.*\.ts$/u.test(path) &&
        !path.endsWith('.generated.ts') &&
        !path.endsWith('.d.ts'),
    );

  const killedLines = new Map<string, Set<number>>();
  const mutatedLines = new Map<string, Set<number>>();
  for (const report of reports) {
    for (const [file, { mutants }] of Object.entries(
      readReport(report).files,
    )) {
      const path = repositoryPath(file);
      const killed = killedLines.get(path) ?? new Set<number>();
      const any = mutatedLines.get(path) ?? new Set<number>();
      for (const mutant of mutants) {
        const { start, end } = mutant.location;
        for (let line = start.line; line <= end.line; line += 1) {
          any.add(line);
          if (mutant.status === 'Killed') killed.add(line);
        }
      }
      killedLines.set(path, killed);
      mutatedLines.set(path, any);
    }
  }

  // `repeated`: the line is one the hunk removed, as it was or as `--rename` respells it.
  const counts = {
    changed: 0,
    none: 0,
    repeated: 0,
    killed: 0,
    injected: 0,
    open: 0,
  };
  const open: { file: string; line: number; text: string; mutated: boolean }[] =
    [];
  for (const file of files) {
    const text = git('show', `${tip}:${file}`);
    const lines = text.split('\n');
    const behavior = behaviorLines(text, file);
    const injected = new Set<number>();
    for (const injection of [...unitInjections, ...runtimeInjections]) {
      if (injection.source !== file) continue;
      const at = text.indexOf(injection.find);
      if (at < 0) continue;
      const first = text.slice(0, at).split('\n').length;
      const last =
        first + injection.find.replace(/\n$/u, '').split('\n').length - 1;
      for (let line = first; line <= last; line += 1) injected.add(line);
    }
    let next = 0;
    let removed: string[] = [];
    for (const row of git('diff', '-U0', base, tip, '--', file).split('\n')) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(row);
      if (hunk !== null) {
        next = Number(hunk[1]);
        removed = [];
        continue;
      }
      if (row.startsWith('---') || row.startsWith('+++')) continue;
      if (row.startsWith('-')) {
        removed.push(respell(row.slice(1)));
        continue;
      }
      if (!row.startsWith('+')) continue;
      const added = row.slice(1);
      const line = next;
      next += 1;
      counts.changed += 1;
      const pair = removed.indexOf(added);
      if (!behavior.has(line)) counts.none += 1;
      else if (pair >= 0) {
        removed.splice(pair, 1);
        counts.repeated += 1;
      } else if (killedLines.get(file)?.has(line) === true) counts.killed += 1;
      else if (injected.has(line)) counts.injected += 1;
      else {
        counts.open += 1;
        open.push({
          file,
          line,
          text: lines[line - 1]?.trim() ?? '',
          mutated: mutatedLines.get(file)?.has(line) === true,
        });
      }
    }
  }
  process.stdout.write(
    `${JSON.stringify({ files: files.length, ...counts })}\n`,
  );
  const listPath = values.get('--list')?.[0];
  if (listPath !== undefined) {
    writeFileSync(
      resolve(listPath),
      `${open.map(({ file, line, text, mutated }) => `${file}:${line}${mutated ? ' [mutant not killed]' : ''}  ${text}`).join('\n')}\n`,
    );
  }
  const rangesPath = values.get('--ranges')?.[0];
  if (rangesPath === undefined) return;
  const twins = new Set(
    (
      JSON.parse(
        readFileSync(resolve(workspaceRoot, 'tools/twin-sources.json'), 'utf8'),
      ) as { twins: { runtime: string; toolkit: string }[] }
    ).twins.flatMap(({ runtime, toolkit }) => [runtime, toolkit]),
  );
  const byFile = new Map<string, number[]>();
  for (const { file, line } of open) {
    if (mutatedLines.has(file) || twins.has(file)) continue;
    byFile.set(file, [...(byFile.get(file) ?? []), line]);
  }
  const written: string[] = [];
  for (const [file, numbers] of byFile) {
    numbers.sort((a, b) => a - b);
    let start = numbers[0] as number;
    let previous = start;
    for (const n of [...numbers.slice(1), Number.POSITIVE_INFINITY]) {
      if (n === previous + 1) {
        previous = n;
        continue;
      }
      written.push(`${file}:${start}-${previous}`);
      start = n;
      previous = n;
    }
  }
  writeFileSync(resolve(rangesPath), `${JSON.stringify(written, null, 2)}\n`);
  process.stdout.write(`${written.length} ranges over ${byFile.size} files\n`);
}

/** A module of the installed Stryker, found from its core package as Stryker itself finds it. */
async function stryker<T>(specifier: string): Promise<T> {
  const core = realpathSync(
    resolve(workspaceRoot, 'node_modules/@stryker-mutator/core'),
  );
  const from = createRequire(join(core, 'package.json'));
  return (await import(pathToFileURL(from.resolve(specifier)).href)) as T;
}

interface Range {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}
interface InstrumentedMutant {
  readonly fileName: string;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: Range;
  readonly status?: string;
}
interface StrykerConfiguration {
  readonly mutate: readonly string[];
  readonly plugins?: readonly string[];
  readonly ignorers?: readonly string[];
  readonly mutator?: {
    readonly plugins?: unknown[] | null;
    readonly excludedMutations?: string[];
  };
}

/** Whether the first span holds the second, both in a report's terms. */
const holds = (outer: Range, inner: Range): boolean =>
  (outer.start.line < inner.start.line ||
    (outer.start.line === inner.start.line &&
      outer.start.column <= inner.start.column)) &&
  (outer.end.line > inner.end.line ||
    (outer.end.line === inner.end.line &&
      outer.end.column >= inner.end.column));

async function selection(args: readonly string[]): Promise<void> {
  const { values, positional } = options(args, ['--root', '--out']);
  const [configPath, listPath, ...unknown] = positional;
  assert.ok(
    configPath !== undefined && listPath !== undefined && unknown.length === 0,
    'selection <configuration> <doubtful.json> [--root <folder>] [--out <file>]',
  );
  const root = resolve(values.get('--root')?.at(-1) ?? workspaceRoot);
  const config = (
    (await import(pathToFileURL(resolve(configPath)).href)) as {
      default: StrykerConfiguration;
    }
  ).default;
  const listed = JSON.parse(
    readFileSync(resolve(listPath), 'utf8'),
  ) as Doubtful[];

  // The ranges per file, as Stryker's project reader turns a `file:line:column-line:column` pattern
  // into the instrumenter's: lines counted from 0, an absent column the start or end of its line.
  const byFile = new Map<string, Range[]>();
  for (const pattern of config.mutate) {
    const match = /^(.*?):((\d+)(?::(\d+))?-(\d+)(?::(\d+))?)$/u.exec(pattern);
    assert.ok(match !== null, `Not a mutate range: ${pattern}`);
    const [, file, , startLine, startColumn, endLine, endColumn] = match;
    const name = resolve(root, file as string);
    byFile.set(name, [
      ...(byFile.get(name) ?? []),
      {
        start: {
          line: Number(startLine) - 1,
          column: Number(startColumn ?? 0),
        },
        end: {
          line: Number(endLine) - 1,
          column: Number(endColumn ?? Number.MAX_SAFE_INTEGER),
        },
      },
    ]);
  }

  // The ignore plugins the configuration names, from the plugin files it loads; a package plugin
  // is not an ignore plugin of this tool's, and a name found nowhere fails.
  const { PluginKind } = await stryker<{
    PluginKind: { Ignore: string };
  }>('@stryker-mutator/api/plugin');
  const declared: { kind: string; name: string; value: unknown }[] = [];
  for (const plugin of config.plugins ?? []) {
    const url = plugin.startsWith('file:')
      ? plugin
      : isAbsolute(plugin) || plugin.startsWith('.')
        ? pathToFileURL(resolve(root, plugin)).href
        : undefined;
    if (url === undefined) continue;
    const module = (await import(url)) as {
      strykerPlugins?: typeof declared;
    };
    declared.push(...(module.strykerPlugins ?? []));
  }
  const ignorers = (config.ignorers ?? []).map((name) => {
    const found = declared.find(
      (plugin) => plugin.kind === PluginKind.Ignore && plugin.name === name,
    );
    assert.ok(found !== undefined, `No ignore plugin named ${name} is loaded.`);
    return found.value;
  });

  const { Instrumenter } = await stryker<{
    Instrumenter: new (logger: unknown) => {
      instrument(
        files: { name: string; mutate: Range[]; content: string }[],
        options: unknown,
      ): Promise<{ mutants: InstrumentedMutant[] }>;
    };
  }>('@stryker-mutator/instrumenter');
  const quiet = () => undefined;
  const logger = {
    trace: quiet,
    debug: quiet,
    info: quiet,
    warn: (...message: unknown[]) =>
      process.stderr.write(`${message.map(String).join(' ')}\n`),
    error: (...message: unknown[]) =>
      process.stderr.write(`${message.map(String).join(' ')}\n`),
    fatal: quiet,
    isTraceEnabled: () => false,
    isDebugEnabled: () => false,
    isInfoEnabled: () => false,
    isWarnEnabled: () => true,
    isErrorEnabled: () => true,
    isFatalEnabled: () => true,
  };
  const { mutants } = await new Instrumenter(logger).instrument(
    [...byFile].map(([name, mutate]) => ({
      name,
      mutate,
      content: readFileSync(name, 'utf8'),
    })),
    {
      ignorers,
      plugins: config.mutator?.plugins ?? null,
      excludedMutations: config.mutator?.excludedMutations ?? [],
    },
  );

  const wanted = new Set(listed.map(doubtfulKey));
  const read = new Set<string>();
  const listedIgnored: string[] = [];
  const sameLocation: string[] = [];
  const containing: string[] = [];
  const unexplained: string[] = [];
  let ignored = 0;
  const every: { key: string; kind: string }[] = [];
  const sort = (key: string, kind: string): void => {
    every.push({ key, kind });
  };
  for (const mutant of mutants) {
    const file = repositoryPath(mutant.fileName);
    // The instrumenter counts lines and columns from 0, a report from 1.
    const at: Range = {
      start: {
        line: mutant.location.start.line + 1,
        column: mutant.location.start.column + 1,
      },
      end: {
        line: mutant.location.end.line + 1,
        column: mutant.location.end.column + 1,
      },
    };
    const key = `${file}|${span(at.start, at.end)}|${mutant.mutatorName}|${mutant.replacement}`;
    if (mutant.status === 'Ignored') {
      ignored += 1;
      sort(key, 'ignored');
      if (wanted.has(key)) listedIgnored.push(key);
      continue;
    }
    if (wanted.has(key)) {
      read.add(key);
      sort(key, 'listed');
      continue;
    }
    const mine = listed.filter((entry) => entry.file === file);
    if (
      mine.some(
        (entry) => span(entry.start, entry.end) === span(at.start, at.end),
      )
    ) {
      sameLocation.push(key);
      sort(key, 'sameLocation');
    } else if (mine.some((entry) => holds(at, entry))) {
      containing.push(key);
      sort(key, 'containing');
    } else {
      unexplained.push(key);
      sort(key, 'unexplained');
    }
  }
  const missing = [...wanted].filter(
    (key) => !read.has(key) && !listedIgnored.includes(key),
  );
  const counts = {
    files: byFile.size,
    instrumented: mutants.length,
    ignored,
    notIgnored: mutants.length - ignored,
    listed: wanted.size,
    read: read.size,
    missing,
    listedIgnored,
    sameLocation,
    containing,
    unexplained,
  };
  const outPath = values.get('--out')?.at(-1);
  if (outPath !== undefined) {
    writeFileSync(resolve(outPath), `${JSON.stringify(every, null, 1)}\n`);
  }
  // The last line is the whole result, for a script to read.
  process.stdout.write(
    `${counts.notIgnored} of ${counts.instrumented} mutants in ${counts.files} files are read: ${read.size} of ${wanted.size} listed, ${sameLocation.length} on a listed node, ${containing.length} on a node holding one, ${unexplained.length} unexplained; ${missing.length} listed missing, ${listedIgnored.length} listed Ignored.\n${JSON.stringify(counts)}\n`,
  );
  if (
    missing.length > 0 ||
    listedIgnored.length > 0 ||
    unexplained.length > 0
  ) {
    process.exitCode = 1;
  }
}

const ACTIONS: Record<
  string,
  (args: readonly string[]) => void | Promise<void>
> = {
  doubtful,
  selection,
  ranges,
  merge,
  survivors,
  skeletons,
  changed,
};
const [action, ...rest] = process.argv.slice(2);
const run = action === undefined ? undefined : ACTIONS[action];
if (run === undefined) {
  process.stderr.write(
    `Usage: node tools/mutation-reading.ts ${Object.keys(ACTIONS).join('|')} ...\n`,
  );
  process.exitCode = 2;
} else {
  await run(rest);
}
