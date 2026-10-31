# Runs one heavy command inside the cap's job object, and never touches a process that already exists.
#
# There is one job, named ThothCap, and the name is the lock: a launcher creates it, and a launcher
# that finds it already there refuses to start (or waits, with -WaitSeconds), naming what is in it.
# So at most one capped command runs at a time, and the job's limits are the total for all heavy
# work. A launcher started by something already inside the job runs its command there.
#
# The command is created suspended, put in the job, and only then resumed, so it is in the job from
# its first instruction and everything it starts is born in the job. Kill-on-job-close is not set.
# The limits are set and read back before the command is created, and it is not created if they
# differ. Each mode's limits are in cap-common.ps1; cap-mode.ps1 switches a running job by its
# name. The command's environment carries THOTH_CAP_JOB, the job's name, and THOTH_VERIFY_PROCESSORS
# for night (every logical processor) and efficiency (the efficiency cores). A command that manages
# its own priorities (the gate) is handed the cap's priority-level.txt as THOTH_VERIFY_PRIORITY_FILE
# unless the caller named another.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File cap-run.ps1 [-Priority BelowNormal|Normal]
#       [-WaitSeconds n] [-Log file] [-Status file] [-ManagesPriority] -Command "<command line>"
#   powershell.exe ... -File cap-run.ps1 -Query [-Pids 1,2,3]     (read only, from anywhere)
#   powershell.exe ... -File cap-run.ps1 -Inside                  (read only, from under the command)
#   powershell.exe ... -File cap-run.ps1 -Running [-Names a,b]    (read only: which jobs exist)
#   powershell.exe ... -File cap-run.ps1 -Policy                  (read only: each mode's limits here)
#   powershell.exe ... -File cap-run.ps1 -Request <file>          (as cap-start.ps1 starts it)
#
# -Request reads the command, its options, the directory and the carried variables from the file
# cap-start.ps1 wrote, because a process Win32_Process.Create starts inherits neither; the
# variables are set over the user's default environment the process starts with. The launcher's
# own lines then go to <log>.launcher.out and <log>.launcher.err, since such a process has no
# standard handles anyone reads.
#
# -Log sends the command's output to a file; -Status writes how it ended (exit code, times, what the
# job counted) to a file. -ManagesPriority says the command sets its own processes' priorities (the
# gate), so a mode switch leaves them to it.
#
# Exit codes of the launcher itself: 124 refused (a capped command is running), 125 not started,
# which includes a mode file that cannot be read or names no mode (cap-common.ps1): the refusal
# names the file and the command that sets it. While the command runs the launcher looks at the
# mode file and logs once when it stops naming a mode, and once when it names one again, to its own
# error output (the command holds the log open) and into the status as modeNotes; the limits in
# force never change for it. The status records the cap's folder beside the mode.
#
# Use Windows PowerShell 5.1 (System32\WindowsPowerShell\v1.0\powershell.exe), which compiles C# 5.
param(
  [string]$Command = '',
  [ValidateSet('BelowNormal', 'Normal')][string]$Priority = 'BelowNormal',
  [int]$WaitSeconds = 0,
  [string]$Log = '',
  [string]$Status = '',
  [switch]$ManagesPriority,
  [switch]$Query,
  [switch]$Inside,
  [switch]$Running,
  [string]$Names = '',
  [switch]$Policy,
  [string]$Pids = '',
  [string]$Request = ''
)
if ($Request) {
  $asked = [IO.File]::ReadAllText($Request) | ConvertFrom-Json
  foreach ($entry in $asked.environment.PSObject.Properties) { [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value, 'Process') }
  Set-Location -LiteralPath $asked.directory
  [Environment]::CurrentDirectory = $asked.directory
  $Command = [string]$asked.command; $Priority = [string]$asked.priority; $WaitSeconds = [int]$asked.waitSeconds
  $Log = [string]$asked.log; $Status = [string]$asked.status; $ManagesPriority = [switch][bool]$asked.managesPriority
  $out = New-Object IO.StreamWriter("$Log.launcher.out", $true); $out.AutoFlush = $true; [Console]::SetOut($out)
  $err = New-Object IO.StreamWriter("$Log.launcher.err", $true); $err.AutoFlush = $true; [Console]::SetError($err)
}
# Nobody reads a launcher started from a request but its files, so a failure is written there.
trap { if ($Request) { [Console]::Error.WriteLine("[cap] LAUNCHER FAILED: $_ $($_.InvocationInfo.PositionMessage)"); exit 125 } else { break } }
. (Join-Path $PSScriptRoot 'cap-common.ps1')

if ($Inside) {
  $job = $env:THOTH_CAP_JOB
  if (-not $job) { "pid ${PID}: THOTH_CAP_JOB is not set; this process was not started under the cap"; exit 3 }
  [ThothCap]::Describe($job, @(0))
  if (-not [ThothCap]::SelfIn($job)) { exit 3 }
  exit 0
}
if ($Query) {
  $list = @($Pids -split ',' | Where-Object { $_ } | ForEach-Object { [int]$_ })
  [ThothCap]::Describe($CapJobName, [int[]]$list)
  exit 0
}
if ($Running) {
  $asked = @($Names -split ',' | Where-Object { $_ })
  if ($asked.Count -eq 0) { $asked = @($CapJobName) }
  $found = @($asked | Where-Object { [ThothCap]::Exists($_) })
  $found | ForEach-Object { $_ }
  if ($found.Count -gt 0) { exit 0 } else { exit 1 }
}
if ($Policy) {
  $physical = Get-CapPhysical
  $efficiency = $null
  try { $efficiency = Get-CapEfficiencyMask } catch { }
  $modes = [ordered]@{}
  foreach ($mode in 'day', 'night', 'efficiency') {
    if ($mode -eq 'efficiency' -and -not $efficiency) { $modes[$mode] = 'no efficiency mask could be read'; continue }
    $t = Get-CapTarget $mode
    $modes[$mode] = [ordered]@{ cpuRate = $t.Rate; jobMemoryBytes = $t.Memory; affinity = ('0x{0:X}' -f $t.Affinity); processors = $t.Processors; priority = $(if ($t.Normal) { 'normal' } else { 'below normal, or the level the caller names' }) }
  }
  [ordered]@{
    job = $CapJobName; directory = $CapDirectory; mode = (Get-CapMode); modeProblem = $(Get-CapModeProblem); physicalBytes = $physical
    logicalProcessors = [Environment]::ProcessorCount; efficiency = $(if ($efficiency) { $efficiency.Description } else { $null }); modes = $modes
  } | ConvertTo-Json -Depth 4
  exit 0
}
if ($Command -eq '') { throw 'Pass -Command, -Query, -Inside, -Running or -Policy.' }

$shell = if ($env:ComSpec) { $env:ComSpec } else { Join-Path $env:SystemRoot 'System32\cmd.exe' }
if ($env:THOTH_CAP_JOB -and [ThothCap]::SelfIn($env:THOTH_CAP_JOB)) {
  # Already capped by an outer launcher: it is in the one job, and its limits are the total.
  [Console]::Error.WriteLine("[cap] already inside $($env:THOTH_CAP_JOB); running the command there")
  & $shell /d /s /c $Command
  exit $LASTEXITCODE
}

$startedAt = Get-Date
function Note([string]$text) {
  [Console]::Error.WriteLine("[cap] $text")
  if ($Log) { [IO.File]::AppendAllText($Log, "[cap] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $text`r`n") }
}
function Record($fields) {
  if (-not $Status) { return }
  $base = [ordered]@{ command = $Command; launcherPid = $PID; started = $startedAt.ToString('o'); ended = (Get-Date).ToString('o'); directory = $CapDirectory }
  foreach ($key in $fields.Keys) { $base[$key] = $fields[$key] }
  [IO.File]::WriteAllText($Status, ($base | ConvertTo-Json -Depth 4))
}

# A mode file that names no mode starts nothing, and is read before the job is taken.
$problem = Get-CapModeProblem
if ($problem) { Note "NOT STARTED: $problem"; Record @{ outcome = 'not started'; reason = $problem }; exit 125 }

# The name is the lock. A job that exists has a capped command in it, or a launcher about to start one.
$job = [IntPtr]::Zero
$deadline = $startedAt.AddSeconds($WaitSeconds)
while ($true) {
  $existed = $false; $failure = ''
  $job = [ThothCap]::CreateExclusive($CapJobName, [ref]$existed, [ref]$failure)
  if ($job -eq [IntPtr]::Zero) { Note "NOT STARTED: $failure"; Record @{ outcome = 'not started'; reason = $failure }; exit 125 }
  if (-not $existed) { break }
  $inIt = [ThothCap]::Pids($job)
  [void][ThothCap]::CloseHandle($job)
  $holder = Read-CapState
  $who = if ($holder) { "`"$($holder.command)`" (launcher $($holder.launcherPid), command pid $($holder.commandPid), started $($holder.started))" } else { 'a command whose launcher left no record' }
  if ((Get-Date) -ge $deadline) {
    Note "REFUSED: a capped command is already running: $who; processes in $CapJobName now: $($inIt -join ' '). One at a time, because the job's limits are the total for all heavy work."
    Record @{ outcome = 'refused'; reason = "held by $who"; pidsInJob = $inIt }
    exit 124
  }
  [Console]::Error.WriteLine("[cap] waiting for $who; $([int]($deadline - (Get-Date)).TotalSeconds)s left")
  Start-Sleep -Seconds 10
}

$mode = Get-CapMode
# Read again now the job is held, so a file that went bad while this waited starts nothing either.
if (-not [ThothCap]::IsMode($mode)) {
  $problem = Get-CapModeProblem
  [void][ThothCap]::CloseHandle($job)
  Note "NOT STARTED: $problem"; Record @{ outcome = 'not started'; reason = $problem }; exit 125
}
$target = Get-CapTarget $mode
$memory = $target.Memory
# The job is empty here, so the mode's own limits are set as they are.
$difference = [ThothCap]::SetLimits($job, [uint32]$target.Rate, $memory, $target.Affinity)
if ($difference -ne '') { Note "NOT STARTED: $difference"; Record @{ outcome = 'not started'; reason = $difference }; exit 125 }
[ThothCap]::WriteWhole($CapLevelFile, (Get-CapLevel $mode))

$env:THOTH_CAP_JOB = $CapJobName
# Work that sizes itself by the machine (the gate's processor budget, a mutation run's runners)
# reads this; day leaves it to the work's own default of two thirds.
if ($target.Processors -gt 0) { $env:THOTH_VERIFY_PROCESSORS = [string]$target.Processors } else { Remove-Item Env:THOTH_VERIFY_PROCESSORS -ErrorAction SilentlyContinue }
if ($ManagesPriority -and -not $env:THOTH_VERIFY_PRIORITY_FILE) { $env:THOTH_VERIFY_PRIORITY_FILE = $CapLevelFile }
$inner = if ($Log) { "( $Command ) >> `"$Log`" 2>&1" } else { $Command }
$line = "`"$shell`" /d /s /c `"$inner`""
# Night runs what it starts at normal priority; day and efficiency at the level the caller named.
$level = if ($target.Normal) { 'Normal' } else { $Priority }
$flag = if ($level -eq 'Normal') { 0x20 } else { 0x4000 }
Note "$([ThothCap]::Limits($job, $CapJobName)); set and read back in $mode mode before the command exists"
$process = [IntPtr]::Zero; $failure = ''
$commandPid = [ThothCap]::Start($job, $line, [uint32]$flag, [ref]$process, [ref]$failure)
if ($commandPid -eq 0) { Note "NOT STARTED: $failure"; Record @{ outcome = 'not started'; reason = $failure }; exit 125 }
[Console]::Error.WriteLine("[cap] command pid $commandPid in $CapJobName before its first instruction, at $level priority (day level $Priority)")
Write-CapState ([ordered]@{
  command = $Command; launcherPid = $PID; commandPid = $commandPid; started = $startedAt.ToString('o')
  dayPriority = $Priority; managesPriority = [bool]$ManagesPriority; log = $Log; status = $Status; raised = @()
})

# The mode file is looked at while the command runs, and a change of meaning logged once
# (ThothCap.ModeNote). Nothing here changes the job's limits. Not to the log, which the command's
# own output holds open while it runs.
$seen = $mode
$modeNotes = @()
while (-not [ThothCap]::Ended($process, 5000)) {
  $now = Get-CapMode
  $note = [ThothCap]::ModeNote($seen, $now, $CapModeFile)
  if ($note) {
    [Console]::Error.WriteLine("[cap] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $note")
    $modeNotes += "$(Get-Date -Format 'o') $note"
  }
  if ($now -ne $seen -and ([ThothCap]::IsMode($now) -ne [ThothCap]::IsMode($seen))) { $seen = $now }
}
$code = [ThothCap]::Wait($process)
$endedAt = Get-Date
[uint64]$peak = 0; [uint32]$total = 0; [uint32]$terminated = 0; [uint32]$active = 0
$unread = [ThothCap]::Final($job, [ref]$peak, [ref]$total, [ref]$terminated, [ref]$active)
$left = [ThothCap]::Pids($job)
$summary = "command pid $commandPid ended with exit code $code (0x$('{0:X8}' -f $code)) after $([int]($endedAt - $startedAt).TotalSeconds)s; job: peak memory $peak bytes against a limit at the start of $memory, $total processes over its life, $terminated ended by a job limit, $active still in it$(if ($left.Count) { ': ' + ($left -join ' ') }); mode at the end: $(Get-CapMode)"
Note $summary
Record ([ordered]@{
  outcome = 'ended'; commandPid = $commandPid; exitCode = [int64]$code; exitCodeHex = ('0x{0:X8}' -f $code)
  seconds = [int]($endedAt - $startedAt).TotalSeconds; modeAtStart = $mode; modeAtEnd = (Get-CapMode)
  peakJobMemoryBytes = $peak; memoryLimitAtStartBytes = $memory; processesOverLife = $total
  processesEndedByJobLimit = $terminated; processesLeftInJob = $left; accountingUnread = $unread
  modeNotes = $modeNotes
})
$mine = Read-CapState
if ($mine -and $mine.launcherPid -eq $PID) { Remove-Item -LiteralPath $CapStateFile -Force }
[void][ThothCap]::CloseHandle($job)
exit [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$code), 0)
