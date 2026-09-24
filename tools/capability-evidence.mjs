/**
 * The file a stage's claims go to, and the two things that write it.
 *
 * A stage's claims are one file, named for the stage, and the gate hands a claiming stage its path
 * in `EQUATOR_CAPABILITY_CLAIMS`. A process with nothing in that variable records nothing, which is
 * what keeps a run under an injected defect out of the matrix: the stages that inject are never
 * handed a path. Every writer appends one line per record, so the suites, the drivers and the
 * command steps of one stage can all write to the same file.
 *
 * The file opens with a line from each writer, before any claim. A stage that recorded no claims
 * still leaves that line, which is how `verify:matrix` tells a stage whose checks assert nothing
 * it can name from a stage whose writer never ran.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import {
  CLAIMS_FILE_VARIABLE,
  CLAIMS_META_KEY,
  claimRecord,
} from './capability-claims.mjs';

export const EVIDENCE_PROFILE = 'equator-capability-evidence/1';

const append = (file, record) => {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
};

const opened = (file, writer) =>
  append(file, {
    profile: EVIDENCE_PROFILE,
    writer,
    node: process.versions.node,
  });

/**
 * The vitest reporter that writes a suite's claims.
 *
 * A test holds its claims in its own metadata until it finishes (`capability-claims-in-tests.mjs`).
 * This reads them from the final result and writes them only for a test that passed, so the state
 * that decides is the one vitest reports, after retries and after `fails` has been applied.
 */
export class CapabilityClaimsReporter {
  constructor(file, { consumer = false } = {}) {
    this.file = file;
    this.consumer = consumer;
    this.root = undefined;
    this.angularRow = undefined;
  }

  onInit(vitest) {
    this.root = vitest.config.root;
    if (this.consumer) this.angularRow = consumerRow(this.root);
    opened(this.file, 'vitest');
  }

  onTestCaseResult(testCase) {
    const claims = testCase.meta()[CLAIMS_META_KEY];
    if (!Array.isArray(claims) || claims.length === 0) return;
    if (testCase.result().state !== 'passed') return;
    const module = relative(this.root, testCase.module.moduleId)
      .split(sep)
      .join('/');
    for (const claim of claims) {
      if (!(claim.assertions > 0)) continue;
      append(this.file, {
        ...claim,
        ...(this.angularRow === undefined
          ? {}
          : { angularRow: this.angularRow }),
        check: `${module} > ${testCase.fullName}`,
      });
    }
  }
}

/**
 * The reporters a suite runs with: vitest's own, and the claims reporter when the gate asked for
 * claims. Outside the gate a suite reports exactly as it did before claims existed.
 *
 * `consumer` is for a suite running inside a materialized consumer, whose claims also carry the
 * consumer row it was built as.
 */
export function capabilityClaimsReporters({ consumer = false } = {}) {
  const file = claimsFile();
  return file === undefined
    ? ['default']
    : ['default', new CapabilityClaimsReporter(file, { consumer })];
}

/**
 * The consumer row the consumer at `root` was built as, read from the stamp the materializer left
 * and held to what is installed.
 *
 * The stamp alone would say which row was asked for. Each version it names is checked against the
 * package in `node_modules`, so a consumer installed from another row's lock, or left over from
 * another row's run, fails here rather than crediting that row with what a different one ran.
 */
export function consumerRow(root) {
  const stampPath = resolve(root, 'tools/consumer-row.json');
  if (!existsSync(stampPath)) {
    throw new Error(
      `${stampPath} is missing, so these claims cannot name the consumer row they ran in. Materialize the consumer again.`,
    );
  }
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  for (const [name, version] of Object.entries(stamp.versions)) {
    const installed = JSON.parse(
      readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8'),
    ).version;
    if (installed !== version) {
      throw new Error(
        `The ${stamp.row} consumer names ${name} ${version}, and ${installed} is installed. Its claims would credit a row that did not run.`,
      );
    }
  }
  return stamp.row;
}

const claimsFile = () => {
  const file = process.env[CLAIMS_FILE_VARIABLE];
  return file === undefined || file === '' ? undefined : file;
};

/**
 * Opens a check that is not a vitest test (a browser row's section, a command step, a Node row) as
 * a writer of its stage's claims. Called once when the check starts, before it has asserted
 * anything, so its stage shows the writer ran even when nothing it asserted can be named yet.
 */
export function openCapabilityEvidence(writer) {
  const file = claimsFile();
  if (file !== undefined) opened(file, writer);
}

/**
 * The claim such a check makes, after the section's assertions, as `claimCapability` is in a test.
 * Outside a claiming stage it records nothing.
 *
 * There is no assertion count to read here, and none is needed: a section that throws fails its
 * stage, and a failed stage leaves `verify:matrix` skipped rather than reading what it wrote.
 */
export function recordCapabilityClaim(check, capability, observed) {
  const file = claimsFile();
  if (file === undefined) return;
  append(file, { ...claimRecord(capability, observed), check });
}

/**
 * One stage's evidence, read back: whether its writers ran, and every claim it recorded.
 *
 * Returns `missing` when there is no file, and names every line that is not a record, because a
 * line nobody can read is a claim the matrix would otherwise drop without saying so.
 */
export function readEvidence(file) {
  if (!existsSync(file))
    return { missing: true, writers: [], claims: [], unreadable: [] };
  const writers = [];
  const claims = [];
  const unreadable = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        unreadable.push(index + 1);
        return;
      }
      if (
        record.profile === EVIDENCE_PROFILE &&
        typeof record.writer === 'string'
      ) {
        writers.push(record.writer);
      } else if (
        typeof record.capability === 'string' &&
        typeof record.check === 'string'
      ) {
        claims.push(record);
      } else {
        unreadable.push(index + 1);
      }
    });
  return { missing: false, writers, claims, unreadable };
}
