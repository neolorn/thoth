/**
 * One mutation reading out of the parts `tools/mutation-shards.ts` divides it into: the report and
 * the incremental baseline a whole reading of the same tree writes.
 *
 * A part reads every file it touches whole, with `Stryker disable all` and `Stryker restore all`
 * written in where the regions of other parts begin and end. Its report differs from a whole
 * reading's in four ways, and each is undone here against the files as they are, not assumed:
 *
 * - Its `source` is the marked text. The directives are taken out, and what is left must be the
 *   file byte for byte.
 * - A directive is written inline, before a statement that begins its line, so no line moves and
 *   the columns after it on its line do. Each position is moved back by the directives before it.
 * - A replacement is printed with the comments of the nodes in it, so a mutant whose node holds a
 *   directive prints the directive. Its replacement is taken from the mutant a whole reading makes
 *   at the same place.
 * - A mutator's filter reads the mutants of a node's subtree that are not ignored, and
 *   `CallExpression` keeps its mutant only when it is the one mutant there. A call that starts in
 *   one part and holds mutants only in another part's regions keeps, in its own part, a mutant a
 *   whole reading drops.
 *
 * That last difference only ever adds. The filter is handed the mutants collected since the node
 * was entered, and acts only when the node's own mutant is among them. Stryker notes where that
 * slice starts on entering every node and takes the note back on leaving one, and a node Stryker
 * skips on entering it, a type, an import or a decorator, is never left. So a node with a skipped
 * node below it is handed a slice that starts after its own mutant, and its `CallExpression`
 * mutant is always kept. Directives are comments, which change neither the nodes nor the order
 * they are entered in; an ignored mutant is still collected; and a node replaced as mutants are
 * placed in it is not entered again. So whether a node's own mutant is in its slice is the same in
 * a part and in a whole reading. Where it is, the slice is the node's subtree, and a whole reading
 * keeps the call only when its subtree collects no other mutant at all: a mutant of another
 * mutator is never filtered, and of the mutants on the lowest node below that has any, one always
 * survives. The part that owns the call then sees it alone too, and keeps it. So a part holds every
 * mutant a whole reading makes in its regions, and can hold more `CallExpression` mutants, never
 * fewer mutants and never more of another mutator.
 *
 * What a whole reading makes is still not read off the parts. The files are instrumented as
 * Stryker instruments them, without running a test, and that list is the join's: every mutant on it
 * must be read, unignored, by exactly one part, or nothing is written. A part's mutant not on it is
 * dropped and listed in `dropped.json` with its part, file, location and mutator; one of a mutator
 * other than `CallExpression` fails the join, since nothing above can make it. A report numbers its
 * tests for itself, so every part must report the same tests in the same test files, and they are
 * numbered once, by file and name, with each mutant's `coveredBy` and `killedBy` carried across.
 *
 * The report and the incremental baseline are written as the same bytes, in the form Stryker writes
 * them, and a later incremental reading compares their sources, locations, replacements and tests
 * with the tree's own. Nothing is written unless every check passes, and nothing is written over.
 *
 * Usage: node tools/mutation-join.ts <configuration> <output folder> <part report.json>...
 *
 * `tools/mutation-join-self-test.ts` is its self-test.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DISABLE, RESTORE, mutatedFiles } from './mutation-shards.ts';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A position as a report writes it: line and column counted from 1. */
export interface Position {
  readonly line: number;
  readonly column: number;
}
export interface Location {
  readonly start: Position;
  readonly end: Position;
}
export interface ReportMutant {
  readonly id: string;
  readonly mutatorName: string;
  readonly replacement?: string;
  readonly statusReason?: string;
  readonly status: string;
  readonly testsCompleted?: number;
  readonly static?: boolean;
  readonly killedBy?: readonly string[];
  readonly coveredBy?: readonly string[];
  readonly location: Location;
}
export interface ReportFile {
  readonly language: string;
  readonly source: string;
  readonly mutants: readonly ReportMutant[];
}
export interface ReportTest {
  readonly id: string;
  readonly name: string;
  readonly location?: Location;
}
export interface ReportTestFile {
  readonly source?: string;
  readonly tests: readonly ReportTest[];
}
export interface Report {
  readonly files: Readonly<Record<string, ReportFile>>;
  readonly testFiles?: Readonly<Record<string, ReportTestFile>>;
  readonly schemaVersion: string;
  readonly thresholds: unknown;
  readonly projectRoot?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly framework?: unknown;
}
/** A mutant a whole reading makes, from instrumenting the file as it is. */
export interface WholeMutant {
  readonly file: string;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: Location;
}
export interface Dropped {
  readonly part: number;
  readonly file: string;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: Location;
  readonly status: string;
}
export interface Joined {
  readonly report: Report;
  readonly dropped: readonly Dropped[];
}

const DIRECTIVES = [DISABLE, RESTORE];
// A directive inside a printed replacement, with the line break and indentation the printer puts
// after a comment that leads a statement.
const PRINTED_DIRECTIVE = /\/\* Stryker (?:disable|restore) all \*\/\s*/gu;

/** The text with every directive a part wrote taken out, and where each one was. */
export function unmark(marked: string): {
  readonly text: string;
  readonly cuts: readonly { readonly at: number; readonly length: number }[];
} {
  const cuts: { at: number; length: number }[] = [];
  let text = '';
  let from = 0;
  for (;;) {
    const found = DIRECTIVES.map((directive) => ({
      directive,
      at: marked.indexOf(directive, from),
    }))
      .filter(({ at }) => at >= 0)
      .sort((a, b) => a.at - b.at)[0];
    if (found === undefined) break;
    text += marked.slice(from, found.at);
    cuts.push({ at: found.at, length: found.directive.length });
    from = found.at + found.directive.length;
  }
  return { text: text + marked.slice(from), cuts };
}

const lineStarts = (text: string): number[] => {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
};

const offsetOf = (starts: readonly number[], { line, column }: Position) =>
  (starts[line - 1] as number) + column - 1;

const positionOf = (starts: readonly number[], offset: number): Position => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] as number) <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - (starts[low] as number) + 1 };
};

/** Moves a location in a marked text to the same place in the text without its directives. */
export function unmarkLocation(marked: string, location: Location): Location {
  const { text, cuts } = unmark(marked);
  const markedStarts = lineStarts(marked);
  const textStarts = lineStarts(text);
  const move = (position: Position): Position => {
    const offset = offsetOf(markedStarts, position);
    let removed = 0;
    for (const { at, length } of cuts) {
      assert.ok(
        offset <= at || offset >= at + length,
        `A mutant position ${position.line}:${position.column} falls inside a directive.`,
      );
      if (at + length <= offset) removed += length;
    }
    return positionOf(textStarts, offset - removed);
  };
  return { start: move(location.start), end: move(location.end) };
}

const at = ({ start, end }: Location) =>
  `${start.line}:${start.column}-${end.line}:${end.column}`;
const placeKey = (file: string, mutatorName: string, location: Location) =>
  `${file}\n${mutatorName}\n${at(location)}`;
const testKey = (file: string, { name, location }: ReportTest) =>
  `${file}\n${location === undefined ? '' : `${location.start.line}:${location.start.column}`}\n${name}`;

/**
 * The join of the parts' reports, against the files as they are (`originals`, by the path the
 * reports name them by) and the mutants a whole reading makes of them (`whole`, in the order the
 * instrumenter makes them). It throws, having built nothing, on any part that does not fit.
 */
export function joinParts({
  originals,
  whole,
  parts,
}: {
  readonly originals: ReadonlyMap<string, string>;
  readonly whole: readonly WholeMutant[];
  readonly parts: readonly Report[];
}): Joined {
  assert.ok(parts.length > 0, 'There are no parts to join.');
  const owners = whole.map(() => -1);
  const owned: (ReportMutant | undefined)[] = whole.map(() => undefined);
  const byPlace = new Map<string, number[]>();
  whole.forEach((mutant, index) => {
    const key = placeKey(mutant.file, mutant.mutatorName, mutant.location);
    byPlace.set(key, [...(byPlace.get(key) ?? []), index]);
  });
  const languages = new Map<string, string>();
  const dropped: Dropped[] = [];

  parts.forEach((part, partIndex) => {
    assert.equal(
      part.schemaVersion,
      (parts[0] as Report).schemaVersion,
      `Part ${partIndex} has report schema ${part.schemaVersion}, and part 0 ${(parts[0] as Report).schemaVersion}.`,
    );
    for (const [file, entry] of Object.entries(part.files)) {
      const original = originals.get(file);
      assert.ok(
        original !== undefined,
        `Part ${partIndex} reads ${file}, which the configuration does not mutate.`,
      );
      assert.ok(
        unmark(entry.source).text === original,
        `Part ${partIndex}'s ${file}, with its directives removed, is not the file as it is.`,
      );
      languages.set(file, entry.language);
      for (const mutant of entry.mutants) {
        if (mutant.status === 'Ignored') continue;
        const location = unmarkLocation(entry.source, mutant.location);
        const replacement = mutant.replacement ?? mutant.mutatorName;
        const candidates =
          byPlace.get(placeKey(file, mutant.mutatorName, location)) ?? [];
        const stripped = replacement.replace(PRINTED_DIRECTIVE, '');
        const index =
          candidates.find(
            (c) => owners[c] === -1 && whole[c]?.replacement === replacement,
          ) ??
          candidates.find(
            (c) => owners[c] === -1 && whole[c]?.replacement === stripped,
          ) ??
          candidates.find(
            (c) =>
              whole[c]?.replacement === replacement ||
              whole[c]?.replacement === stripped,
          );
        if (index === undefined) {
          assert.equal(
            mutant.mutatorName,
            'CallExpression',
            `Part ${partIndex} reads a ${mutant.mutatorName} mutant at ${file} ${at(location)} that a whole reading does not make, and only a CallExpression mutant can be one.`,
          );
          dropped.push({
            part: partIndex,
            file,
            mutatorName: mutant.mutatorName,
            replacement,
            location,
            status: mutant.status,
          });
          continue;
        }
        assert.equal(
          owners[index],
          -1,
          `${file} ${at(location)} ${mutant.mutatorName} is read by parts ${owners[index]} and ${partIndex}.`,
        );
        owners[index] = partIndex;
        owned[index] = mutant;
      }
    }
  });

  const unread = whole
    .map((mutant, index) => ({ mutant, index }))
    .filter(({ index }) => owners[index] === -1);
  assert.equal(
    unread.length,
    0,
    `${unread.length} mutant(s) a whole reading makes are read by no part, the first ${unread
      .slice(0, 5)
      .map(
        ({ mutant }) =>
          `${mutant.file} ${at(mutant.location)} ${mutant.mutatorName}`,
      )
      .join('; ')}.`,
  );

  // The tests, numbered once by test file and name, the same in every part.
  const first = parts[0] as Report;
  const keysOf = (part: Report, partIndex: number) => {
    const byId = new Map<string, string>();
    for (const [file, { tests }] of Object.entries(part.testFiles ?? {})) {
      for (const test of tests) {
        const key = testKey(file, test);
        assert.ok(
          ![...byId.values()].includes(key),
          `Part ${partIndex} reports the test ${JSON.stringify(test.name)} of ${file} twice.`,
        );
        byId.set(test.id, key);
      }
    }
    return byId;
  };
  const partKeys = parts.map(keysOf);
  const firstKeys = [...(partKeys[0] as Map<string, string>).values()];
  const unified = new Map(firstKeys.map((key, index) => [key, String(index)]));
  parts.forEach((part, partIndex) => {
    const keys = new Set((partKeys[partIndex] as Map<string, string>).values());
    assert.ok(
      keys.size === unified.size && [...keys].every((key) => unified.has(key)),
      `Part ${partIndex} reports other tests than part 0.`,
    );
    for (const [file, { source }] of Object.entries(part.testFiles ?? {})) {
      assert.equal(
        source,
        first.testFiles?.[file]?.source,
        `Part ${partIndex}'s test file ${file} is not part 0's.`,
      );
    }
  });
  const carry = (partIndex: number, ids: readonly string[] | undefined) =>
    ids?.map((id) => {
      const key = (partKeys[partIndex] as Map<string, string>).get(id);
      const joined = key === undefined ? undefined : unified.get(key);
      assert.ok(
        joined !== undefined,
        `Part ${partIndex} names a test ${id} it does not report.`,
      );
      return joined;
    });

  const files: Record<string, ReportFile & { mutants: ReportMutant[] }> = {};
  whole.forEach((mutant, index) => {
    const read = owned[index] as ReportMutant;
    const partIndex = owners[index] as number;
    const entry = (files[mutant.file] ??= {
      language: languages.get(mutant.file) ?? 'typescript',
      source: originals.get(mutant.file) as string,
      mutants: [],
    });
    const killedBy = carry(partIndex, read.killedBy);
    const coveredBy = carry(partIndex, read.coveredBy);
    entry.mutants.push({
      ...read,
      id: String(index),
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      ...(killedBy === undefined ? {} : { killedBy }),
      ...(coveredBy === undefined ? {} : { coveredBy }),
      location: mutant.location,
    });
  });
  const testFiles = Object.fromEntries(
    Object.entries(first.testFiles ?? {}).map(([file, entry]) => [
      file,
      {
        ...entry,
        tests: entry.tests.map((test) => ({
          ...test,
          id: unified.get(testKey(file, test)) as string,
        })),
      },
    ]),
  );
  return {
    report: {
      files,
      schemaVersion: first.schemaVersion,
      thresholds: first.thresholds,
      testFiles,
      ...(first.projectRoot === undefined
        ? {}
        : { projectRoot: first.projectRoot }),
      ...(first.config === undefined ? {} : { config: first.config }),
      ...(first.framework === undefined ? {} : { framework: first.framework }),
    },
    dropped,
  };
}

/** A module of the installed Stryker, found from its core package as Stryker itself finds it. */
async function stryker<T>(specifier: string): Promise<T> {
  const core = realpathSync(
    resolve(workspaceRoot, 'node_modules/@stryker-mutator/core'),
  );
  const from = createRequire(join(core, 'package.json'));
  return (await import(pathToFileURL(from.resolve(specifier)).href)) as T;
}

interface StrykerConfiguration {
  readonly mutate: readonly string[];
  readonly ignorers?: readonly string[];
  readonly mutator?: {
    readonly plugins?: unknown[] | null;
    readonly excludedMutations?: string[];
  };
}

/**
 * The mutants a whole reading makes of `files` (paths relative to `root`, with their text), as
 * Stryker's instrumenter makes them with the configuration's mutator settings: positions from 1.
 */
export async function wholeMutants(
  root: string,
  files: readonly { readonly file: string; readonly text: string }[],
  config: Pick<StrykerConfiguration, 'ignorers' | 'mutator'> = {},
): Promise<WholeMutant[]> {
  return (await instrumentFiles(root, files, config)).map(
    ({ ignored, ...mutant }) => {
      assert.ok(
        !ignored,
        `${mutant.file} carries a mutant a whole reading ignores, which this join cannot read.`,
      );
      return mutant;
    },
  );
}

/**
 * Every mutant the instrumenter makes of `files`, ignored ones included and marked so: what the
 * report of a reading of those texts records, before any test runs.
 */
export async function instrumentFiles(
  root: string,
  files: readonly { readonly file: string; readonly text: string }[],
  config: Pick<StrykerConfiguration, 'ignorers' | 'mutator'> = {},
): Promise<(WholeMutant & { readonly ignored: boolean })[]> {
  assert.equal(
    (config.ignorers ?? []).length,
    0,
    'The configuration names ignore plugins, which this join does not load.',
  );
  const { Instrumenter } = await stryker<{
    Instrumenter: new (logger: unknown) => {
      instrument(
        files: { name: string; mutate: true; content: string }[],
        options: unknown,
      ): Promise<{
        mutants: {
          fileName: string;
          mutatorName: string;
          replacement: string;
          location: Location;
          status?: string;
        }[];
      }>;
    };
  }>('@stryker-mutator/instrumenter');
  const quiet = () => undefined;
  const say = (...message: unknown[]) =>
    process.stderr.write(`${message.map(String).join(' ')}\n`);
  const logger = {
    trace: quiet,
    debug: quiet,
    info: quiet,
    warn: say,
    error: say,
    fatal: quiet,
    isTraceEnabled: () => false,
    isDebugEnabled: () => false,
    isInfoEnabled: () => false,
    isWarnEnabled: () => true,
    isErrorEnabled: () => true,
    isFatalEnabled: () => true,
  };
  const { mutants } = await new Instrumenter(logger).instrument(
    files.map(({ file, text }) => ({
      name: resolve(root, file),
      mutate: true,
      content: text,
    })),
    {
      ignorers: [],
      plugins: config.mutator?.plugins ?? null,
      excludedMutations: config.mutator?.excludedMutations ?? [],
    },
  );
  return mutants.map((mutant) => {
    // The instrumenter counts lines and columns from 0, a report from 1.
    return {
      ignored: mutant.status === 'Ignored',
      file: relative(root, mutant.fileName).replaceAll('\\', '/'),
      mutatorName: mutant.mutatorName,
      replacement: mutant.replacement,
      location: {
        start: {
          line: mutant.location.start.line + 1,
          column: mutant.location.start.column + 1,
        },
        end: {
          line: mutant.location.end.line + 1,
          column: mutant.location.end.column + 1,
        },
      },
    };
  });
}

/** Writes the join into `folder`, which must not hold a report already. */
export function writeJoined(folder: string, { report, dropped }: Joined): void {
  const names = ['report.json', 'incremental.json', 'dropped.json'];
  for (const name of names) {
    assert.ok(
      !existsSync(join(folder, name)),
      `${join(folder, name)} exists already; a join is written into a folder of its own.`,
    );
  }
  mkdirSync(folder, { recursive: true });
  const text = JSON.stringify(report);
  writeFileSync(join(folder, 'report.json'), text);
  writeFileSync(join(folder, 'incremental.json'), text);
  writeFileSync(
    join(folder, 'dropped.json'),
    `${JSON.stringify(dropped, null, 2)}\n`,
  );
}

async function main(): Promise<void> {
  const [configuration, folder, ...reports] = process.argv.slice(2);
  assert.ok(
    configuration !== undefined && folder !== undefined && reports.length > 0,
    'Usage: node tools/mutation-join.ts <configuration> <output folder> <part report.json>...',
  );
  const config = (
    (await import(pathToFileURL(resolve(configuration)).href)) as {
      default: StrykerConfiguration;
    }
  ).default;
  const files = (await mutatedFiles(configuration)).map((file) => ({
    file,
    text: readFileSync(resolve(workspaceRoot, file), 'utf8'),
  }));
  const parts = reports.map(
    (path) => JSON.parse(readFileSync(resolve(path), 'utf8')) as Report,
  );
  const joined = joinParts({
    originals: new Map(files.map(({ file, text }) => [file, text])),
    whole: await wholeMutants(workspaceRoot, files, config),
    parts,
  });
  writeJoined(resolve(folder), {
    ...joined,
    report: {
      ...joined.report,
      projectRoot: workspaceRoot,
      config: { ...joined.report.config, mutate: config.mutate },
    },
  });
  const count = Object.values(joined.report.files).reduce(
    (total, { mutants }) => total + mutants.length,
    0,
  );
  process.stdout.write(
    `Joined ${parts.length} part(s) into ${count} mutants over ${Object.keys(joined.report.files).length} file(s); ${joined.dropped.length} CallExpression mutant(s) a whole reading does not make dropped, listed in dropped.json.\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
