/**
 * The self-test of `tools/mutation-reading.ts`: that a doubtful reading reads its listed mutants and
 * no neighbour, and that `merge` takes a second reading's verdicts for exactly those.
 *
 * A planted package source with nested expressions, and a planted first report over it with three
 * doubtful mutants: one alone in its range, and two nested, the inner inside the outer's range.
 * `doubtful` writes a configuration for them, and `selection` instruments the source with that
 * configuration as Stryker would and sorts what is left to read. The mutants it must leave: the three
 * listed, the other mutators' mutants on the listed nodes, and the mutants of the node between the
 * nested two, which an ignore plugin cannot name without ignoring the inner listed one with it.
 * Every other mutant in the ranges must come back `Ignored`. The same configuration without its
 * ignore plugin must fail the same check, so the check is shown to see a neighbour.
 *
 * `merge` takes a planted second report: an `Ignored` neighbour there is not read, so it is neither
 * also read nor differing; a listed mutant absent from it, or `Ignored` in it, fails the merge before
 * any file is written.
 *
 * `behaviorLines`, which `changed` reads lines through, is checked on its own: a specifier that
 * names only a type, with its comma, is not a line with behaviour, in an export as in an import.
 *
 * The installed instrumenter is checked to mutate inside an `as` assertion, `as const` included,
 * which it does only with the repository's patch applied (`patches/`, named in
 * `pnpm-workspace.yaml`).
 *
 * The expected mutants are the ones Stryker's instrumenter makes of the planted source; a release of
 * it that mutates the source differently fails here first, which is the point.
 *
 * Usage: `node tools/mutation-reading-self-test.ts`
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { behaviorLines } from './mutation-reading.ts';

const tool = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'mutation-reading.ts',
);

const SOURCE =
  'export const within = (a: number) => a > 1 && a < 3;\n' +
  'export const either = (a: number, b: boolean) => (b || a > 1) && a !== 2;\n';
const FILE = 'packages/demo/src/demo.ts';

/** Every mutant Stryker makes of `SOURCE`: id, mutator, replacement, and the span as a report gives it. */
const ALL: readonly (readonly [string, string, string, string])[] = [
  ['0', 'ArrowFunction', '() => undefined', '1:23-1:52'],
  ['1', 'ConditionalExpression', 'true', '1:38-1:52'],
  ['2', 'ConditionalExpression', 'false', '1:38-1:52'],
  ['3', 'LogicalOperator', 'a > 1 || a < 3', '1:38-1:52'],
  ['4', 'ConditionalExpression', 'true', '1:38-1:43'],
  ['5', 'EqualityOperator', 'a >= 1', '1:38-1:43'],
  ['6', 'EqualityOperator', 'a <= 1', '1:38-1:43'],
  ['7', 'ConditionalExpression', 'true', '1:47-1:52'],
  ['8', 'EqualityOperator', 'a <= 3', '1:47-1:52'],
  ['9', 'EqualityOperator', 'a >= 3', '1:47-1:52'],
  ['10', 'ArrowFunction', '() => undefined', '2:23-2:73'],
  ['11', 'ConditionalExpression', 'true', '2:50-2:73'],
  ['12', 'ConditionalExpression', 'false', '2:50-2:73'],
  ['13', 'LogicalOperator', 'b || a > 1 || a !== 2', '2:50-2:73'],
  ['14', 'ConditionalExpression', 'true', '2:51-2:61'],
  ['15', 'LogicalOperator', 'b && a > 1', '2:51-2:61'],
  ['16', 'ConditionalExpression', 'false', '2:56-2:61'],
  ['17', 'EqualityOperator', 'a >= 1', '2:56-2:61'],
  ['18', 'EqualityOperator', 'a <= 1', '2:56-2:61'],
  ['19', 'ConditionalExpression', 'true', '2:66-2:73'],
  ['20', 'EqualityOperator', 'a === 2', '2:66-2:73'],
];
/** 8 is killed by a test's time limit; 13 and 17 timed out, 17 inside 13's range. */
const LISTED = ['8', '13', '17'];
const SAME_LOCATION = ['7', '9', '11', '12', '16', '18'];
const BETWEEN = ['14', '15'];
const NEIGHBOURS = ['19', '20'];

const key = (id: string): string => {
  const [, mutator, replacement, span] = ALL.find(
    ([at]) => at === id,
  ) as (typeof ALL)[number];
  return `${FILE}|${span}|${mutator}|${replacement}`;
};

function mutant(id: string, status: string, statusReason?: string) {
  const [, mutatorName, replacement, span] = ALL.find(
    ([at]) => at === id,
  ) as (typeof ALL)[number];
  const [start, end] = span.split('-').map((at) => {
    const [line, column] = at.split(':').map(Number);
    return { line, column };
  });
  return {
    id,
    mutatorName,
    replacement,
    location: { start, end },
    status,
    ...(statusReason === undefined ? {} : { statusReason }),
  };
}

const root = mkdtempSync(join(tmpdir(), 'mutation-reading-self-test-'));
let failures = 0;
function check(name: string, test: () => void): void {
  try {
    test();
    process.stdout.write(`ok   ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(
      `FAIL ${name}\n  ${String((error as Error).message).replaceAll('\n', '\n  ')}\n`,
    );
  }
}
const run = (...args: string[]) =>
  spawnSync(process.execPath, [tool, ...args], {
    cwd: root,
    encoding: 'utf8',
  });

// What `changed` counts as a line with behaviour: a specifier that names only a type is erased
// with its type, in an export as in an import, so its line has nothing a test could show running.
check('a type-only export or import specifier carries no behaviour', () => {
  const text = [
    'import {', // 1: an import, none of it behaviour
    '  type Shape,', // 2
    '  build,', // 3
    "} from './shape';", // 4
    'export {', // 5: behaviour, the declaration exports a value
    '  type Shape,', // 6: a type-only specifier
    '  build,', // 7: a value
    '};', // 8
    'export const made: Shape = build();', // 9
    '',
  ].join('\n');
  assert.deepEqual(
    [...behaviorLines(text, 'demo.ts')].sort((a, b) => a - b),
    [5, 7, 8, 9],
  );
});

// The instrumenter as Stryker loads it, from beside the installed core.
const instrumenter = async () => {
  const core = realpathSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../node_modules/@stryker-mutator/core',
    ),
  );
  const from = createRequire(join(core, 'package.json'));
  return (await import(
    pathToFileURL(from.resolve('@stryker-mutator/instrumenter')).href
  )) as {
    Instrumenter: new (logger: unknown) => {
      instrument(
        files: { name: string; mutate: boolean; content: string }[],
        options: unknown,
      ): Promise<{
        mutants: { mutatorName: string; replacement: string }[];
      }>;
    };
  };
};
const silent = () => undefined;
const { Instrumenter } = await instrumenter();
const { mutants: asMutants } = await new Instrumenter({
  trace: silent,
  debug: silent,
  info: silent,
  warn: silent,
  error: silent,
  fatal: silent,
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
}).instrument(
  [
    {
      name: 'as.ts',
      mutate: true,
      content: [
        'export const flags = { on: true } as const;',
        'export const total = (a: number, b: number) => (a - b) as number;',
        '',
      ].join('\n'),
    },
  ],
  { ignorers: [], plugins: null, excludedMutations: [] },
);

// An `as` assertion is erased, but what it asserts about runs. Stryker's instrumenter counts the
// whole assertion as a type node and mutates nothing inside it, which leaves a table written
// `as const` and any expression cast for the compiler unread. The repository patches that out; the
// mutants below are the ones inside the two assertions.
check('an expression inside an `as` assertion is mutated', () => {
  const made = new Set(
    asMutants.map(
      ({ mutatorName, replacement }) => `${mutatorName} ${replacement}`,
    ),
  );
  for (const expected of [
    'ObjectLiteral {}',
    'BooleanLiteral false',
    'ArithmeticOperator a + b',
  ]) {
    assert.ok(
      made.has(expected),
      `No ${expected} mutant inside an as assertion; made: ${[...made].join(', ')}`,
    );
  }
});

try {
  mkdirSync(join(root, 'packages/demo/src'), { recursive: true });
  writeFileSync(join(root, FILE), SOURCE);
  writeFileSync(
    join(root, 'base.mjs'),
    "export default { testRunner: 'vitest', plugins: ['@stryker-mutator/vitest-runner'] };\n",
  );
  const first = {
    files: {
      [FILE]: {
        source: SOURCE,
        mutants: ALL.map(([id]) =>
          id === '8'
            ? mutant(id, 'Killed', 'Test timed out in 5000ms')
            : LISTED.includes(id)
              ? mutant(id, 'Timeout')
              : mutant(id, 'Killed', 'expected false to be true'),
        ),
      },
    },
  };
  writeFileSync(join(root, 'first.json'), JSON.stringify(first));
  const out = join(root, 'out');
  const config = join(out, 'stryker.next.mjs');

  check(
    'doubtful writes the named configuration beside its list and its ignore plugin',
    () => {
      const result = run(
        'doubtful',
        join(root, 'first.json'),
        join(root, 'base.mjs'),
        out,
        '--name',
        'stryker.next.mjs',
      );
      assert.equal(result.status, 0, result.stderr);
      assert.ok(existsSync(config), 'no stryker.next.mjs');
      assert.ok(
        !existsSync(join(out, 'stryker.config.mjs')),
        'also wrote stryker.config.mjs',
      );
      const list = JSON.parse(
        readFileSync(join(out, 'doubtful.json'), 'utf8'),
      ) as {
        file: string;
        id: string;
      }[];
      assert.deepEqual(
        list.map(({ id }) => id),
        LISTED,
      );
    },
  );

  check(
    'the configuration keeps the base plugins and adds the ignore plugin',
    () => {
      // Checked below through `selection`, which loads it; here the shape alone.
      const text = readFileSync(config, 'utf8');
      assert.match(
        text,
        /\.\.\.\(base\.plugins \?\? \['@stryker-mutator\/\*'\]\)/u,
      );
      assert.match(
        text,
        /ignorers: \[\.\.\.\(base\.ignorers \?\? \[\]\), 'thoth-doubtful'\]/u,
      );
    },
  );

  const selection = (configPath: string) => {
    const result = run(
      'selection',
      configPath,
      join(out, 'doubtful.json'),
      '--root',
      root,
    );
    const lines = result.stdout.trim().split('\n');
    return {
      status: result.status,
      stderr: result.stderr,
      counts: JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>,
    };
  };

  check(
    'selection leaves the listed mutants, their same-node ones and the node between, and ignores the rest',
    () => {
      const { status, stderr, counts } = selection(config);
      assert.equal(status, 0, stderr);
      assert.equal(counts['instrumented'], 13);
      assert.equal(counts['read'], LISTED.length);
      assert.deepEqual(counts['missing'], []);
      assert.deepEqual(counts['listedIgnored'], []);
      assert.deepEqual(
        [...(counts['sameLocation'] as string[])].sort(),
        SAME_LOCATION.map(key).sort(),
      );
      assert.deepEqual(
        [...(counts['containing'] as string[])].sort(),
        BETWEEN.map(key).sort(),
      );
      assert.deepEqual(counts['unexplained'], []);
      assert.equal(counts['ignored'], NEIGHBOURS.length);
    },
  );

  check(
    'selection fails the same configuration without its ignore plugin',
    () => {
      const bare = join(out, 'bare.mjs');
      writeFileSync(
        bare,
        `import config from '${pathToFileURL(config).href}';\nexport default { ...config, ignorers: [] };\n`,
      );
      const { status, counts } = selection(bare);
      assert.equal(status, 1);
      assert.deepEqual(
        [...(counts['unexplained'] as string[])].sort(),
        NEIGHBOURS.map(key).sort(),
      );
    },
  );

  // The second reading: the mutants `selection` leaves, with new verdicts, and the rest Ignored.
  const second = (
    change: (id: string) => ReturnType<typeof mutant> | undefined,
  ) => ({
    files: {
      [FILE]: {
        source: SOURCE,
        mutants: [...LISTED, ...SAME_LOCATION, ...BETWEEN, ...NEIGHBOURS]
          .map(change)
          .filter((entry) => entry !== undefined),
      },
    },
  });
  const verdict = (id: string) =>
    NEIGHBOURS.includes(id)
      ? mutant(id, 'Ignored', 'Not a doubtful mutant.')
      : id === '17'
        ? mutant(id, 'Survived')
        : id === '7'
          ? mutant(id, 'Timeout')
          : mutant(id, 'Killed', 'expected false to be true');

  check('merge reads an Ignored neighbour as not read', () => {
    writeFileSync(join(root, 'second.json'), JSON.stringify(second(verdict)));
    writeFileSync(join(root, 'target.json'), JSON.stringify(first));
    const result = run(
      'merge',
      join(out, 'doubtful.json'),
      join(root, 'second.json'),
      join(root, 'summary.json'),
      join(root, 'target.json'),
    );
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(
      readFileSync(join(root, 'summary.json'), 'utf8'),
    ) as {
      alsoRead: number;
      alsoReadDiffering: { where: string }[];
      replaced: unknown[];
      missing: unknown[];
    };
    assert.equal(summary.replaced.length, LISTED.length);
    assert.deepEqual(summary.missing, []);
    assert.equal(summary.alsoRead, SAME_LOCATION.length + BETWEEN.length);
    assert.deepEqual(
      summary.alsoReadDiffering.map(({ where }) => where),
      [key('7')],
    );
    const merged = JSON.parse(
      readFileSync(join(root, 'target.json'), 'utf8'),
    ) as typeof first;
    const status = (id: string) =>
      merged.files[FILE].mutants.find((entry) => entry.id === id)?.status;
    assert.equal(status('17'), 'Survived');
    assert.equal(status('19'), 'Killed');
  });

  for (const [name, change] of [
    ['absent', (id: string) => (id === '17' ? undefined : verdict(id))],
    [
      'Ignored',
      (id: string) => (id === '17' ? mutant(id, 'Ignored', 'x') : verdict(id)),
    ],
  ] as const) {
    check(
      `merge fails, writing nothing, when a listed mutant is ${name} in the second reading`,
      () => {
        const target = join(root, `target-${name}.json`);
        writeFileSync(
          join(root, `second-${name}.json`),
          JSON.stringify(second(change)),
        );
        writeFileSync(target, JSON.stringify(first));
        const result = run(
          'merge',
          join(out, 'doubtful.json'),
          join(root, `second-${name}.json`),
          join(root, `summary-${name}.json`),
          target,
        );
        assert.notEqual(result.status, 0);
        assert.match(
          result.stderr,
          new RegExp(key('17').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
        );
        assert.equal(readFileSync(target, 'utf8'), JSON.stringify(first));
        assert.ok(
          !existsSync(`${target}.before-merge`),
          'kept a .before-merge copy',
        );
        assert.ok(
          !existsSync(join(root, `summary-${name}.json`)),
          'wrote a summary',
        );
      },
    );
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  process.stdout.write(`${failures} failed\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('mutation-reading self-test passed\n');
}
