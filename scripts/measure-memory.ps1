# Memory and start-up of a RELEASE build of Snipmunk (see docs/performance.md).
#
# The build is made with the cargo feature "measure-guard": it never grabs or records the real screen, sound or camera, installs
# no keyboard hook, writes no autostart entry, and makes its test data itself. It runs with an identity, data, temp and web view
# folders of its own below -Work, so nothing of an installed or development Snipmunk is read or touched. Only the processes this
# script started (and their children) are looked at and stopped.
#
#   powershell -ExecutionPolicy Bypass -File scripts\measure-memory.ps1 -Work E:\SecondDawn\_scratch\tmp\measure -Label before
#
# -SkipBuild  measure the build that is there     -Startup  only the start-up times     -Leaks  only the repeated actions
param(
  [Parameter(Mandatory = $true)][string]$Work,
  [string]$Label = "run",
  [string]$Target = "E:\SecondDawn\snipmunk\target-test",
  [int]$Port = 9223,
  # The web view's data folder of the measured instance (emptied before every run).
  [string]$WebView = "",
  [switch]$SkipBuild,
  [switch]$Startup,
  [switch]$Leaks,
  # Only the first two states (to compare options), without making the test project and guide.
  [switch]$Quick,
  # Only the overlay timings: the overlay made anew for every capture, and one kept from the capture before.
  [switch]$Overlay,
  # Only where a warm start's page time goes.
  [switch]$Timing,
  # Only: starting Snipmunk again while it is still quitting brings it back.
  [switch]$Reopen,
  # Further web view options to try in this run (added to the ones the app sets itself).
  [string]$BrowserArgs = ""
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $Target "release\snipmunk.exe"
$drive = Join-Path $PSScriptRoot "measure-drive.mjs"
New-Item -ItemType Directory -Force $Work | Out-Null
$Work = (Resolve-Path $Work).Path

if (-not $SkipBuild) {
  Push-Location $repo
  try {
    & node node_modules/vite/bin/vite.js build | Tee-Object -FilePath (Join-Path $Work "bundle-$Label.txt") | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "the page did not build" }
    $env:CARGO_TARGET_DIR = $Target
    $env:TAURI_CONFIG = '{"identifier":"lab.seconddawn.snipmunk.measure"}'
    Push-Location src-tauri
    # (cargo writes its progress to the error stream: that is not a failure)
    $ErrorActionPreference = "Continue"
    & cargo build --release --offline --features "measure-guard,tauri/custom-protocol"
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    Pop-Location
    Remove-Item Env:TAURI_CONFIG
    if ($code -ne 0) { throw "the program did not build" }
  }
  finally { Pop-Location }
}
if (-not (Test-Path $exe)) { throw "no build at $exe" }

# --- the instance's own world ---------------------------------------------------------------------------------------------------
$rt = Join-Path $Work "rt"
if (-not $WebView) { $WebView = Join-Path $Work "wv2" }
function Reset-World {
  foreach ($p in $rt, $webview) { if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force -Confirm:$false } }
  foreach ($d in "Roaming", "Local", "temp", "pick") { New-Item -ItemType Directory -Force (Join-Path $rt $d) | Out-Null }
  New-Item -ItemType Directory -Force $webview | Out-Null
}
function Set-World {
  $env:APPDATA = "$rt\Roaming"; $env:LOCALAPPDATA = "$rt\Local"; $env:TEMP = "$rt\temp"; $env:TMP = $env:TEMP
  $env:SNIPMUNK_TEMP_DIR = "$rt\temp"; $env:SNIPMUNK_PICK_DIR = "$rt\pick"; $env:SNIPMUNK_STARTUP_LOG = "$rt\startup.log"
  $env:WEBVIEW2_USER_DATA_FOLDER = $webview
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port $BrowserArgs".Trim()
}
$saved = @{}
foreach ($n in "APPDATA", "LOCALAPPDATA", "TEMP", "TMP") { $saved[$n] = [Environment]::GetEnvironmentVariable($n) }

# The process and everything it started (a child is younger than its parent: an old number used again does not count).
function Get-Tree([int]$root) {
  $all = Get-CimInstance Win32_Process
  $by = @{}; foreach ($p in $all) { $by[[int]$p.ProcessId] = $p }
  if (-not $by.ContainsKey($root)) { return @() }
  $found = @($by[$root]); $i = 0
  while ($i -lt $found.Count) {
    $parent = $found[$i]; $i++
    $found += @($all | Where-Object { [int]$_.ParentProcessId -eq [int]$parent.ProcessId -and $_.CreationDate -ge $parent.CreationDate })
  }
  return $found
}

function Measure-App([int]$root, [string]$state) {
  $tree = @(Get-Tree $root)
  $ids = @{}; foreach ($p in $tree) { $ids[[int]$p.ProcessId] = $true }
  $perf = @(Get-CimInstance Win32_PerfRawData_PerfProc_Process | Where-Object { $ids.ContainsKey([int]$_.IDProcess) })
  $mb = { param($v) [math]::Round($v / 1MB, 1) }
  $kinds = @($tree | ForEach-Object {
      if ($_.Name -ne "msedgewebview2.exe") { "app" }
      elseif ($_.CommandLine -match "--type=([a-z-]+)") { $Matches[1] }
      else { "browser" } } | Group-Object | Sort-Object Name | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ", "
  $wrong = @($tree | Where-Object { $_.Name -eq "msedgewebview2.exe" -and $_.CommandLine -match "--user-data-dir=" -and $_.CommandLine -notlike "*$webview*" })
  if ($wrong.Count) { throw "a web view process uses another data folder: $($wrong[0].CommandLine)" }
  $row = [pscustomobject]@{
    State = $state; Processes = $tree.Count; Kinds = $kinds
    PrivateWS = & $mb (($perf | Measure-Object WorkingSetPrivate -Sum).Sum)
    WorkingSet = & $mb (($perf | Measure-Object WorkingSet -Sum).Sum)
    Commit = & $mb (($perf | Measure-Object PrivateBytes -Sum).Sum)
  }
  Write-Host ("{0,-34} private {1,7} MB   working set {2,7} MB   commit {3,7} MB   {4} processes ({5})" -f $state, $row.PrivateWS, $row.WorkingSet, $row.Commit, $row.Processes, $kinds)
  return $row
}

# Who started whom (what Task Manager's grouping goes by), and the options the web view's browser process got.
function Save-Tree([int]$root, [string]$file) {
  $tree = @(Get-Tree $root)
  $lines = $tree | ForEach-Object {
    $kind = if ($_.Name -ne "msedgewebview2.exe") { "app" } elseif ($_.CommandLine -match "--type=([a-z-]+)") { $Matches[1] } else { "browser" }
    "{0,-8} parent {1,-8} {2,-20} {3}" -f $_.ProcessId, $_.ParentProcessId, $_.Name, $kind
  }
  $browser = $tree | Where-Object { $_.Name -eq "msedgewebview2.exe" -and $_.CommandLine -notmatch "--type=" } | Select-Object -First 1
  $options = [regex]::Matches($browser.CommandLine, "--(disable-features|enable-features|process-per-site|remote-debugging-port|disable-gpu)[^ `"]*") | ForEach-Object { $_.Value }
  @($lines) + "" + "browser options: $($options -join ' ')" | Set-Content -Encoding utf8 $file
}

function Drive([string]$action, [string]$argument = "") {
  $out = & node $drive $Port $action $argument
  if ($LASTEXITCODE -ne 0) { throw "the step '$action' failed" }
  return $out
}

function Start-App {
  Set-World
  Remove-Item -LiteralPath "$rt\startup.log" -ErrorAction SilentlyContinue
  $app = Start-Process -FilePath $exe -PassThru
  # Proof before anything is driven: the guard is in this build.
  Drive "guard" | Out-Null
  return $app
}

function Stop-App($app) {
  $before = @(Get-Tree $app.Id)
  $clock = [Diagnostics.Stopwatch]::StartNew()
  try { Drive "quit" | Out-Null } catch { }
  $gone = $app.WaitForExit(15000)
  $exitMs = $clock.ElapsedMilliseconds
  $left = $before
  for ($i = 0; $i -lt 40 -and $left.Count; $i++) {
    Start-Sleep -Milliseconds 250
    $now = Get-CimInstance Win32_Process
    $left = @($before | Where-Object { $p = $_; $now | Where-Object { $_.ProcessId -eq $p.ProcessId -and $_.CreationDate -eq $p.CreationDate } })
  }
  $allMs = $clock.ElapsedMilliseconds
  # The program's own account of the quit, counted from the moment it was asked for.
  $log = @{}; Get-Content "$rt\startup.log" -ErrorAction SilentlyContinue | ForEach-Object { $k, $v = $_ -split " "; if ($k -like "quit*") { $log[$k] = [int64]$v } }
  $stages = ""
  if ($log.ContainsKey("quit")) { $stages = (@("quit-hidden", "quit-browser", "quit-cleared", "quit-done") | Where-Object { $log.ContainsKey($_) } | ForEach-Object { "$($_.Substring(5)) $($log[$_] - $log['quit'])" }) -join ", " }
  if (-not $gone -or $left.Count) {
    Write-Host "after Quit still running: $(($left | ForEach-Object { "$($_.Name) $($_.ProcessId)" }) -join ', ')"
    $left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  return [pscustomobject]@{ ExitMs = $exitMs; AllGoneMs = $allMs; Left = $left.Count; Stages = $stages }
}

try {
  if ($Startup) {
    Reset-World
    $times = @()
    foreach ($run in 1..6) {
      Set-World
      Remove-Item -LiteralPath "$rt\startup.log" -ErrorAction SilentlyContinue
      $app = Start-Process -FilePath $exe -PassThru
      for ($i = 0; $i -lt 200 -and -not ((Test-Path "$rt\startup.log") -and (Select-String -Path "$rt\startup.log" -Pattern "^ready" -Quiet)); $i++) { Start-Sleep -Milliseconds 100 }
      Start-Sleep -Milliseconds 500
      $log = @{}; Get-Content "$rt\startup.log" | ForEach-Object { $k, $v = $_ -split " "; if (-not $log.ContainsKey($k)) { $log[$k] = [int]$v } }
      Start-Sleep 2
      $quit = Stop-App $app
      $kind = if ($run -eq 1) { "first start (empty web view folder)" } else { "warm start $($run - 1)" }
      # MainMs: the program's own code starts. SetupMs: the window and its web view exist. PageMs: loading the page until
      # its first frame (counted from the page's start). Frame: 1 when an animation frame reported it, 0 the fallback timer.
      $times += [pscustomobject]@{ Start = $kind; MainMs = $log["main"]; SetupMs = $log["setup"]; PageMs = $log["page"]; Frame = $log["frame"]; ShownMs = $log["shown"]; ReadyMs = $log["ready"]; QuitMs = $quit.ExitMs; AllGoneMs = $quit.AllGoneMs; Left = $quit.Left }
      Start-Sleep 2
    }
    $times | Format-Table -AutoSize | Out-String -Width 200 | Tee-Object -FilePath (Join-Path $Work "startup-$Label.txt") | Out-Host
    return
  }

  if ($Reopen) {
    Reset-World
    # (only processes of this build, the one this script starts)
    $mine = { @(Get-CimInstance Win32_Process -Filter "Name='snipmunk.exe'" | Where-Object { $_.ExecutablePath -eq $exe }) }
    if (@(& $mine).Count) { throw "this build is already running" }
    foreach ($delay in 0, 100, 250) {
      $app = Start-App
      Start-Sleep 3
      Drive "quitAndStart" "$delay|$exe" | Out-Null
      $app.WaitForExit(15000) | Out-Null
      Start-Sleep 6
      $now = @(& $mine)
      $back = $now.Count -eq 1 -and [int]$now[0].ProcessId -ne $app.Id
      Write-Host "started again $delay ms after Quit: $(if ($back) { 'Snipmunk is back' } else { "NOT back ($($now.Count) running)" })"
      foreach ($p in $now) {
        $app = Get-Process -Id ([int]$p.ProcessId)
        Drive "guard" | Out-Null
        Write-Host "  then quit: $((Stop-App $app).Left) processes left"
      }
      Start-Sleep 2
    }
    return
  }

  if ($Timing) {
    Reset-World
    foreach ($run in 1..2) {
      $app = Start-App
      Start-Sleep 3
      if ($run -eq 2) { Drive "pageTiming" | Out-Host; Get-Content "$rt\startup.log" | Out-Host }
      $null = Stop-App $app
      Start-Sleep 2
    }
    return
  }

  if ($Overlay) {
    Reset-World
    $lines = @()
    $env:SNIPMUNK_OVERLAY_KEEP_MS = "20000"
    $app = Start-App
    Drive "prepare" | Out-Null
    Start-Sleep 5
    $lines += "overlay made anew (ms, 8 captures): $(Drive 'overlayTiming' 'fresh')"
    $lines += "overlay kept from the one before (ms, 8 captures; the first makes it): $(Drive 'overlayTiming' 'kept')"
    # With the main window minimized its web view is in the low memory state, and the overlay shares its page process.
    Drive "minimize" | Out-Null
    Start-Sleep 10
    $lines += "main window minimized, overlay made anew (ms): $(Drive 'overlayTiming' 'fresh')"
    $lines += "main window minimized, overlay kept (ms): $(Drive 'overlayTiming' 'kept')"
    Drive "show" | Out-Null
    Start-Sleep 3
    $null = Drive "overlayTiming" "kept"
    $lines += (Measure-App $app.Id "overlay kept").PrivateWS | ForEach-Object { "private working set with the kept overlay: $_ MB" }
    Start-Sleep 25
    $lines += (Measure-App $app.Id "overlay destroyed").PrivateWS | ForEach-Object { "private working set after it is destroyed: $_ MB" }
    $null = Stop-App $app
    $lines | Tee-Object -FilePath (Join-Path $Work "overlay-$Label.txt") | Out-Host
    return
  }

  if ($Quick) {
    Reset-World
    $app = Start-App
    Drive "prepare" | Out-Null
    Start-Sleep 15; $null = Measure-App $app.Id "S1 $Label"
    Drive "seedCaptures" "30" | Out-Null; Start-Sleep 10; $null = Measure-App $app.Id "S2 $Label"
    $null = Stop-App $app
    return
  }

  # --- preparation (not measured): a 60 s project and a guide of 50 steps -----------------------------------------------------
  Reset-World
  $data = Join-Path $Work "data"
  New-Item -ItemType Directory -Force $data | Out-Null
  $project = Join-Path $data "measure-60s.snpr"
  $guide = Join-Path $data "measure-50.snpd"
  if (-not (Test-Path $project) -or -not (Test-Path $guide)) {
    $app = Start-App
    Drive "prepare" | Out-Null
    if (-not (Test-Path $project)) { Drive "record" "60" | Out-Null; Drive "saveProject" $project | Out-Null }
    if (-not (Test-Path $guide)) { Drive "makeGuide" "50|$guide" | Out-Null }
    Stop-App $app | Out-Null
  }

  Reset-World
  $rows = @()
  $app = Start-App
  Drive "prepare" | Out-Null
  if (-not $Leaks) {
    Start-Sleep 15; $rows += Measure-App $app.Id "S1 started, Screenshots, empty"
    Save-Tree $app.Id (Join-Path $Work "processes-$Label.txt")
    Drive "seedCaptures" "30" | Out-Null; Start-Sleep 10; $rows += Measure-App $app.Id "S2 30 captures, one in the editor"
    Drive "openProject" $project | Out-Null; Start-Sleep 10; $rows += Measure-App $app.Id "S3 Recording, 60 s project"
    Drive "closeProject" | Out-Null
    Drive "record" "20" | Out-Null; Start-Sleep 10; $rows += Measure-App $app.Id "S4 a recording just ended"
    Drive "openGuide" $guide | Out-Null; Start-Sleep 10; $rows += Measure-App $app.Id "S5 Documents, 50-step guide"
    Drive "exportPdf" | Out-Null; Start-Sleep 2; $rows += Measure-App $app.Id "S6 right after a PDF export"
    Drive "closeExport" | Out-Null; Start-Sleep 60; $rows += Measure-App $app.Id "S7 60 s after the export"
    Drive "minimize" | Out-Null; Start-Sleep 30; $rows += Measure-App $app.Id "S8 minimized for 30 s"
    Drive "show" | Out-Null; Start-Sleep 8; $rows += Measure-App $app.Id "S9 shown again"
  }
  else {
    Drive "openGuide" $guide | Out-Null; Start-Sleep 10; $rows += Measure-App $app.Id "L0 guide open"
    foreach ($i in 1..5) { Drive "exportPdf" | Out-Null; Drive "closeExport" | Out-Null; Start-Sleep 15; $rows += Measure-App $app.Id "L1 after export $i" }
    Drive "openProject" $project | Out-Null; Start-Sleep 3; Drive "closeProject" | Out-Null; Start-Sleep 10; $rows += Measure-App $app.Id "L2 after project 1"
    foreach ($i in 2..5) { Drive "openProject" $project | Out-Null; Start-Sleep 3; Drive "closeProject" | Out-Null; Start-Sleep 10; $rows += Measure-App $app.Id "L2 after project $i" }
  }
  $quit = Stop-App $app
  Write-Host "Quit: the app ended after $($quit.ExitMs) ms, all its processes after $($quit.AllGoneMs) ms, $($quit.Left) left"
  Write-Host "Quit stages (ms after it was asked for): $($quit.Stages)"
  # What Quit has to remove from the web view's folder, and what has to stay.
  $profileDir = Join-Path $webview "EBWebView"
  $caches = @("Default\Cache", "Default\Code Cache", "Default\GPUCache", "Default\DawnGraphiteCache", "Default\DawnWebGPUCache", "GPUPersistentCache", "ShaderCache", "GrShaderCache", "GraphiteDawnCache", "component_crx_cache") | Where-Object { Test-Path (Join-Path $profileDir $_) }
  $kept = Test-Path (Join-Path $profileDir "Default\Local Storage")
  $size = [math]::Round((Get-ChildItem -LiteralPath $webview -Recurse -File -Force | Measure-Object Length -Sum).Sum / 1MB, 1)
  Write-Host "After Quit: cache folders left: $(if ($caches) { $caches -join ', ' } else { 'none' }); local storage kept: $kept; web view folder $size MB"

  $name = if ($Leaks) { "leaks-$Label" } else { "memory-$Label" }
  $md = @("| State | Private working set (MB) | Working set (MB) | Commit (MB) | Processes |", "| --- | ---: | ---: | ---: | --- |")
  $md += $rows | ForEach-Object { "| $($_.State) | $($_.PrivateWS) | $($_.WorkingSet) | $($_.Commit) | $($_.Processes): $($_.Kinds) |" }
  $md += ""; $md += "Quit: app ended after $($quit.ExitMs) ms, all processes after $($quit.AllGoneMs) ms, $($quit.Left) left. Stages (ms): $($quit.Stages)."
  $md | Set-Content -Encoding utf8 (Join-Path $Work "$name.md")
}
finally {
  # (only what this script started is stopped)
  if ($app -and -not $app.HasExited) { Get-Tree $app.Id | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
  foreach ($n in $saved.Keys) { [Environment]::SetEnvironmentVariable($n, $saved[$n]) }
  foreach ($n in "SNIPMUNK_OVERLAY_KEEP_MS", "SNIPMUNK_TEMP_DIR", "SNIPMUNK_PICK_DIR","SNIPMUNK_STARTUP_LOG", "WEBVIEW2_USER_DATA_FOLDER", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
}
