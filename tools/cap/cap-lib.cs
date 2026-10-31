// The Windows calls behind the cap's scripts, and the policy each mode's limits come from. C# 5,
// because Windows PowerShell 5.1 compiles it.
//
// One job object, named, holds every capped command. Only a process the launcher has just created,
// still suspended, is ever assigned to it; no call here touches a process that was already running
// except to read or set the priority class of a process that is in the job, and to read its
// affinity and private bytes. A job's affinity, set on the job, reaches the processes in it.
//
// The policy functions take the machine's readings as arguments and read nothing themselves, so
// `tools/verify-cap-self-test.ts` can hand them planted machines.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class ThothCap {
  // ---- The policy ----

  /** A job's processor rate is in hundredths of a percent of the whole machine. */
  public const uint FullRate = 10000;

  /** Windows holds a job memory limit in whole pages. */
  public const ulong PageBytes = 4096;

  /** Day mode's hard processor cap: two thirds of the machine, 6667. */
  public static uint DayRate() { return (uint)Math.Round(FullRate * 2.0 / 3.0); }

  /** Whole pages of a byte count, down unless asked for up, so a limit set reads back exactly. */
  public static ulong Pages(double bytes, bool up) {
    double pages = up ? Math.Ceiling(bytes / PageBytes) : Math.Floor(bytes / PageBytes);
    return (ulong)pages * PageBytes;
  }

  /** Day mode's job memory limit: two thirds of the memory Windows reports, in whole pages. */
  public static ulong DayMemory(ulong physical) { return Pages(physical * 2.0 / 3.0, false); }

  /** Efficiency mode's job memory limit: half of the memory Windows reports, in whole pages. */
  public static ulong EfficiencyMemory(ulong physical) { return Pages(physical / 2.0, false); }

  /** What a held memory limit keeps above what the job holds: a thirty-second of memory. */
  public static ulong Margin(ulong physical) { return Pages(physical / 32.0, true); }

  /** Whether a word is one of the three modes. */
  public static bool IsMode(string word) { return word == "day" || word == "night" || word == "efficiency"; }

  /**
   * What the mode file says: day when there is no file, its word when the word (trimmed, in any
   * case) is a mode, "unreadable" when the file is there and cannot be read, and "unknown" for any
   * other text, an empty file included. Day is the default only for a file that is not there, so a
   * file gone bad is never read as a mode nobody chose.
   */
  public static string MeaningOf(bool exists, bool readable, string text) {
    if (!exists) return "day";
    if (!readable) return "unreadable";
    string word = text == null ? "" : text.Trim().ToLowerInvariant();
    return IsMode(word) ? word : "unknown";
  }

  /**
   * What a stepper of `mode` does when the mode file says `meaning`: steps on while it is its own
   * mode, ends when it is another mode, and holds the limit as it is while the file names none.
   */
  public static string StepperAction(string mode, string meaning) {
    if (meaning == mode) return "step";
    return IsMode(meaning) ? "end" : "hold";
  }

  /**
   * The line a running command's launcher logs when its mode file changes meaning: once when it
   * stops naming a mode, once when it names one again, and nothing otherwise. The limits in force
   * never change for it: only `node tools/cap.ts mode` switches a running job.
   */
  public static string ModeNote(string before, string now, string file) {
    bool wasMode = IsMode(before), isMode = IsMode(now);
    if (wasMode && !isMode) return "the mode file " + file + " is now " + now + "; the limits in force are kept. Set the mode with node tools/cap.ts mode day|night|efficiency";
    if (!wasMode && isMode) return "the mode file " + file + " reads " + now + " again; the limits in force are kept until node tools/cap.ts mode switches them";
    return "";
  }

  /** Whether the launcher carries a variable of the caller's: THOTH_* and PATH, and no other. */
  public static bool Carried(string name) {
    if (name == null) return false;
    return name.StartsWith("THOTH_", StringComparison.OrdinalIgnoreCase)
      || String.Equals(name, "PATH", StringComparison.OrdinalIgnoreCase);
  }

  /**
   * The efficiency processors as a mask over group 0, from each logical processor's index, core and
   * efficiency class. A higher class is faster, so the efficiency cores are those of the lowest
   * class. Where every processor is of one class, it is half of them: one logical processor of each
   * core that has two, else the first half by index.
   */
  public static ulong EfficiencyMaskOf(int[] index, int[] core, int[] cls, out int count, out string description) {
    int lowest = 255, highest = 0;
    foreach (int c in cls) { lowest = Math.Min(lowest, c); highest = Math.Max(highest, c); }
    ulong mask = 0; count = 0;
    if (index.Length == 0) { description = "no logical processor was read"; return 0; }
    if (lowest != highest) {
      for (int i = 0; i < index.Length; i++) if (cls[i] == lowest) { mask |= 1UL << index[i]; count++; }
      description = String.Format("{0} of {1} logical processors of efficiency class {2} (classes {2} to {3})", count, index.Length, lowest, highest);
      return mask;
    }
    var seen = new HashSet<int>();
    for (int i = 0; i < index.Length; i++) if (seen.Add(core[i])) { mask |= 1UL << index[i]; count++; }
    if (count * 2 != index.Length) {
      var sorted = (int[])index.Clone();
      Array.Sort(sorted);
      mask = 0; count = index.Length / 2;
      for (int i = 0; i < count; i++) mask |= 1UL << sorted[i];
    }
    description = String.Format("{0} of {1} logical processors, all of efficiency class {2}, so half", count, index.Length, lowest);
    return mask;
  }

  /** A mode's limits: rate (0 none), memory (0 none), affinity (0 every processor), and the
   * processor count work started in it sizes itself by (0 leaves it to the work's own default). */
  public struct Target { public string Mode; public uint Rate; public ulong Memory; public ulong Affinity; public int Processors; public bool Normal; }

  public static Target TargetOf(string mode, ulong physical, int logicalProcessors, ulong efficiencyMask) {
    if (!IsMode(mode)) throw new ArgumentException("No limits are taken from the mode " + mode + ".");
    Target t = new Target();
    t.Mode = mode;
    if (t.Mode == "night") { t.Processors = logicalProcessors; t.Normal = true; }
    else if (t.Mode == "efficiency") { t.Memory = EfficiencyMemory(physical); t.Affinity = efficiencyMask; t.Processors = BitCount(efficiencyMask); }
    else { t.Rate = DayRate(); t.Memory = DayMemory(physical); }
    return t;
  }

  // ---- The machine ----

  [StructLayout(LayoutKind.Sequential)] public struct CpuRate { public uint ControlFlags; public uint Rate; }
  [StructLayout(LayoutKind.Sequential)] public struct ExtendedLimit {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
    public ulong Io0, Io1, Io2, Io3, Io4, Io5;
    public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)] public struct Accounting {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct StartupInfo {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
    public IntPtr hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] public struct ProcessInformation { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref CpuRate info, int length);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, int length);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out CpuRate info, int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out ExtendedLimit info, int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out Accounting info, int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr buffer, int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation information);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetSystemCpuSetInformation(IntPtr information, uint length, out uint returned, IntPtr process, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessAffinityMask(IntPtr process, out UIntPtr processMask, out UIntPtr systemMask);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetPriorityClass(IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetPriorityClass(IntPtr process, uint priorityClass);

  static string Fail(string what) { return what + ": error " + Marshal.GetLastWin32Error(); }

  public static string PriorityName(uint priorityClass) {
    switch (priorityClass) {
      case 0x40: return "idle";
      case 0x4000: return "below-normal";
      case 0x20: return "normal";
      case 0x8000: return "above-normal";
      case 0x80: return "high";
      case 0x100: return "realtime";
      default: return "unread";
    }
  }

  /**
   * This machine's efficiency processors (`EfficiencyMaskOf`), read from the EfficiencyClass Windows
   * reports for each CPU set (winnt.h SYSTEM_CPU_SET_INFORMATION: 32 bytes, Type at byte 4,
   * Group at 12, LogicalProcessorIndex at 14, CoreIndex at 15, EfficiencyClass at 18). Group 0 only.
   */
  public static ulong EfficiencyMask(out int count, out string description) {
    count = 0;
    uint length;
    GetSystemCpuSetInformation(IntPtr.Zero, 0, out length, IntPtr.Zero, 0);
    IntPtr buffer = Marshal.AllocHGlobal((int)length);
    try {
      if (!GetSystemCpuSetInformation(buffer, length, out length, IntPtr.Zero, 0)) { description = Fail("GetSystemCpuSetInformation"); return 0; }
      var index = new List<int>(); var core = new List<int>(); var cls = new List<int>();
      for (int at = 0; at < (int)length; ) {
        int size = Marshal.ReadInt32(buffer, at);
        if (Marshal.ReadInt16(buffer, at + 12) == 0) {
          index.Add(Marshal.ReadByte(buffer, at + 14)); core.Add(Marshal.ReadByte(buffer, at + 15)); cls.Add(Marshal.ReadByte(buffer, at + 18));
        }
        at += size;
      }
      return EfficiencyMaskOf(index.ToArray(), core.ToArray(), cls.ToArray(), out count, out description);
    } finally { Marshal.FreeHGlobal(buffer); }
  }

  public static int BitCount(ulong mask) { int n = 0; while (mask != 0) { n += (int)(mask & 1); mask >>= 1; } return n; }

  /** A process's affinity mask as Windows holds it, or 0 when it cannot be read. */
  public static ulong ProcessAffinity(int pid) {
    IntPtr p = OpenProcess(0x1000, false, pid);
    if (p == IntPtr.Zero) return 0;
    UIntPtr process, system;
    bool read = GetProcessAffinityMask(p, out process, out system);
    CloseHandle(p);
    return read ? process.ToUInt64() : 0;
  }

  /**
   * Sets or clears (mask 0) the job's affinity and keeps every other limit it holds, then reads it
   * back. Windows applies a job's affinity to the processes already in it. "" when it holds.
   */
  public static string SetAffinity(IntPtr job, ulong mask) {
    ExtendedLimit ext;
    if (!QueryInformationJobObject(job, 9, out ext, Marshal.SizeOf(typeof(ExtendedLimit)), IntPtr.Zero)) return Fail("read limits");
    if (mask == 0) { ext.LimitFlags &= ~0x10u; ext.Affinity = UIntPtr.Zero; } else { ext.LimitFlags |= 0x10u; ext.Affinity = (UIntPtr)mask; }
    if (!SetInformationJobObject(job, 9, ref ext, Marshal.SizeOf(typeof(ExtendedLimit)))) return Fail("set affinity");
    ExtendedLimit read;
    if (!QueryInformationJobObject(job, 9, out read, Marshal.SizeOf(typeof(ExtendedLimit)), IntPtr.Zero)) return Fail("read limits");
    bool right = mask == 0 ? (read.LimitFlags & 0x10) == 0 : (read.LimitFlags & 0x10) != 0 && read.Affinity.ToUInt64() == mask;
    return right ? "" : String.Format("affinity read back: flags 0x{0:X} mask 0x{1:X}", read.LimitFlags, read.Affinity.ToUInt64());
  }

  /** The job by name, for reading (0x4) or for reading and setting its limits (0x6). Zero when there is none. */
  public static IntPtr Open(string name, bool toSet) {
    return OpenJobObjectW(toSet ? 0x0006u : 0x0004u, false, name);
  }

  /** Whether a job of that name exists in this session. Opens it for query and closes it again. */
  public static bool Exists(string name) {
    IntPtr job = Open(name, false);
    if (job == IntPtr.Zero) return false;
    CloseHandle(job);
    return true;
  }

  /**
   * Creates the named job, or reports that it exists. The name is the lock: Windows keeps a job
   * for as long as a process is in it or a handle to it is open, and creates a name only once.
   */
  public static IntPtr CreateExclusive(string name, out bool existed, out string error) {
    error = "";
    IntPtr job = CreateJobObjectW(IntPtr.Zero, name);
    int code = Marshal.GetLastWin32Error();
    existed = job != IntPtr.Zero && code == 183;
    if (job == IntPtr.Zero) error = "CreateJobObject: error " + code;
    return job;
  }

  public static int[] Pids(IntPtr job) {
    int size = 8 + 8 * 4096;
    IntPtr buffer = Marshal.AllocHGlobal(size);
    try {
      if (!QueryInformationJobObject(job, 3, buffer, size, IntPtr.Zero)) return new int[0];
      int count = Marshal.ReadInt32(buffer, 4);
      int[] pids = new int[count];
      for (int i = 0; i < count; i++) pids[i] = (int)Marshal.ReadInt64(buffer, 8 + 8 * i);
      return pids;
    } finally { Marshal.FreeHGlobal(buffer); }
  }

  /** The limits as Windows holds them, in one line. */
  public static string Limits(IntPtr job, string name) {
    CpuRate cpu; ExtendedLimit ext; Accounting acc;
    if (!QueryInformationJobObject(job, 15, out cpu, Marshal.SizeOf(typeof(CpuRate)), IntPtr.Zero)) return Fail("query cpu rate");
    if (!QueryInformationJobObject(job, 9, out ext, Marshal.SizeOf(typeof(ExtendedLimit)), IntPtr.Zero)) return Fail("query limits");
    QueryInformationJobObject(job, 1, out acc, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero);
    bool rate = (cpu.ControlFlags & 1) != 0;
    bool memory = (ext.LimitFlags & 0x200) != 0;
    bool affinity = (ext.LimitFlags & 0x10) != 0;
    string reads = rate && memory && !affinity ? "DAY (capped)"
      : !rate && !memory && !affinity ? "NIGHT (whole machine, no memory limit)"
      : !rate && memory && affinity ? "EFFICIENCY (efficiency cores, memory limit)"
      : "MIXED";
    return String.Format("job {0}: cpu flags 0x{1:X} (enable={2} hardCap={3}) CpuRate={4}; limit flags 0x{5:X} (jobMemory={6} affinity={7} killOnJobClose={8}) JobMemoryLimit={9} bytes; Affinity=0x{10:X}; peak job memory {11} bytes; active processes {12}; reads as {13}",
      name, cpu.ControlFlags, rate, (cpu.ControlFlags & 4) != 0, cpu.Rate, ext.LimitFlags, memory, affinity, (ext.LimitFlags & 0x2000) != 0,
      memory ? ext.JobMemoryLimit.ToUInt64() : 0UL, affinity ? ext.Affinity.ToUInt64() : 0UL, ext.PeakJobMemoryUsed.ToUInt64(), acc.ActiveProcesses, reads);
  }

  /** The named job's limits, and whether each pid is in it with its priority class. Pid 0 is the caller. */
  public static string Describe(string name, int[] pids) {
    IntPtr job = Open(name, false);
    if (job == IntPtr.Zero) return "job " + name + " not opened: error " + Marshal.GetLastWin32Error();
    string text = Limits(job, name);
    foreach (int pid in pids) {
      IntPtr p = pid == 0 ? GetCurrentProcess() : OpenProcess(0x1000, false, pid);
      if (p == IntPtr.Zero) { text += "\n  pid " + pid + ": not opened, error " + Marshal.GetLastWin32Error(); continue; }
      bool mine;
      if (!IsProcessInJob(p, job, out mine)) text += "\n  pid " + pid + ": " + Fail("IsProcessInJob");
      else text += "\n  pid " + (pid == 0 ? System.Diagnostics.Process.GetCurrentProcess().Id : pid) + ": in " + name + " = " + mine + ", priority " + PriorityName(GetPriorityClass(p));
      if (pid != 0) CloseHandle(p);
    }
    CloseHandle(job);
    return text;
  }

  public static bool SelfIn(string name) {
    IntPtr job = Open(name, false);
    if (job == IntPtr.Zero) return false;
    bool mine; IsProcessInJob(GetCurrentProcess(), job, out mine);
    CloseHandle(job);
    return mine;
  }

  /**
   * Sets the job's three limits as a mode asks for them and reads them back: a hard processor cap
   * (rate 0 lifts it), a job memory limit (0 lifts it) and an affinity mask (0 lifts it). Returns ""
   * when what Windows holds is what was asked, the difference otherwise.
   */
  public static string SetLimits(IntPtr job, uint cpuRate, ulong memory, ulong affinity) {
    CpuRate cpu = new CpuRate();
    if (cpuRate != 0) { cpu.ControlFlags = 5; cpu.Rate = cpuRate; }
    // A job that never had rate control refuses to have it switched off (error 87), so an uncapped
    // job whose rate control is already off is left as it is.
    CpuRate cpuNow;
    bool alreadyOff = cpuRate == 0 && QueryInformationJobObject(job, 15, out cpuNow, Marshal.SizeOf(typeof(CpuRate)), IntPtr.Zero) && (cpuNow.ControlFlags & 1) == 0;
    if (!alreadyOff && !SetInformationJobObject(job, 15, ref cpu, Marshal.SizeOf(typeof(CpuRate)))) return Fail("set cpu rate");
    // Clearing a job's affinity leaves its processes on the processors they had, so a mode that
    // lifts it first gives the job every processor of the system, which Windows applies to them,
    // and only then clears it.
    ExtendedLimit now;
    if (affinity == 0 && QueryInformationJobObject(job, 9, out now, Marshal.SizeOf(typeof(ExtendedLimit)), IntPtr.Zero) && (now.LimitFlags & 0x10) != 0) {
      UIntPtr mine, system;
      if (!GetProcessAffinityMask(GetCurrentProcess(), out mine, out system)) return Fail("read the system's processors");
      string widened = SetAffinity(job, system.ToUInt64());
      if (widened != "") return widened;
    }
    ExtendedLimit ext = new ExtendedLimit();
    if (memory != 0) { ext.LimitFlags |= 0x200; ext.JobMemoryLimit = (UIntPtr)memory; }
    if (affinity != 0) { ext.LimitFlags |= 0x10; ext.Affinity = (UIntPtr)affinity; }
    if (!SetInformationJobObject(job, 9, ref ext, Marshal.SizeOf(typeof(ExtendedLimit)))) return Fail("set limits");
    return ReadBack(job, cpuRate, memory, affinity);
  }

  /** Sets the job memory limit alone, keeping the rest, and reads all three back. */
  public static string SetMemory(IntPtr job, ulong memory) {
    ExtendedLimit ext;
    if (!QueryInformationJobObject(job, 9, out ext, Marshal.SizeOf(typeof(ExtendedLimit)), IntPtr.Zero)) return Fail("read limits");
    ext.LimitFlags |= 0x200; ext.JobMemoryLimit = (UIntPtr)memory;
    if (!SetInformationJobObject(job, 9, ref ext, Marshal.SizeOf(typeof(ExtendedLimit)))) return Fail("set memory limit");
    CpuRate cpu;
    if (!QueryInformationJobObject(job, 15, out cpu, Marshal.SizeOf(typeof(CpuRate)), IntPtr.Zero)) return Fail("read cpu rate");
    return ReadBack(job, (cpu.ControlFlags & 1) != 0 ? cpu.Rate : 0, memory, (ext.LimitFlags & 0x10) != 0 ? ext.Affinity.ToUInt64() : 0);
  }

  /** The job memory limit Windows holds, or 0 when there is none. */
  public static ulong MemoryLimit(IntPtr job) {
    ExtendedLimit ext;
    if (!QueryInformationJobObject(job, 9, out ext, Marshal.SizeOf(typeof(ExtendedLimit)), IntPtr.Zero)) return 0;
    return (ext.LimitFlags & 0x200) != 0 ? ext.JobMemoryLimit.ToUInt64() : 0;
  }

  static string ReadBack(IntPtr job, uint cpuRate, ulong memory, ulong affinity) {
    CpuRate cpuRead; ExtendedLimit extRead;
    if (!QueryInformationJobObject(job, 15, out cpuRead, Marshal.SizeOf(typeof(CpuRate)), IntPtr.Zero)) return Fail("read cpu rate");
    if (!QueryInformationJobObject(job, 9, out extRead, Marshal.SizeOf(typeof(ExtendedLimit)), IntPtr.Zero)) return Fail("read limits");
    bool right = (cpuRate != 0 ? cpuRead.ControlFlags == 5 && cpuRead.Rate == cpuRate : (cpuRead.ControlFlags & 1) == 0)
      && (memory != 0 ? (extRead.LimitFlags & 0x200) != 0 && extRead.JobMemoryLimit.ToUInt64() == memory : (extRead.LimitFlags & 0x200) == 0)
      && (affinity != 0 ? (extRead.LimitFlags & 0x10) != 0 && extRead.Affinity.ToUInt64() == affinity : (extRead.LimitFlags & 0x10) == 0)
      && (extRead.LimitFlags & 0x2000) == 0;
    if (right) return "";
    return String.Format("the limits read back are not the limits set: cpu flags {0} rate {1} limit flags 0x{2:X} memory {3} affinity 0x{4:X}",
      cpuRead.ControlFlags, cpuRead.Rate, extRead.LimitFlags, extRead.JobMemoryLimit.ToUInt64(), extRead.Affinity.ToUInt64());
  }

  /**
   * Starts the command suspended, puts it in the job, checks it is there, and resumes it. A failure
   * before the resume ends the suspended process: it has run nothing. Returns the pid, or 0.
   */
  public static int Start(IntPtr job, string commandLine, uint priorityFlag, out IntPtr process, out string error) {
    error = ""; process = IntPtr.Zero;
    StartupInfo startup = new StartupInfo();
    startup.cb = Marshal.SizeOf(typeof(StartupInfo));
    startup.dwFlags = 0x100; // STARTF_USESTDHANDLES
    startup.hStdInput = GetStdHandle(-10); startup.hStdOutput = GetStdHandle(-11); startup.hStdError = GetStdHandle(-12);
    foreach (IntPtr h in new IntPtr[] { startup.hStdInput, startup.hStdOutput, startup.hStdError })
      if (h != IntPtr.Zero && h != new IntPtr(-1)) SetHandleInformation(h, 1, 1);
    ProcessInformation info;
    // CREATE_SUSPENDED, with the priority class the command is to have.
    if (!CreateProcessW(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, 0x4 | priorityFlag, IntPtr.Zero, null, ref startup, out info)) { error = Fail("CreateProcess"); return 0; }
    if (!AssignProcessToJobObject(job, info.hProcess)) {
      error = Fail("AssignProcessToJobObject");
      TerminateProcess(info.hProcess, 1);
      return 0;
    }
    bool inJob;
    if (!IsProcessInJob(info.hProcess, job, out inJob) || !inJob) {
      error = "the command was assigned and is not in the job";
      TerminateProcess(info.hProcess, 1);
      return 0;
    }
    ResumeThread(info.hThread);
    CloseHandle(info.hThread);
    process = info.hProcess;
    return info.dwProcessId;
  }

  /** Waits up to `milliseconds` for the process to end, and says whether it has. */
  public static bool Ended(IntPtr process, uint milliseconds) { return WaitForSingleObject(process, milliseconds) == 0; }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool MoveFileExW(string from, string to, uint flags);

  /**
   * Writes a small file whole: into a file beside it, then renamed over it (MOVEFILE_REPLACE_EXISTING
   * and MOVEFILE_WRITE_THROUGH), so a reader finds the old text or the new one, never a part.
   */
  public static void WriteWhole(string path, string text) {
    string beside = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
    File.WriteAllText(beside, text);
    if (!MoveFileExW(beside, path, 0x1 | 0x8)) {
      int error = Marshal.GetLastWin32Error();
      try { File.Delete(beside); } catch (IOException) { }
      throw new IOException("MoveFileEx onto " + path + ": error " + error);
    }
  }

  public static uint Wait(IntPtr process) {
    WaitForSingleObject(process, 0xFFFFFFFF);
    uint code; GetExitCodeProcess(process, out code);
    CloseHandle(process);
    return code;
  }

  /** What the job counted over its life: read when the command has ended, for the record of how it ended. */
  public static string Final(IntPtr job, out ulong peak, out uint total, out uint terminated, out uint active) {
    ExtendedLimit ext; Accounting acc;
    peak = 0; total = 0; terminated = 0; active = 0;
    if (!QueryInformationJobObject(job, 9, out ext, Marshal.SizeOf(typeof(ExtendedLimit)), IntPtr.Zero)) return Fail("query limits");
    if (!QueryInformationJobObject(job, 1, out acc, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) return Fail("query accounting");
    peak = ext.PeakJobMemoryUsed.ToUInt64(); total = acc.TotalProcesses; terminated = acc.TotalTerminatedProcesses; active = acc.ActiveProcesses;
    return "";
  }

  /** A process's priority class, 0 when it cannot be read. */
  public static uint Priority(int pid) {
    IntPtr p = pid == 0 ? GetCurrentProcess() : OpenProcess(0x1000, false, pid);
    if (p == IntPtr.Zero) return 0;
    uint value = GetPriorityClass(p);
    if (pid != 0) CloseHandle(p);
    return value;
  }

  /** Sets the priority class of a process that is in the job, and of no other. */
  public static string SetPriority(IntPtr job, int pid, uint priorityClass) {
    IntPtr p = OpenProcess(0x1200 /* SET_INFORMATION | QUERY_LIMITED_INFORMATION */, false, pid);
    if (p == IntPtr.Zero) return "not opened, error " + Marshal.GetLastWin32Error();
    try {
      bool mine;
      if (!IsProcessInJob(p, job, out mine) || !mine) return "not in the job, left alone";
      if (!SetPriorityClass(p, priorityClass)) return Fail("SetPriorityClass");
      return PriorityName(GetPriorityClass(p));
    } finally { CloseHandle(p); }
  }
}
