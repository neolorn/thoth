import { resolve } from 'node:path';

/**
 * The gate's stages, and what each one reads and writes.
 *
 * `tools/verify.mjs` derives its graph from these declarations and checks them against a trace of
 * every run. They live here rather than in that file because the runner is not their only reader:
 * `verify:matrix` asks which stages record capability claims, so it can fail on one that recorded
 * none, and a second copy of the answer would agree with the first until a stage was added.
 */

/**
 * `format:check`, `lint:self-test`, `lint` and `typecheck` are the first phase and prerequisites of
 * everything else, applied by the runner rather than written into each stage. A tree that does not
 * typecheck is a tree nobody should be measuring, and a formatting miss found four seconds in should
 * cost four seconds, not the hour the rest of this takes to prove a change that was already
 * correct. That happened: a new test file went unformatted into a run that spent an hour on browser
 * rows and consumer installs before printing a two-line prettier warning. Applying the gate in the
 * runner means a stage added later is covered on the day it lands.
 *
 * Three of the four are a chain rather than four peers, and the chain is the whole of what `needs`
 * says here. `lint` runs after the control that proves it can fail, for the reason
 * `verify:browser-assurance:self-test` runs before the browser gate: a broken control should make
 * what it controls report skipped, which is true, rather than pass on evidence nothing checked.
 * `typecheck` runs after `lint`: the two read the same program and cost about the same, and
 * the linter's finding is the more specific of the two.
 *
 * `claims: true` marks a stage whose checks record the capabilities they assert, and gives it the
 * artefact its claims go to. `readsClaims: true` marks the stage that reads all of them. Both are
 * expanded below rather than written out, so a stage that starts recording claims is one line
 * here and the matrix reads it on the day it lands.
 */
const declared = Object.freeze([
  {
    id: 'format:check',
    gate: true,
    reads: ['source:docs', 'source:packages', 'source:specs', 'source:tools'],
  },
  // Seeds a floating promise and an import cycle into its own copy of the source and requires the
  // lint stage to go red naming both rules. Its own tree, because it writes tracked source; a gate
  // stage, because what it controls is one.
  {
    id: 'lint:self-test',
    gate: true,
    privateTree: true,
    // The same program `typecheck` loads, so the same installed type dependencies under
    // `packages/*/node_modules`: a type-aware rule cannot answer without them.
    reads: ['cache:build', 'source:packages'],
    writes: ['source:packages'],
  },
  {
    id: 'lint',
    gate: true,
    reads: ['cache:build', 'source:packages'],
    needs: [
      {
        on: 'lint:self-test',
        why: 'A linter nobody has seen fail is indistinguishable from one whose rules are off.',
      },
    ],
  },
  // The only stage that reads a test file's types at all: vitest transpiles with esbuild, which
  // strips types without checking them, and `ngc` only compiles what an entry point imports.
  {
    id: 'typecheck',
    gate: true,
    reads: ['cache:build', 'source:packages'],
    needs: [
      {
        on: 'lint',
        why: 'The same program, about the same cost, and the more specific finding first.',
      },
    ],
  },
  { id: 'verify:locale-profile', reads: ['source:packages'] },
  // Cheap, and it runs before anything derives from a vendored file: a source that no longer matches
  // its recorded digest makes every downstream result meaningless rather than wrong. The empty list
  // is deliberate: it reads `standards/`, the vendored sources and their lock, which no stage
  // produces. The one ordering that matters is declared as an edge below, where a reason can be
  // written next to it.
  { id: 'verify:standards-sources', reads: [] },
  // Every tracked file, so every source artefact, plus the commit log, which is not an artefact any
  // stage writes. Nothing depends on it: it is cheap, and a hit is a writing fault rather than a
  // broken build, so there is no reason to hold any other stage behind it.
  {
    id: 'verify:sterilize',
    reads: ['source:docs', 'source:packages', 'source:specs', 'source:tools'],
  },
  // Reads the specifications and every file that can cite one. Cheap, depends on nothing, and
  // holds nothing behind it: a citation that leads nowhere is a writing fault in the same way a
  // dash is, and neither breaks a build.
  {
    id: 'verify:spec-links',
    reads: ['source:docs', 'source:packages', 'source:specs', 'source:tools'],
  },
  // Reads every tracked document and the paths they name. Cheap, depends on nothing, and holds
  // nothing behind it, for the same reason as the two above: a link that arrives nowhere costs a
  // reader their click rather than costing a build.
  {
    id: 'verify:doc-links',
    reads: ['source:docs', 'source:packages', 'source:specs', 'source:tools'],
  },
  { id: 'verify:person-names', reads: ['source:packages'] },
  // The two suites run at the same time, which is what made their shared vitest results cache worth
  // finding: both hashed the empty project name and overwrote each other's record. Each now has its
  // own `cacheDir`, so the artefacts below are genuinely separate rather than separated by schedule.
  // `source:tools` because a test that claims a capability imports the claim from there.
  {
    id: 'test:toolkit',
    reads: ['source:packages', 'source:tools'],
    writes: ['cache:vitest:toolkit'],
    claims: true,
  },
  // The runtime's pure modules: the ones whose import graph reaches no Angular symbol at runtime.
  // Everything else the runtime does is proven in the feature lab, against the built package,
  // because that is the only place a claim about wiring can be made at all. An invariant is
  // asserted here or there, never in both, so this does not become a second copy of the lab.
  // `source:tools` because the twin drift test reads `tools/twin-sources.json`, the one list of
  // files the two packages each keep a copy of, which the mutation configuration reads too.
  {
    id: 'test:runtime',
    reads: ['source:packages', 'source:tools'],
    writes: ['cache:vitest:runtime'],
    claims: true,
  },
  // The first of three stages that mutate tracked source in place and restore it. Each gets a tree
  // of its own, so the mutation has no reader to be protected from and the barrier these three used
  // to be is not there to derive: they still write `source:packages`, but not the copy anything else
  // is reading. Restoring on the way out, including when it throws, remains the stage's own contract
  // and is checked there rather than here: a private tree makes a failure to restore harmless to
  // everyone else, which is not the same as making it correct.
  {
    id: 'verify:assurance',
    privateTree: true,
    writes: ['cache:vitest:unnamed', 'source:packages'],
  },
  {
    id: 'build',
    reads: ['source:packages'],
    writes: ['cache:build', 'dist:other', 'dist:runtime', 'dist:toolkit'],
  },
  {
    id: 'verify:packages',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
  },
  // What gets published is a tarball, and until this existed nothing in the pipeline ever looked at
  // one. A release went out with a type declaration containing the runtime module's JavaScript while
  // the build output on disk was correct throughout.
  {
    id: 'verify:tarballs',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
    writes: ['release:packages'],
  },
  // A scan that counts a scratch directory as its corpus holds exports "used" on files that are
  // about to be cleaned away, so this one reads the built declaration files instead.
  {
    id: 'verify:export-surface',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
  },
  // Reads the built schema rather than the source, so it waits for `build`, and it is the stage
  // that fails when a settable configuration key has no `equator init` flag. `dist:toolkit` is the
  // input; `source:packages` is the checked-in table it compares against.
  {
    id: 'verify:cli-options',
    reads: ['dist:toolkit', 'source:packages'],
  },
  // Same shape and the same reason: the built table is the input, and the two checked-in copies
  // are what it re-renders. It also reads every `src` under `packages/`, to fail a documented code
  // that nothing raises.
  {
    id: 'verify:diagnostics-reference',
    reads: ['dist:toolkit', 'source:docs', 'source:packages'],
  },
  // The command line page is the built CLI's own help and the configuration page is the schema
  // staged beside it, so both wait for `build`. `source:docs` is what they are compared against,
  // and `dist:runtime` is where the entry point page reads what each entry publishes.
  {
    id: 'verify:docs-reference',
    reads: ['dist:runtime', 'dist:toolkit', 'source:docs', 'source:packages'],
  },
  // Reads the composable exports out of the built declarations and the guides out of `docs/`, so
  // it fails when a feature ships with no page telling a reader it exists.
  {
    id: 'verify:guide-coverage',
    reads: ['dist:runtime', 'source:docs'],
  },
  // Reads the built declaration files through the TypeScript checker, so it waits for `build`.
  // `source:tools` is the baseline it compares against, which lives beside it in `tools/`.
  {
    id: 'verify:doc-coverage',
    reads: ['dist:runtime', 'dist:toolkit', 'source:tools'],
  },
  {
    id: 'verify:angular-free-consumer',
    reads: ['dist:runtime', 'source:packages'],
  },
  {
    id: 'verify:handler-derivation',
    privateTree: true,
    writes: ['cache:vitest:unnamed', 'source:packages'],
  },
  // Empty on purpose: it reads `fixtures/semantic-analysis/`, which no stage produces.
  { id: 'verify:angular-analysis', reads: [] },
  {
    id: 'verify:node-compatibility',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
  },
  // Empty on purpose: it reads no file at all. It probes the installed engines, Node's `Intl`
  // and the three Playwright browsers, which the lockfile binds rather than a stage.
  { id: 'verify:platform', reads: [] },
  {
    id: 'verify:consumer',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
    writes: ['consumer:package'],
  },
  {
    id: 'verify:focused-consumers',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
    writes: ['consumer:focused'],
  },
  {
    id: 'verify:angular-22.0.4',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
    writes: ['consumer:angular-22.0.4'],
  },
  {
    id: 'verify:lower-bounds',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
    writes: ['consumer:lower-bounds'],
  },
  // The row that varies the compiler rather than the versions. Analysis adopts a consumer's own
  // options, so every other row exercises one setting of them, and this one reads the generated
  // route table from application source, which is the shape none of the others performs.
  {
    id: 'verify:strict-consumer',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages'],
    writes: ['consumer:strict'],
  },
  // Edits the materialized consumer in place and restores it, asserting the restore was exact. It
  // declares the write, so everything that reads that tree is ordered around it, which under the
  // list was true only because it happened to be written here.
  {
    id: 'verify:edit-cost',
    reads: ['source:packages'],
    writes: ['consumer:package'],
  },
  { id: 'verify:cost-budget', reads: ['consumer:package', 'source:packages'] },
  // What a new project costs Equator between `equator init` and its second scope, run cold against
  // the installed toolkit rather than against the workspace. It reads that consumer and writes
  // nothing it does not create itself, under `tmp/cold-start`, which is nested and so is not an
  // artefact any other stage can see.
  //
  // Its own stage rather than a case inside `verify:packages`: that stage reads `dist/toolkit`, and
  // a staged package cannot run its own CLI. Nothing resolves its dependencies in place. The only
  // toolkit that can execute the six commands is the installed one, and that is a different input.
  { id: 'verify:cold-start', reads: ['consumer:package'] },
  // The published documents, assembled into applications and run. Every fenced block names the file
  // it is, and the READMEs' files are one consumer: the providers, the route table, the switcher,
  // both catalogs and the spec. It ends at the spec, so a README whose blocks compile into an
  // application that renders nothing is still red.
  //
  // Every page under `docs/` is its own consumer on a copy of that one, because a guide shows the
  // configuration its reader would have rather than one carrying every capability. That is the
  // stage's cost: the base installs and runs once, and the pages are built and tested four at a
  // time on copies of it.
  //
  // It reads the two distributables because the consumers install from them, and `docs` and
  // `packages` because the documents are the thing under test. Its own tree under `tmp` is nested,
  // so it is not an artefact any other stage can see.
  {
    id: 'verify:document-blocks',
    reads: ['dist:runtime', 'dist:toolkit', 'source:docs', 'source:packages'],
  },
  // The one check in this list whose cases Equator did not write. It compiles each of the working
  // group's MessageFormat 2 cases with the installed toolkit and evaluates it through the built
  // runtime.
  // "What compiles, renders", as an invariant rather than as cases. Every option in the built-in
  // table, at every declared value, compiled by the installed toolkit and rendered by the built
  // runtime: nothing accepted may throw, and nothing accepted may render exactly as it would
  // without the option. Its cases are generated from the table both halves read, so a function that
  // gains an option contributes its cases on the day it lands.
  {
    id: 'verify:message-function-space',
    reads: ['consumer:package', 'source:packages', 'source:tools'],
  },
  {
    id: 'verify:message-format-conformance',
    reads: ['consumer:package', 'source:packages', 'source:tools'],
    writes: ['report:temp'],
    needs: [
      {
        on: 'verify:standards-sources',
        why: 'A suite from another revision tests another specification and reports the difference as a defect. No artefact passes between them, so no measurement can find this edge.',
      },
    ],
  },
  // Before the three browser rows rather than beside them, and a prerequisite of all three rather
  // than a peer. It watches the assurance verifier die on a deliberate escape, which is the only way
  // to know that file reports anything at all: importing the consumer's server bundle installs
  // Angular's log-only global error handlers, and for as long as they were the last word every
  // assertion outside that file's own `try` printed and exited 0. The gate ran green over a consumer
  // built with the wrong locale set, twice, and looked no different from a real pass.
  {
    id: 'verify:browser-assurance:self-test',
    reads: ['consumer:package', 'source:packages'],
  },
  // The three rows run alone: serial among themselves and not overlapped with anything else
  // either. This is the one exclusion that is declared rather than derived: they share no artefact,
  // and what they contend for is the machine's browsers, which no read or write records.
  //
  // Alone rather than merely serial, because that is what the evidence covers. The
  // `firefox-browser-row` arming failure measures 3 in 40, [0.026, 0.199], on the row run by
  // itself, and a rate measured under one load says nothing about the same row under another. A
  // browser row that started failing because six consumer installs were running beside it would
  // look exactly like the flake already being chased, and would be attributed to it. Letting these
  // overlap non-browser work costs a re-measured 40-set, not a change to this line.
  {
    id: 'verify:browser-assurance',
    reads: ['consumer:package', 'source:packages'],
    exclusive: true,
    needs: [
      {
        on: 'verify:browser-assurance:self-test',
        why: 'If the control stops proving what it proves, this reports skipped, the truth, rather than passing on evidence nothing has checked.',
      },
    ],
  },
  {
    id: 'verify:browser-assurance:angular-22.0.4',
    reads: ['consumer:angular-22.0.4', 'source:packages'],
    exclusive: true,
    needs: [
      {
        on: 'verify:browser-assurance:self-test',
        why: 'All three rows share the listeners the self-test exercises, so one run covers them.',
      },
    ],
  },
  {
    id: 'verify:browser-assurance:lower-bounds',
    reads: ['consumer:lower-bounds', 'source:packages'],
    exclusive: true,
    needs: [
      {
        on: 'verify:browser-assurance:self-test',
        why: 'All three rows share the listeners the self-test exercises, so one run covers them.',
      },
    ],
  },
  // Before `verify:matrix` for the reason `verify:browser-assurance:self-test` is before the browser
  // rows. It plants each thing the matrix must refuse (a claim taken away, a reason over an
  // exercised cell, a claim for a capability its check never names, a stage's evidence missing, a
  // claim from a test that failed) and requires the matrix to go red naming it. Its planted suite
  // runs in a folder of its own under `tmp`, which is not an artefact any other stage can see.
  {
    id: 'verify:matrix:self-test',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
  },
  // Every capability against every context, filled only by claims the stages above recorded. It
  // reads every stage's claims, so it runs after the last of them, and a stage that failed leaves it
  // skipped, which is the truth, rather than green on a matrix missing that stage's evidence.
  // `dist` because the rows are what the built packages publish; `source:packages` and
  // `source:tools` because each claim is read again in the check that made it.
  {
    id: 'verify:matrix',
    reads: ['dist:runtime', 'dist:toolkit', 'source:packages', 'source:tools'],
    readsClaims: true,
    needs: [
      {
        on: 'verify:matrix:self-test',
        why: 'A matrix nobody has seen refuse a missing claim is indistinguishable from one that reads no claims at all.',
      },
    ],
  },
  // Rewrites the built packages with `.package-refresh` siblings and re-hands them to the
  // consumer. Under the list it declared only `verify:consumer` and worked solely because it was
  // written second to last; the three writes below are why that placement was load-bearing.
  {
    id: 'verify:consumer-refresh',
    reads: ['source:packages'],
    writes: ['consumer:package', 'dist:runtime', 'dist:toolkit'],
  },
  // Last, and now derivably so: it writes source, `dist` and the consumer, so every stage above
  // reads something it replaces. It rebuilds the package and re-hands it once per injection, which
  // is 52% of the gate on its own and the reason the ceiling for this item is a fifth rather than a
  // half.
  {
    id: 'verify:assurance:runtime',
    privateTree: true,
    reads: ['cache:build'],
    writes: [
      'consumer:package',
      'dist:other',
      'dist:runtime',
      'dist:toolkit',
      'source:packages',
    ],
    // Measured at 564s, so the bound is a little over three times that.
    timeoutSeconds: 1800,
  },
]);

/** A stage id as a file name. Colons are not allowed in one on Windows. */
export const safeName = (id) => id.replace(/:/gu, '-');

/** The artefact a claiming stage writes its claims to, one per stage so no two stages share one. */
export const claimsArtefact = (id) => `claims:${safeName(id)}`;

/** Where that artefact is, in the tree the stage runs in. */
export const claimsFile = (root, id) =>
  resolve(root, 'tmp', 'capability-claims', `${safeName(id)}.jsonl`);

const claiming = declared.filter(({ claims }) => claims === true);
const position = new Map(declared.map(({ id }, index) => [id, index]));

for (const reader of declared.filter(({ readsClaims }) => readsClaims)) {
  for (const producer of claiming) {
    // Edges only point backwards in the written order, so a producer written after its reader would
    // be ordered after it too, and the reader would read a file that did not exist yet.
    if (position.get(producer.id) > position.get(reader.id)) {
      throw new Error(
        `${producer.id} records claims and is written after ${reader.id}, which reads them. Move it above.`,
      );
    }
  }
}
for (const producer of claiming) {
  // A private tree is removed with its files, and the reader runs in the shared one.
  if (producer.privateTree === true) {
    throw new Error(
      `${producer.id} records claims in a private tree, where ${claimsArtefact(producer.id)} is never read.`,
    );
  }
}

export const steps = Object.freeze(
  declared.map((step) =>
    Object.freeze({
      ...step,
      ...(step.claims === true
        ? { writes: [...(step.writes ?? []), claimsArtefact(step.id)] }
        : {}),
      ...(step.readsClaims === true
        ? {
            reads: [
              ...(step.reads ?? []),
              ...claiming.map(({ id }) => claimsArtefact(id)),
            ],
          }
        : {}),
    }),
  ),
);
