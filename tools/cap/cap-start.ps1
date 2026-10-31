# Starts a heavy command through cap-run.ps1 in a process of its own and returns at once, so the
# command does not end when the shell that asked for it does, nor when the program that started
# that shell exits. Prints the launcher's pid. `node tools/cap.ts start` is the way in.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File cap-start.ps1 -Log <file> -Status <file>
#       [-Priority BelowNormal|Normal] [-WaitSeconds n] [-ManagesPriority] [-Directory <dir>] -Command "<command line>"
#
# The launcher is created by Win32_Process.Create with CREATE_BREAKAWAY_FROM_JOB. A process this
# shell creates is born in every job this shell is in, and a program that holds its processes in a
# job may end them all when it exits; the WMI provider host creates the launcher outside them
# ("Child processes created using Win32_Process.Create are not associated with the job", Job
# Objects on Microsoft Learn), and the flag keeps it out of the provider host's own job. Such a
# process gets the user's default environment and no standard handles, so what the launcher needs
# goes in a request file beside the log: the command and its options, the directory, and the
# variables of this shell's that the command needs beyond that default, which the launcher sets
# over its own before anything else. The launcher writes its own output to <log>.launcher.out and
# <log>.launcher.err.
#
# Only named variables are carried, never the rest of this shell's environment: a name nobody
# thought of could hold a secret, and the request is a file on disk. THOTH_* are the settings the
# gate, the readings and the cap itself read. PATH is carried because the default one can resolve
# `bash` to WSL's Linux shell and `git` to another installation than the caller's, where a command
# has to run the tools the caller's PATH finds (ThothCap.Carried in cap-lib.cs).
#
# A mode file that cannot be read, or names no mode, starts nothing: exit 125, with the file and the
# command that sets it on the error output and in the status file.
#
# Started from inside the capped job (THOTH_CAP_JOB names a job this process is in), the launcher
# is started as a plain child instead, so it runs its command in that job as cap-run.ps1 says.
param(
  [Parameter(Mandatory)][string]$Command,
  [Parameter(Mandatory)][string]$Log,
  [Parameter(Mandatory)][string]$Status,
  [ValidateSet('BelowNormal', 'Normal')][string]$Priority = 'BelowNormal',
  [int]$WaitSeconds = 0,
  [switch]$ManagesPriority,
  [string]$Directory = ''
)
. (Join-Path $PSScriptRoot 'cap-common.ps1')
$run = Join-Path $PSScriptRoot 'cap-run.ps1'
$Log = [IO.Path]::GetFullPath($Log)
$Status = [IO.Path]::GetFullPath($Status)
$request = "$Log.request.json"
foreach ($file in $Log, $Status, $request) { if (Test-Path -LiteralPath $file) { throw "$file exists; name a new file, so one run's record is never mixed with another's." } }
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Log))
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Status))

# A mode file that cannot be read, or names no mode, starts nothing: exit 125 with the file and the
# command that sets it, and the status says so. No mode file at all is day.
$problem = Get-CapModeProblem
if ($problem) {
  $now = (Get-Date).ToString('o')
  [IO.File]::WriteAllText($Status, ([ordered]@{
    command = $Command; started = $now; ended = $now; directory = $CapDirectory; outcome = 'not started'; reason = $problem
  } | ConvertTo-Json -Depth 4))
  [Console]::Error.WriteLine("[cap] NOT STARTED: $problem")
  exit 125
}
$here = if ($Directory) { (Resolve-Path -LiteralPath $Directory).ProviderPath } else { (Get-Location).ProviderPath }

if ($env:THOTH_CAP_JOB -and [ThothCap]::SelfIn($env:THOTH_CAP_JOB)) {
  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$run`"",
    '-Priority', $Priority, '-WaitSeconds', $WaitSeconds, '-Log', "`"$Log`"", '-Status', "`"$Status`"")
  if ($ManagesPriority) { $arguments += '-ManagesPriority' }
  $arguments += @('-Command', ('"' + ($Command -replace '"', '\"') + '"'))
  $launcher = Start-Process -FilePath $CapPowerShell -ArgumentList $arguments -WindowStyle Hidden -PassThru -WorkingDirectory $here `
    -RedirectStandardError "$Log.launcher.err" -RedirectStandardOutput "$Log.launcher.out"
  "launcher pid $($launcher.Id) started $((Get-Date).ToString('o')) inside $($env:THOTH_CAP_JOB); log $Log; status $Status"
  exit 0
}

# The folder is carried as well, so the launcher and anything capped inside it use this cap's.
$env:THOTH_CAP_DIRECTORY = $CapDirectory
$body = [ordered]@{
  command = $Command; priority = $Priority; waitSeconds = $WaitSeconds; managesPriority = [bool]$ManagesPriority
  log = $Log; status = $Status; directory = $here; environment = (Get-CapCarried)
}
[IO.File]::WriteAllText($request, ($body | ConvertTo-Json -Depth 4))

# ShowWindow 0 is SW_HIDE; 0x01000000 is CREATE_BREAKAWAY_FROM_JOB.
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; CreateFlags = [uint32]0x01000000 }
$line = "`"$CapPowerShell`" -NoProfile -ExecutionPolicy Bypass -File `"$run`" -Request `"$request`""
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line; CurrentDirectory = $here; ProcessStartupInformation = $startup }
if ($result.ReturnValue -ne 0) { throw "Win32_Process.Create returned $($result.ReturnValue) (2 access denied, 3 insufficient privilege, 8 unknown failure, 9 path not found, 21 invalid parameter)" }
"launcher pid $($result.ProcessId) started $((Get-Date).ToString('o')) outside this shell's jobs; log $Log; status $Status; request $request"
