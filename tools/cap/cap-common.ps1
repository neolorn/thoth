# Shared by the cap's scripts: the Windows calls and the policy (cap-lib.cs), the folder the cap
# keeps its state in, the mode, and each mode's limits as this machine gives them.
#
# Modes, each computed from the machine (cap-lib.cs, ThothCap.TargetOf):
#   day         a hard processor cap of two thirds of the machine (rate 6667 of 10000), job memory
#               two thirds of the memory Windows reports, every processor, below normal priority.
#   night       no limit: no rate cap, no memory limit, every processor, normal priority, and the
#               work told it has every logical processor.
#   efficiency  the efficiency cores only (by the processors' efficiency class; where there is one
#               class, half of the logical processors), job memory half of the memory Windows
#               reports, below normal priority, no rate cap (the cores are the limit).
#
# The state folder holds mode.txt (the mode, which only its owner changes), priority-level.txt (the
# level the gate reads while it runs), job-state.json (the running command), and the stepper's
# files. It is `tmp/cap` in the repository, outside every tracked file, unless THOTH_CAP_DIRECTORY
# names another. `pnpm run clean` empties `tmp` but keeps this folder whole, so a clean leaves the
# mode and a running command's state as they were. A folder may also hold job-name.txt, naming the
# job (ThothCap otherwise), and physical-bytes.txt, the memory its limits are taken from: a second
# cap for proving this one beside a running job takes a folder of its own with both.
#
# With no mode file the mode is day. A mode file that cannot be read, or holds anything but day,
# night or efficiency, names no mode: nothing starts under it (exit 125, naming the file and the
# command that sets it), `cap mode` and `policy` report it as unreadable or unknown, and a running
# command keeps the limits in force and logs it once. mode.txt and priority-level.txt are written
# whole (ThothCap.WriteWhole), so no reader finds a part of one.
$ErrorActionPreference = 'Stop'
if (-not ('ThothCap' -as [type])) {
  Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'cap-lib.cs')))
}

$CapDirectory = if ($env:THOTH_CAP_DIRECTORY) { $env:THOTH_CAP_DIRECTORY } else { Join-Path $PSScriptRoot '..\..\tmp\cap' }
$CapDirectory = [IO.Path]::GetFullPath($CapDirectory)
[void][IO.Directory]::CreateDirectory($CapDirectory)

$CapJobName = 'ThothCap'
$nameFile = Join-Path $CapDirectory 'job-name.txt'
if (Test-Path -LiteralPath $nameFile) {
  $named = [IO.File]::ReadAllText($nameFile).Trim()
  if ($named) { $CapJobName = $named }
}
$CapModeFile = Join-Path $CapDirectory 'mode.txt'
$CapLevelFile = Join-Path $CapDirectory 'priority-level.txt'
$CapStateFile = Join-Path $CapDirectory 'job-state.json'
$CapStepperFile = Join-Path $CapDirectory 'stepper.json'
$CapStepperLog = Join-Path $CapDirectory 'stepper.log'
$CapPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Get-CapPhysical {
  $file = Join-Path $CapDirectory 'physical-bytes.txt'
  if (Test-Path -LiteralPath $file) { return [uint64]([IO.File]::ReadAllText($file).Trim()) }
  [uint64](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
}

function Get-CapMargin { [ThothCap]::Margin((Get-CapPhysical)) }

function Get-CapEfficiencyMask {
  $count = 0; $description = ''
  $mask = [ThothCap]::EfficiencyMask([ref]$count, [ref]$description)
  if ($mask -eq 0) { throw "no efficiency mask: $description" }
  [pscustomobject]@{ Mask = [uint64]$mask; Count = $count; Description = $description }
}

# What the mode file says (ThothCap.MeaningOf): a mode, day with no file, or unreadable or unknown.
function Read-CapModeFile {
  $exists = Test-Path -LiteralPath $CapModeFile
  $readable = $true; $text = ''; $failure = ''
  if ($exists) {
    try { $text = [IO.File]::ReadAllText($CapModeFile) } catch { $readable = $false; $failure = $_.Exception.Message }
  }
  [pscustomobject]@{ Meaning = [ThothCap]::MeaningOf($exists, $readable, $text); Text = $text; Failure = $failure }
}

function Get-CapMode { (Read-CapModeFile).Meaning }

# Why the mode file names no mode, with the file and the command that sets it; empty when it names one.
function Get-CapModeProblem {
  $read = Read-CapModeFile
  $set = 'set the mode with node tools/cap.ts mode day|night|efficiency'
  if ($read.Meaning -eq 'unreadable') { return "the mode file $CapModeFile cannot be read ($($read.Failure.Trim())); $set" }
  if ($read.Meaning -eq 'unknown') { return "the mode file $CapModeFile holds `"$($read.Text.Trim())`", which is not day, night or efficiency; $set" }
  ''
}

# The level the gate reads from priority-level.txt: normal at night, its own stage levels otherwise.
function Get-CapLevel([string]$mode) { if ($mode -eq 'night') { 'normal' } else { 'stage' } }

function Get-CapTarget([string]$mode) {
  $mask = [uint64]0
  if ($mode -eq 'efficiency') { $mask = (Get-CapEfficiencyMask).Mask }
  [ThothCap]::TargetOf($mode, (Get-CapPhysical), [Environment]::ProcessorCount, $mask)
}

# What the job holds now: the private bytes of every process in it, which is what its memory limit charges.
function Get-CapUse($job) {
  [uint64]$sum = 0
  foreach ($id in [ThothCap]::Pids($job)) {
    try { $sum += [uint64](Get-Process -Id $id -ErrorAction Stop).PrivateMemorySize64 } catch { }
  }
  $sum
}

# The memory limit a switch may set now: the mode's own, unless the job holds more than that less
# the margin, when it is what the job holds plus the margin, so lowering it ends nothing.
function Get-CapSafeMemory($job, [uint64]$target) {
  if ($target -eq 0) { return [uint64]0 }
  $floor = [ThothCap]::Pages([double]((Get-CapUse $job) + (Get-CapMargin)), $true)
  if ($floor -gt $target) { $floor } else { $target }
}

function Read-CapState {
  try {
    if (Test-Path -LiteralPath $CapStateFile) { return ([IO.File]::ReadAllText($CapStateFile) | ConvertFrom-Json) }
  } catch { }
  $null
}

function Write-CapState($state) {
  [IO.File]::WriteAllText($CapStateFile, ($state | ConvertTo-Json -Depth 6))
}

# The variables of this process the launcher carries: THOTH_* and PATH (ThothCap.Carried).
function Get-CapCarried {
  $environment = [ordered]@{}
  foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator() | Sort-Object Name) {
    $name = [string]$entry.Name
    if ([ThothCap]::Carried($name)) { $environment[$name] = [string]$entry.Value }
  }
  $environment
}
