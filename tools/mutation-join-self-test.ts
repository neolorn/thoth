/**
 * The self-test of `tools/mutation-join.ts`: that two parts of a reading join into the mutants a
 * whole reading makes, one for one, and that a part which does not fit stops the join.
 *
 * A planted source is divided into four regions read by two parts, and each part's source is marked
 * with `markSource`, as `tools/mutation-shards.ts apply` marks it. The installed instrumenter
 * instruments the file as it is and each part's marked text, as a reading would, and each part's
 * report is planted from its mutants, with tests numbered differently in each part. The source holds
 * the three places where a part's report differs from a whole reading's:
 *
 * - a statement that calls with a class whose member another part reads, so its own part keeps a
 *   `CallExpression` mutant that a whole reading filters out; the join drops it and lists it. With
 *   a type in the member, both keep it, as the join's header explains;
 * - a method call over a callback cut inside, whose replacement prints the directive; the join
 *   takes the whole reading's replacement;
 * - a statement that begins after a directive, whose mutants' columns move; the join moves them
 *   back.
 *
 * The join must give exactly the whole reading's mutants, with each test named by the same test in
 * every part, and write its report and its baseline as the same bytes. Each planted fault must stop
 * it: a mutant no part reads, a mutant two parts read, a source that is not the file, a part with
 * other tests, a mutant of another mutator than `CallExpression` that a whole reading does not
 * make, and a folder that already holds a join.
 *
 * Each part is also checked alone, as `check-part` checks it when it has run: both parts fit in
 * either order, and the parts the regions name for the whole reading's mutants are the parts the
 * instrumenter gives them. A part that leaves a mutant of its regions unread, reads one of another
 * part's, is checked twice, reads one a part checked before has read, has other tests than the
 * first checked, or comes after the files changed, must stop at that part.
 *
 * Usage: `node tools/mutation-join-self-test.ts`
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkPart,
  instrumentFiles,
  joinParts,
  type PartsChecked,
  regionOwners,
  type Report,
  type ReportMutant,
  unmarkLocation,
  wholeMutants,
  writeJoined,
} from './mutation-join.ts';
import { DISABLE, markSource, RESTORE } from './mutation-shards.ts';

const file = 'packages/sample/src/sample.ts';
const source = [
  'declare function register(type: unknown): void;',
  '',
  'register(class {',
  '  first(value) {',
  '    return value > 1;',
  '  }',
  '});',
  '',
  'export const anyLarge = (values: readonly number[]): boolean =>',
  '  values.some((value) => {',
  '    const doubled = value * 2;',
  '    return doubled > 10;',
  '  });',
  '',
].join('\n');
// Part 0 reads the call and the arrow function, part 1 the class member and the callback's return.
const regions = [
  { from: 1, shard: 0 },
  { from: 4, shard: 1 },
  { from: 9, shard: 0 },
  { from: 12, shard: 1 },
];
const testNames = [
  ['packages/sample/test/a.test.ts', 'counts a large value'],
  ['packages/sample/test/a.test.ts', 'registers the class'],
  ['packages/sample/test/b.test.ts', 'reads the first member'],
] as const;

const root = mkdtempSync(join(tmpdir(), 'mutation-join-self-test-'));
const failures: string[] = [];
const check = (label: string, run: () => void): void => {
  try {
    run();
    process.stdout.write(`ok   ${label}\n`);
  } catch (error) {
    failures.push(`${label}: ${(error as Error).message}`);
    process.stdout.write(`FAIL ${label}\n`);
  }
};
const refuses = (label: string, phrase: RegExp, run: () => unknown): void =>
  check(label, () => {
    assert.throws(run, phrase);
  });

try {
  const whole = await wholeMutants(root, [{ file, text: source }]);
  const marked = [0, 1].map((shard) =>
    markSource(source, regions, shard, file),
  );
  const partMutants = await Promise.all(
    marked.map((text) => instrumentFiles(root, [{ file, text }])),
  );

  // Part 0 numbers the tests in order and part 1 in reverse, as two reports would.
  const partReport = (shard: number): Report => {
    const ids = shard === 0 ? ['0', '1', '2'] : ['2', '1', '0'];
    const testFiles: Record<
      string,
      { source: string; tests: { id: string; name: string }[] }
    > = {};
    testNames.forEach(([testFile, name], index) => {
      (testFiles[testFile] ??= {
        source: `// ${testFile}\n`,
        tests: [],
      }).tests.push({
        id: ids[index] as string,
        name,
      });
    });
    const mutants = (partMutants[shard] ?? []).map(
      ({ ignored, mutatorName, replacement, location }, index): ReportMutant =>
        ignored
          ? {
              id: String(index),
              mutatorName,
              replacement,
              statusReason: 'Ignored using a comment',
              status: 'Ignored',
              location,
            }
          : {
              id: String(index),
              mutatorName,
              replacement,
              status: 'Killed',
              testsCompleted: 2,
              static: false,
              killedBy: [ids[0] as string],
              coveredBy: [ids[0] as string, ids[1] as string],
              location,
            },
    );
    return {
      schemaVersion: '1.0',
      thresholds: { high: 80, low: 60, break: null },
      files: {
        [file]: {
          language: 'typescript',
          source: marked[shard] as string,
          mutants,
        },
      },
      testFiles,
    };
  };
  const parts = [partReport(0), partReport(1)];
  const originals = new Map([[file, source]]);
  const joined = joinParts({ originals, whole, parts });
  const joinedMutants = joined.report.files[file]?.mutants ?? [];

  check('the join gives the whole reading mutants, one for one', () => {
    assert.ok(whole.length > 0);
    assert.deepEqual(
      joinedMutants.map(({ mutatorName, replacement, location }) => ({
        mutatorName,
        replacement,
        location,
      })),
      whole.map(({ mutatorName, replacement, location }) => ({
        mutatorName,
        replacement,
        location,
      })),
    );
    assert.ok(joinedMutants.every((mutant) => mutant.status === 'Killed'));
    assert.equal(joined.report.files[file]?.source, source);
  });

  check(
    'a call whose class member another part reads is dropped and listed',
    () => {
      const atCall = (mutant: {
        mutatorName: string;
        location: { start: { line: number } };
      }) =>
        mutant.mutatorName === 'CallExpression' &&
        mutant.location.start.line === 3;
      assert.equal(
        (partMutants[0] ?? []).filter(
          (mutant) => !mutant.ignored && atCall(mutant),
        ).length,
        1,
        'part 0 keeps the call statement mutant',
      );
      assert.ok(!whole.some(atCall), 'a whole reading filters it out');
      assert.deepEqual(
        joined.dropped.map(({ part, file: name, mutatorName, location }) => ({
          part,
          file: name,
          mutatorName,
          line: location.start.line,
        })),
        [{ part: 0, file, mutatorName: 'CallExpression', line: 3 }],
      );
    },
  );

  // With a type below the call, Stryker skips the type and hands the call a slice without its own
  // mutant, so a whole reading and the part alike keep it, and nothing is dropped.
  const typed = source.replace(
    'first(value) {',
    'first(value: number): boolean {',
  );
  const typedWhole = await instrumentFiles(root, [{ file, text: typed }]);
  const typedPart = await instrumentFiles(root, [
    { file, text: markSource(typed, regions, 0, file) },
  ]);
  check(
    'a call with a type below it is kept alike by a whole reading and its part',
    () => {
      const atCall = (mutant: {
        mutatorName: string;
        location: { start: { line: number } };
      }) =>
        mutant.mutatorName === 'CallExpression' &&
        mutant.location.start.line === 3;
      assert.equal(
        typedWhole.filter(atCall).length,
        1,
        'a whole reading keeps it',
      );
      assert.equal(
        typedPart.filter((mutant) => !mutant.ignored && atCall(mutant)).length,
        1,
        'part 0 keeps it',
      );
    },
  );

  check(
    'a replacement that prints a directive takes the whole reading one',
    () => {
      const printed = (partMutants[0] ?? []).find(
        (mutant) =>
          !mutant.ignored &&
          mutant.mutatorName === 'MethodExpression' &&
          mutant.replacement.includes(DISABLE.trim()),
      );
      assert.ok(
        printed !== undefined,
        'part 0 prints the directive in values.every',
      );
      const restored = joinedMutants.find(
        (mutant) =>
          mutant.mutatorName === 'MethodExpression' &&
          mutant.location.start.line === printed.location.start.line,
      );
      assert.ok(restored?.replacement !== undefined);
      assert.ok(!restored.replacement.includes('Stryker'));
      assert.ok(
        whole.some(
          (mutant) =>
            mutant.mutatorName === 'MethodExpression' &&
            mutant.replacement === restored.replacement,
        ),
      );
    },
  );

  check(
    "a mutant after a directive on its line comes back to the file's column",
    () => {
      const moved = (partMutants[1] ?? []).find(
        (mutant) => !mutant.ignored && mutant.location.start.line === 12,
      );
      assert.ok(moved !== undefined, 'part 1 reads line 12');
      const back = unmarkLocation(marked[1] as string, moved.location);
      assert.equal(
        moved.location.start.column - back.start.column,
        RESTORE.length,
      );
      assert.ok(
        whole.some(
          (mutant) =>
            mutant.location.start.line === 12 &&
            mutant.location.start.column === back.start.column,
        ),
      );
    },
  );

  check('each test is named by the same test in every part', () => {
    const names = new Map(
      Object.entries(joined.report.testFiles ?? {}).flatMap(
        ([testFile, entry]) =>
          entry.tests.map(
            (test) => [test.id, `${testFile} ${test.name}`] as const,
          ),
      ),
    );
    for (const mutant of joinedMutants) {
      assert.deepEqual(
        mutant.killedBy?.map((id) => names.get(id)),
        ['packages/sample/test/a.test.ts counts a large value'],
      );
      assert.deepEqual(
        mutant.coveredBy?.map((id) => names.get(id)),
        [
          'packages/sample/test/a.test.ts counts a large value',
          'packages/sample/test/a.test.ts registers the class',
        ],
      );
    }
  });

  check(
    'the report and the baseline are the same bytes, and a join is not written over',
    () => {
      const folder = join(root, 'joined');
      writeJoined(folder, joined);
      assert.equal(
        readFileSync(join(folder, 'report.json'), 'utf8'),
        readFileSync(join(folder, 'incremental.json'), 'utf8'),
      );
      assert.equal(
        (
          JSON.parse(
            readFileSync(join(folder, 'dropped.json'), 'utf8'),
          ) as unknown[]
        ).length,
        1,
      );
      assert.throws(() => writeJoined(folder, joined), /exists already/u);
    },
  );

  const withMutants = (
    report: Report,
    edit: (mutants: ReportMutant[]) => ReportMutant[],
  ): Report => {
    const entry = report.files[file];
    assert.ok(entry !== undefined);
    return {
      ...report,
      files: { [file]: { ...entry, mutants: edit([...entry.mutants]) } },
    };
  };
  const firstRead = (report: Report) =>
    (report.files[file]?.mutants ?? []).findIndex(
      (mutant) => mutant.status !== 'Ignored',
    );
  const [first, second] = parts as [Report, Report];

  refuses('a mutant no part reads stops the join', /read by no part/u, () =>
    joinParts({
      originals,
      whole,
      parts: [
        first,
        withMutants(second, (mutants) =>
          mutants.filter((_, index) => index !== firstRead(second)),
        ),
      ],
    }),
  );
  refuses('a mutant two parts read stops the join', /is read by parts/u, () =>
    joinParts({ originals, whole, parts: [first, second, second] }),
  );
  refuses(
    'a source that is not the file stops the join',
    /not the file as it is/u,
    () =>
      joinParts({
        originals,
        whole,
        parts: [
          withMutants(
            {
              ...first,
              files: {
                [file]: {
                  ...(first.files[file] as Report['files'][string]),
                  source: `${marked[0] as string} `,
                },
              },
            },
            (mutants) => mutants,
          ),
          second,
        ],
      }),
  );
  refuses('a part with other tests stops the join', /other tests/u, () =>
    joinParts({
      originals,
      whole,
      parts: [
        first,
        {
          ...second,
          testFiles: {
            ...second.testFiles,
            'packages/sample/test/b.test.ts': {
              source: '// packages/sample/test/b.test.ts\n',
              tests: [{ id: '0', name: 'reads another member' }],
            },
          },
        },
      ],
    }),
  );
  refuses(
    'a mutant of another mutator that a whole reading does not make stops the join',
    /only a CallExpression mutant can be one/u,
    () =>
      joinParts({
        originals,
        whole,
        parts: [
          withMutants(first, (mutants) => [
            ...mutants,
            {
              ...(mutants[firstRead(first)] as ReportMutant),
              id: 'planted',
              mutatorName: 'StringLiteral',
              replacement: '"planted"',
            },
          ]),
          second,
        ],
      }),
  );

  // Each part checked alone as soon as it has run, against its regions' share of the whole list.
  const expected = regionOwners(
    whole,
    originals,
    new Map([[file, regions]]),
    1,
  );
  const checkOne = (part: Report, partIndex: number, checked?: PartsChecked) =>
    checkPart({ originals, whole, expected, part, partIndex, checked });
  const afterFirst = checkOne(first, 0);
  check(
    'each part fits alone, and the regions name the part the instrumenter gives',
    () => {
      const afterSecond = checkOne(second, 1, afterFirst.checked);
      assert.deepEqual(afterSecond.checked.owners, expected);
      assert.equal(afterFirst.read + afterSecond.read, whole.length);
      assert.deepEqual(
        [...afterFirst.dropped, ...afterSecond.dropped],
        [...joined.dropped],
      );
      assert.deepEqual(afterSecond.checked.parts, [0, 1]);
      const reversed = checkOne(first, 0, checkOne(second, 1).checked);
      assert.deepEqual(reversed.checked.owners, expected);
      assert.equal(reversed.checked.tests.part, 1);
    },
  );
  refuses(
    'a part that leaves a mutant of its regions unread stops at that part',
    /leaves 1 mutant\(s\) of its own regions unread/u,
    () =>
      checkOne(
        withMutants(second, (mutants) =>
          mutants.filter((_, index) => index !== firstRead(second)),
        ),
        1,
        afterFirst.checked,
      ),
  );
  refuses(
    "a part that reads a mutant of another part's regions stops at that part",
    /lies in a region of part 1, and part 0 reads it/u,
    () => checkOne(second, 0),
  );
  refuses('a part checked twice stops', /checked already/u, () =>
    checkOne(first, 0, afterFirst.checked),
  );
  refuses(
    'a mutant a part checked before has read stops the next part',
    /is read by parts 0 and 1/u,
    () =>
      checkOne(second, 1, {
        ...afterFirst.checked,
        owners: afterFirst.checked.owners.map((owner, index) =>
          index === expected.indexOf(1) ? 0 : owner,
        ),
      }),
  );
  refuses(
    'a part with other tests than the first checked stops at that part',
    /other tests than part 0/u,
    () =>
      checkOne(
        {
          ...second,
          testFiles: {
            ...second.testFiles,
            'packages/sample/test/b.test.ts': {
              source: '// packages/sample/test/b.test.ts\n',
              tests: [{ id: '0', name: 'reads another member' }],
            },
          },
        },
        1,
        afterFirst.checked,
      ),
  );
  refuses(
    'files that changed since the first part was checked stop the next',
    /the files have changed/u,
    () =>
      checkOne(second, 1, {
        ...afterFirst.checked,
        wholeCount: whole.length + 1,
      }),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

assert.ok(!existsSync(root));
if (failures.length > 0) {
  process.stderr.write(
    `mutation-join self-test failed:\n${failures.join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write('mutation-join self-test passed\n');
