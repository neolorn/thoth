/**
 * `verify:gate-limits:self-test`: the gate's scheduler, driven over a planted graph and held to
 * the limits it exists to keep.
 *
 * The scheduler is the one `verify.mjs` runs on (`createScheduler` in `gate-resources.mjs`), handed
 * stages that finish in a fixed pseudo-random order and a memory reading that dips below the floor
 * partway through. At every start it must hold:
 *
 * - the processors of the stages running, the new one included, within the budget;
 * - an exclusive stage alone, and nothing started beside one;
 * - no start while free memory is under the floor;
 * - no stage before the stages it depends on.
 *
 * And every stage must run in the end, because a scheduler that keeps its limits by starting
 * nothing has kept them trivially. The readings the gate takes of its own process tree are planted
 * too: a process under it above its priority must be named, and the processors a window reports
 * must be the CPU time the tree used in it. The budget's default and each stage's declared share are
 * checked against the real declarations too, so a share nobody can be handed fails here rather
 * than in a run.
 */
import assert from 'node:assert/strict';

import {
  createScheduler,
  MEMORY_FLOOR,
  processorBudget,
  PROCESSORS_VARIABLE,
  runnerEnvironment,
  stageProcessors,
} from './gate-resources.mjs';
import {
  aboveRoot,
  descendantsOf,
  holdDown,
  processorsBetween,
} from './process-tree.mjs';
import { steps as declaredSteps } from './verify-stages.mjs';

// The default is half the machine, whatever the machine.
assert.equal(
  processorBudget({}, 32),
  16,
  'The default budget is not half of 32.',
);
assert.equal(
  processorBudget({}, 3),
  1,
  'The default budget is not half of 3, rounded down.',
);
assert.equal(
  processorBudget({}, 1),
  1,
  'The default budget left a one-processor machine nothing.',
);
assert.equal(
  processorBudget({ [PROCESSORS_VARIABLE]: '6' }, 32),
  6,
  'The setting was not read.',
);
for (const wrong of ['0', '-2', '1.5', 'half']) {
  assert.throws(
    () => processorBudget({ [PROCESSORS_VARIABLE]: wrong }, 32),
    new RegExp(PROCESSORS_VARIABLE, 'u'),
    `A budget of ${wrong} was accepted.`,
  );
}
assert.deepEqual(
  Object.values(runnerEnvironment(3)),
  ['3', '3', '3', '3'],
  'A runner setting was handed something other than the stage share.',
);
for (const step of declaredSteps) {
  if (step.processors === undefined) continue;
  assert.ok(
    Number.isInteger(step.processors) && step.processors >= 1,
    `${step.id} declares ${step.processors} processors; a share is a whole number, at least 1.`,
  );
}

// A small deterministic generator, so a failure names the same run every time.
let seed = 0x2f5a1c3;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const BUDGET = 8;
const planted = [];
for (let index = 0; index < 60; index += 1) {
  planted.push({
    id: `stage-${index}`,
    processors: [undefined, 1, 2, 4, 4, 12][index % 6],
    exclusive: index % 17 === 5,
  });
}
const dependencies = new Map(planted.map(({ id }) => [id, new Set()]));
for (let index = 1; index < planted.length; index += 1) {
  if (index % 3 === 0)
    dependencies.get(planted[index].id).add(planted[index - 1].id);
  if (index % 7 === 0)
    dependencies.get(planted[index].id).add(planted[index - 5].id);
}

let clock = 0;
// Below the floor between these two moments.
const lowFrom = 40;
const lowUntil = 70;
const memory = () =>
  clock >= lowFrom && clock < lowUntil
    ? { free: MEMORY_FLOOR * 100 - 1, total: 100 }
    : { free: 90, total: 100 };

const results = new Map();
const active = new Map();
const ends = new Map();
const violations = [];
const scheduler = createScheduler({
  steps: planted,
  dependencies,
  results,
  budget: BUDGET,
  readMemory: memory,
  launch: (step, processors) => {
    const inUse = [...active.values()].reduce((sum, n) => sum + n, 0);
    if (inUse + processors > BUDGET)
      violations.push(
        `${step.id} took ${processors} with ${inUse} of ${BUDGET} in use`,
      );
    if (processors !== stageProcessors(step, BUDGET))
      violations.push(`${step.id} was handed ${processors}, not its share`);
    if (step.exclusive && active.size > 0)
      violations.push(
        `${step.id} runs alone and started beside ${[...active.keys()].join(', ')}`,
      );
    for (const id of active.keys()) {
      if (planted.find((other) => other.id === id).exclusive)
        violations.push(`${step.id} started beside ${id}, which runs alone`);
    }
    const { free, total } = memory();
    if (free < total * MEMORY_FLOOR)
      violations.push(
        `${step.id} started at ${clock} with free memory under the floor`,
      );
    for (const dependency of dependencies.get(step.id)) {
      if (results.get(dependency)?.status !== 'pass')
        violations.push(`${step.id} started before ${dependency} passed`);
    }
    active.set(step.id, processors);
    ends.set(step.id, clock + 1 + Math.floor(random() * 9));
  },
});

let heldForMemory = 0;
scheduler.advance();
while (active.size > 0 || scheduler.waitingOnMemory) {
  clock += 1;
  assert.ok(clock < 10_000, 'The planted run never finished.');
  for (const [id, end] of [...ends]) {
    if (end > clock) continue;
    ends.delete(id);
    active.delete(id);
    results.set(id, { status: 'pass' });
    scheduler.finished(id);
  }
  if (scheduler.waitingOnMemory) {
    heldForMemory += 1;
    scheduler.advance();
  }
}

assert.deepEqual(
  violations,
  [],
  `The scheduler went over its limits:\n  ${violations.join('\n  ')}`,
);
assert.equal(
  results.size,
  planted.length,
  `The scheduler kept its limits by never starting ${planted.length - results.size} stages.`,
);
assert.ok(
  scheduler.peakProcessors === BUDGET,
  `The planted run never filled the budget (peak ${scheduler.peakProcessors} of ${BUDGET}), so it proved nothing about the edge.`,
);

// The readings the gate takes of its own tree while it runs, planted: the gate is 10 at base
// priority 6, 11 and 12 are its stage and that stage's runner, 13 is a process that raised itself,
// 14 is the reader, and 99 belongs to nobody under the gate.
const reading = (cpu) => [
  { pid: 10, ppid: 1, priority: 6, cpuSeconds: 0 },
  { pid: 11, ppid: 10, priority: 6, cpuSeconds: cpu[0] },
  { pid: 12, ppid: 11, priority: 6, cpuSeconds: cpu[1] },
  { pid: 13, ppid: 12, priority: 8, cpuSeconds: cpu[2] },
  { pid: 14, ppid: 10, priority: 8, cpuSeconds: 50 },
  { pid: 99, ppid: 1, priority: 13, cpuSeconds: 500 },
];
assert.deepEqual(
  aboveRoot(reading([0, 0, 0]), 10, new Set([14])).map(({ pid }) => pid),
  [13],
  'A process under the gate above its priority was not named, or one outside the tree or the reader was.',
);
assert.equal(
  aboveRoot(reading([0, 0, 0]), 7),
  undefined,
  'A reading without the gate in it read as a clean one.',
);
const before = descendantsOf(reading([1, 2, 3]), 10, new Set([14]));
const after = descendantsOf(
  [...reading([11, 12, 13]), { pid: 15, ppid: 11, priority: 6, cpuSeconds: 5 }],
  10,
  new Set([14]),
);
assert.equal(
  processorsBetween(before, after, 10),
  3.5,
  'Three processes each busy for the window, and one that started in it, did not read as 3.5 processors.',
);

// A Windows reading, where a parent id outlives its process: 12 is a gate process that was given
// the id a boot-time process once had, and 40, started long before the gate, still names it.
const reused = [
  { pid: 10, ppid: 1, priority: 6, cpuSeconds: 0, started: 5_000 },
  { pid: 12, ppid: 10, priority: 6, cpuSeconds: 1, started: 6_000 },
  { pid: 13, ppid: 12, priority: 6, cpuSeconds: 1, started: 7_000 },
  { pid: 40, ppid: 12, priority: 13, cpuSeconds: 9_000, started: 1_000 },
];
assert.deepEqual(
  descendantsOf(reused, 10).map(({ pid }) => pid),
  [12, 13],
  'A process that started before the gate process it names as its parent was read as under the gate.',
);

// A process that raised itself is lowered and is not a finding; found above again, it is one, and
// so is one that cannot be lowered at all.
const lowered = new Set();
const calls = [];
const lower = (pid, priority) => {
  if (pid === 66) throw new Error('access denied');
  calls.push([pid, priority]);
};
const raised = {
  pid: 13,
  ppid: 12,
  priority: 8,
  cpuSeconds: 0,
  started: 7_000,
};
assert.deepEqual(
  holdDown([raised], 10, lowered, lower),
  [],
  'A process the gate could lower was reported instead of lowered.',
);
assert.deepEqual(
  calls,
  [[13, 10]],
  'The raised process was not lowered to the gate priority.',
);
assert.equal(
  holdDown([raised], 10, lowered, lower).length,
  1,
  'A process found above the gate again after it was lowered was not reported.',
);
assert.equal(
  holdDown([{ ...raised, started: 8_000 }], 10, lowered, lower).length,
  0,
  'A new process given a lowered process id was reported as the old one raising itself again.',
);
assert.match(
  holdDown([{ ...raised, pid: 66 }], 10, lowered, lower)[0] ?? '',
  /could not be lowered: access denied/u,
  'A process the gate could not lower was not reported.',
);

assert.ok(
  heldForMemory > 0,
  'Nothing was ready while memory was under the floor, so the floor was never tested.',
);

process.stdout.write(
  `verify:gate-limits:self-test GREEN: ${planted.length} planted stages ran within ${BUDGET} processors, alone where exclusive, held ${heldForMemory} times for memory, peak ${scheduler.peakProcessors}.\n`,
);
