/**
 * The processes under one process, with each one's priority and the CPU time it has used.
 *
 * The gate lowers its own priority and relies on every process it starts inheriting it, which
 * Windows does for a parent at below-normal or idle priority when the child is created without a
 * priority class of its own (`CreateProcess`, `dwCreationFlags`), and which Linux does for a nice
 * value across `fork` and `execve` (`setpriority(2)`). A child can still set its own, so the gate
 * reads the whole tree while it runs rather than trusting the rule: a process above the gate's priority is a
 * finding, and so is a stretch of time in which the tree used more processors than its budget.
 *
 * One reading is a list; the rate comes from two. A process that starts and ends between two
 * readings is not seen at all, so the processors a window reports are a floor, never an
 * overestimate.
 */
import { execFile } from 'node:child_process';

/** Runs a reader and answers its output with its own process id, so a caller can leave it out. */
const runFile = (file, args) =>
  new Promise((settle, reject) => {
    const child = execFile(
      file,
      args,
      { maxBuffer: 1 << 26, windowsHide: true, timeout: 60_000 },
      (error, stdout) =>
        error ? reject(error) : settle({ stdout, reader: child.pid }),
    );
  });

/** `[[dd-]hh:]mm:ss`, as `ps` prints `time`, in seconds. */
export const psSeconds = (text) => {
  const [days, clock] = text.includes('-') ? text.split('-') : ['0', text];
  return (
    clock
      .split(':')
      .map(Number)
      .reduce((total, part) => total * 60 + part, 0) +
    Number(days) * 86_400
  );
};

/**
 * Every process on the machine, `{ pid, ppid, priority, cpuSeconds, started? }`, and the process id
 * of the reader that listed them. `started` is the start time in milliseconds, read on Windows only,
 * where a parent process id can name a process that is not the parent (see `descendantsOf`).
 */
export async function readProcesses() {
  if (process.platform === 'win32') {
    const { stdout: csv, reader } = await runFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { $started = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null }; "$($_.ProcessId),$($_.ParentProcessId),$($_.Priority),$($_.KernelModeTime),$($_.UserModeTime),$started" }',
    ]);
    const processes = csv
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [pid, ppid, priority, kernel, user, started] = line.split(',');
        return {
          pid: Number(pid),
          ppid: Number(ppid),
          priority: Number(priority),
          // Kernel and user time are reported in 100-nanosecond units.
          cpuSeconds: (Number(kernel) + Number(user)) / 1e7,
          ...(started === '' ? {} : { started: Number(started) }),
        };
      });
    return { processes, reader };
  }
  const { stdout: text, reader } = await runFile('ps', [
    '-A',
    '-o',
    'pid=,ppid=,nice=,time=',
  ]);
  const processes = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [pid, ppid, nice, time] = line.trim().split(/\s+/u);
      // A nice value runs the other way to a priority, so it is negated to compare the same way.
      return {
        pid: Number(pid),
        ppid: Number(ppid),
        priority: -Number(nice),
        cpuSeconds: psSeconds(time),
      };
    });
  return { processes, reader };
}

/**
 * The descendants of `root` in a reading, not counting `root` itself or anything in `exclude`.
 *
 * Windows keeps a process's parent id after the parent exits, and a later process can be given
 * that id, so a process can name one that started after it as its parent (`Win32_Process`,
 * `ParentProcessId`). A child that started before the process it names is not that process's child,
 * and is left out. Without that, a system process whose boot-time parent id was reused by a gate
 * process is read as running under the gate. POSIX gives an orphan a system process as its parent
 * (`_exit`), so a reading without start times cannot name a parent that is not one.
 */
export function descendantsOf(processes, root, exclude = new Set()) {
  const children = new Map();
  for (const entry of processes) {
    if (!children.has(entry.ppid)) children.set(entry.ppid, []);
    children.get(entry.ppid).push(entry);
  }
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const childrenOf = (parent) =>
    (children.get(parent) ?? []).filter(
      (child) =>
        byPid.get(parent)?.started === undefined ||
        child.started === undefined ||
        child.started >= byPid.get(parent).started,
    );
  const found = [];
  const queue = [...childrenOf(root)];
  const seen = new Set([root]);
  while (queue.length > 0) {
    const entry = queue.shift();
    if (seen.has(entry.pid)) continue;
    seen.add(entry.pid);
    if (exclude.has(entry.pid)) continue;
    found.push(entry);
    queue.push(...childrenOf(entry.pid));
  }
  return found;
}

/**
 * The processors a tree used between two readings of it.
 *
 * A process in both readings contributes the CPU time it used in between. A process only in the
 * later one started inside the window, so all of its time falls in it.
 */
export function processorsBetween(earlier, later, seconds) {
  const before = new Map(earlier.map((entry) => [entry.pid, entry.cpuSeconds]));
  let used = 0;
  for (const entry of later) {
    used += Math.max(0, entry.cpuSeconds - (before.get(entry.pid) ?? 0));
  }
  return used / seconds;
}

/**
 * Lowers each process in `above` to `priority`, and answers what that could not hold down.
 *
 * A browser engine sets the priority class of some of its own processes above the one they
 * inherited: under a below-normal parent, Chromium starts one child at 10 and Firefox six at 8,
 * where WebKit keeps the inherited 6. A job object can hold a priority class over every process in
 * it, but only for a caller with a privilege an ordinary account does not have
 * (`JOBOBJECT_BASIC_LIMIT_INFORMATION`, `PriorityClass`), so each one is lowered when a reading
 * finds it. A process that cannot be lowered, or that is found above again after it was, is not
 * held by that, and is a finding. `lowered` carries what was lowered from one reading to the next,
 * keyed by start time as well as id, since an id can be given to a new process.
 */
export function holdDown(above, priority, lowered, set) {
  const findings = [];
  for (const entry of above) {
    const key = `${entry.pid}@${entry.started ?? ''}`;
    if (lowered.has(key)) {
      findings.push(
        `process ${entry.pid} under the gate is at priority ${entry.priority} again after the gate lowered it`,
      );
      continue;
    }
    try {
      set(entry.pid, priority);
      lowered.add(key);
    } catch (error) {
      findings.push(
        `process ${entry.pid} under the gate runs at priority ${entry.priority}, above the gate's, and could not be lowered: ${error.message}`,
      );
    }
  }
  return findings;
}

/**
 * The processes under `root` that run above it, compared in the reading's own units: a Windows base
 * priority, or a negated nice value. Empty when `root` is not in the reading, which the caller
 * treats as a failed reading rather than a clean one.
 */
export function aboveRoot(processes, root, exclude = new Set()) {
  const own = processes.find(({ pid }) => pid === root);
  if (own === undefined) return undefined;
  return descendantsOf(processes, root, exclude).filter(
    (entry) => entry.priority > own.priority,
  );
}
