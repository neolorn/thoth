# Switches the cap between day, night and efficiency, on a running capped command as well as for
# the next one. Stops nothing. `node tools/cap.ts mode` is the way in. The mode is the machine
# owner's to choose; this script only carries out a choice.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File cap-mode.ps1 day|night|efficiency|show
#
# day:        the limits cap-common.ps1 gives day; every process this script raised at night
#             returns to the priority it had, and one born at night takes the command's day level.
# night:      no limit; every process in the job below normal priority is raised to normal, and
#             what it had is recorded.
# efficiency: the limits cap-common.ps1 gives efficiency; priorities as in day.
# show:       changes nothing; prints the mode, the job's limits as Windows holds them, and each
#             process in it with its priority and affinity.
#
# Lowering the memory limit never ends a process: where the job holds more than the new limit less
# a margin, the limit is set to what it holds plus the margin, and cap-stepper.ps1, started
# detached, steps it down as the job's use falls until it is the mode's own.
#
# A command started with -ManagesPriority (the gate) sets its own processes' priorities from the
# level file this script writes beside mode.txt, so its processes are left to it.
# Only processes that are in the job are touched: their priority class, and the job's affinity.
param([Parameter(Position = 0)][ValidateSet('day', 'night', 'efficiency', 'show')][string]$Mode = 'show')
. (Join-Path $PSScriptRoot 'cap-common.ps1')
$Mode = $Mode.ToLowerInvariant()

function Show-Job($job) {
  [ThothCap]::Limits($job, $CapJobName)
  "  job holds $(Get-CapUse $job) bytes now (private bytes of its processes)"
  foreach ($id in [ThothCap]::Pids($job)) {
    $name = try { (Get-Process -Id $id -ErrorAction Stop).ProcessName } catch { '?' }
    "  pid {0,6} {1,-22} {2,-13} affinity 0x{3:X}" -f $id, $name, [ThothCap]::PriorityName([ThothCap]::Priority($id)), [ThothCap]::ProcessAffinity($id)
  }
}

if ($Mode -eq 'show') {
  $problem = Get-CapModeProblem
  if ($problem) { "mode: $(Get-CapMode): $problem. Nothing starts until it is set." }
  else { "mode: $(Get-CapMode) (from $CapModeFile$(if (-not (Test-Path -LiteralPath $CapModeFile)) { ', which does not exist, so day' }))" }
  $job = [ThothCap]::Open($CapJobName, $false)
  if ($job -eq [IntPtr]::Zero) { "no capped command is running (no job $CapJobName)"; exit 0 }
  Show-Job $job
  [void][ThothCap]::CloseHandle($job)
  exit 0
}

# The files first, so a command started from this moment on starts in the new mode, and a stepper
# of another mode ends at its next look. Each is written whole, beside the file and renamed over it,
# so a reader never finds a part of one.
[ThothCap]::WriteWhole($CapModeFile, $Mode)
[ThothCap]::WriteWhole($CapLevelFile, (Get-CapLevel $Mode))
"mode now: $(Get-CapMode) ($CapModeFile)"
$job = [ThothCap]::Open($CapJobName, $true)
if ($job -eq [IntPtr]::Zero) { "no capped command is running (no job $CapJobName); the next one starts in $Mode mode"; exit 0 }

$target = Get-CapTarget $Mode
$memory = Get-CapSafeMemory $job $target.Memory
$difference = [ThothCap]::SetLimits($job, [uint32]$target.Rate, $memory, $target.Affinity)
if ($difference -ne '') { "LIMITS NOT SWITCHED: $difference"; Show-Job $job; exit 1 }
if ($memory -ne $target.Memory) {
  "MEMORY HELD: the job holds $(Get-CapUse $job) bytes, more than $Mode's limit of $($target.Memory) less the margin of $(Get-CapMargin); the limit is $memory and steps down to $($target.Memory) as its use falls"
  $running = $null
  try { $running = [IO.File]::ReadAllText($CapStepperFile) | ConvertFrom-Json } catch { }
  if ($running -and $running.mode -eq $Mode -and (Get-Process -Id $running.pid -ErrorAction SilentlyContinue)) {
    "  stepper pid $($running.pid) is already stepping it down"
  } else {
    $env:THOTH_CAP_DIRECTORY = $CapDirectory
    $stepper = Start-Process -FilePath $CapPowerShell -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $PSScriptRoot 'cap-stepper.ps1')`"", '-Mode', $Mode, '-Ceiling', $memory)
    "  stepper pid $($stepper.Id) started; it logs to $CapStepperLog"
  }
}

$state = Read-CapState
if (-not $state) { "  no record of the running command in $CapStateFile (a clean of tmp removes it): priorities raised now are not recorded, and day returns every normal process to below normal" }
$selfManaged = $state -and $state.managesPriority
$dayClass = if ($state -and $state.dayPriority -eq 'Normal') { 0x20 } else { 0x4000 }
$raised = @{}
if ($state -and $state.raised) { foreach ($entry in $state.raised) { $raised[[int]$entry.pid] = [uint32]$entry.priorityClass } }
if ($selfManaged) {
  "the command manages its own priorities and reads $CapLevelFile; its processes are left to it"
} elseif ($Mode -eq 'night') {
  foreach ($id in [ThothCap]::Pids($job)) {
    $had = [ThothCap]::Priority($id)
    if ($had -eq 0x4000 -or $had -eq 0x40) {
      $now = [ThothCap]::SetPriority($job, $id, 0x20)
      if ($now -eq 'normal') { if (-not $raised.ContainsKey($id)) { $raised[$id] = $had } } else { "  pid ${id}: not raised ($now)" }
    }
  }
} else {
  foreach ($id in [ThothCap]::Pids($job)) {
    $has = [ThothCap]::Priority($id)
    # Back to what it had; a process born at night, at normal, takes the command's day level.
    $want = if ($raised.ContainsKey($id)) { $raised[$id] } elseif ($has -eq 0x20) { $dayClass } else { $has }
    if ($want -ne $has) {
      $now = [ThothCap]::SetPriority($job, $id, [uint32]$want)
      if ($now -ne [ThothCap]::PriorityName([uint32]$want)) { "  pid ${id}: not returned to $([ThothCap]::PriorityName([uint32]$want)) ($now)" }
    }
  }
  $raised = @{}
}
if ($state) {
  $state.raised = @($raised.Keys | ForEach-Object { [ordered]@{ pid = $_; priorityClass = $raised[$_] } })
  Write-CapState $state
}
Show-Job $job
[void][ThothCap]::CloseHandle($job)
