# Steps a held job memory limit down to its mode's own as what the job holds falls.
#
# cap-mode.ps1 starts it, detached, when a switch found the job holding more than the new mode's
# limit less the margin and so set the limit to what the job held plus the margin. Every interval it
# sets the limit to what the job holds plus the margin, never below the mode's own and never above
# the limit it was given, so it can rise again within that if the job grows, and nothing the job
# holds is ever refused. It ends when the limit is the mode's own, when the mode changes, or when
# the job is gone. While the mode file names no mode it holds the limit as it is and says so once.
# One at a time: stepper.json in the cap's folder names the one running.
param([Parameter(Mandatory)][string]$Mode, [Parameter(Mandatory)][uint64]$Ceiling, [int]$IntervalSeconds = 15)
. (Join-Path $PSScriptRoot 'cap-common.ps1')

function Say([string]$text) { [IO.File]::AppendAllText($CapStepperLog, "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') pid ${PID}: $text`r`n") }
[IO.File]::WriteAllText($CapStepperFile, (([ordered]@{ pid = $PID; mode = $Mode; ceiling = $Ceiling; started = (Get-Date).ToString('o') }) | ConvertTo-Json))
$target = (Get-CapTarget $Mode).Memory
Say "started for ${Mode}: limit to step down to $target, held no higher than $Ceiling, margin $(Get-CapMargin)"
$heldSaid = $false
try {
  while ($true) {
    # Its own mode: step. Another mode: end. A mode file that names none: hold the limit as it is,
    # say so once, and look again, so a file gone bad changes nothing.
    $now = Get-CapMode
    $action = [ThothCap]::StepperAction($Mode, $now)
    if ($action -eq 'end') { Say "the mode is now $now; ending"; break }
    if ($action -eq 'hold' -and -not $heldSaid) { Say "the limit is held as it is: $(Get-CapModeProblem)"; $heldSaid = $true }
    if ($action -eq 'step') { $heldSaid = $false }
    $job = [ThothCap]::Open($CapJobName, $true)
    if ($job -eq [IntPtr]::Zero) { Say "no job $CapJobName; ending"; break }
    if ($action -eq 'hold') { [void][ThothCap]::CloseHandle($job); Start-Sleep -Seconds $IntervalSeconds; continue }
    try {
      $use = Get-CapUse $job
      $want = Get-CapSafeMemory $job $target
      if ($want -gt $Ceiling) { $want = $Ceiling }
      $has = [ThothCap]::MemoryLimit($job)
      # The mode is read again just before the limit changes, so a switch made meanwhile wins.
      if ($want -ne $has -and (Get-CapMode) -eq $Mode) {
        $difference = [ThothCap]::SetMemory($job, $want)
        if ($difference -ne '') { Say "NOT SET: $difference"; break }
        Say "job holds $use; limit $has -> $want"
        $has = $want
      }
      if ($has -eq $target) { Say "limit is $Mode's own, $target; ending"; break }
    } finally { [void][ThothCap]::CloseHandle($job) }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  try { $mine = [IO.File]::ReadAllText($CapStepperFile) | ConvertFrom-Json; if ($mine.pid -eq $PID) { Remove-Item -LiteralPath $CapStepperFile -Force } } catch { }
}
