# Builds the Microsoft Store variant of Snipmunk and packs it as an MSIX package (see docs/store.md).
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1
#
# The identity comes from src-tauri\msix\identity.json (copy identity.example.json and paste the three values Partner Center
# shows). Without that file a TEST identity is used, good only for a local sideload test with your own test certificate.
# The package is NOT signed: the Store signs it. Needs pnpm, cargo and a Windows 10 or 11 SDK (makeappx, makepri).
#
#   -Target     cargo's build folder (default E:\SecondDawn\snipmunk\target-release); the package is written to <Target>\msix
#   -Identity   another identity file
#   -SkipBuild  pack the Store build that is already in <Target>\release (only after an earlier run of this script)
param(
  [string]$Target = "E:\SecondDawn\snipmunk\target-release",
  [string]$Identity = "",
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$msix = Join-Path $repo "src-tauri\msix"
$work = Join-Path $Target "msix"
$stage = Join-Path $work "package"
# A mark beside the program: it was built as the Store variant.
$mark = Join-Path $work "store-build.sha256"
$exe = Join-Path $Target "release\snipmunk.exe"

# --- the SDK tools -------------------------------------------------------------------------------------------------------------
$kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
$sdk = Get-ChildItem $kits -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^10\.' -and (Test-Path (Join-Path $_.FullName "x64\makeappx.exe")) } |
  Sort-Object { [version]$_.Name } | Select-Object -Last 1
if (-not $sdk) { throw "no Windows SDK with makeappx.exe below $kits (install the Windows SDK)" }
$makeappx = Join-Path $sdk.FullName "x64\makeappx.exe"
$makepri = Join-Path $sdk.FullName "x64\makepri.exe"

# --- identity and version ------------------------------------------------------------------------------------------------------
if (-not $Identity) { $Identity = Join-Path $msix "identity.json" }
if (Test-Path -LiteralPath $Identity) {
  $id = Get-Content -LiteralPath $Identity -Raw -Encoding UTF8 | ConvertFrom-Json
  if ("$($id.identityName)$($id.publisher)$($id.publisherDisplayName)" -match "PASTE") { throw "$Identity still has the example texts" }
}
else {
  Write-Warning "no identity.json: using a TEST identity (not for the Store)"
  $id = [pscustomobject]@{ identityName = "SecondDawn.Snipmunk.Test"; publisher = "CN=Snipmunk Test"; publisherDisplayName = "Second Dawn" }
}
$version = (Get-Content -LiteralPath (Join-Path $repo "package.json") -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "the version in package.json is not x.y.z: $version" }

# --- the program ---------------------------------------------------------------------------------------------------------------
New-Item -ItemType Directory -Force $work | Out-Null
if (-not $SkipBuild) {
  Push-Location $repo
  try {
    $env:CARGO_TARGET_DIR = $Target
    # (the tools write their progress to the error stream: that is not a failure)
    $ErrorActionPreference = "Continue"
    & pnpm tauri build --no-bundle --features store
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($code -ne 0) { throw "the Store build failed (exit code $code)" }
  }
  finally { Pop-Location }
  (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash | Set-Content -Encoding ascii $mark
}
if (-not (Test-Path -LiteralPath $exe)) { throw "no program at $exe" }
if (-not (Test-Path -LiteralPath $mark) -or (Get-Content $mark -TotalCount 1) -ne (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash) {
  throw "the program in $Target\release is not the Store build this script made: run without -SkipBuild"
}

# --- the package's folder ------------------------------------------------------------------------------------------------------
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -Confirm:$false }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item -LiteralPath $exe -Destination $stage
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "make-icons.ps1") -MsixAssets (Join-Path $stage "Assets")
if ($LASTEXITCODE -ne 0) { throw "the pictures could not be made" }

$manifest = Get-Content -LiteralPath (Join-Path $msix "AppxManifest.xml") -Raw -Encoding UTF8
$values = @{
  "{IDENTITY_NAME}" = $id.identityName; "{PUBLISHER}" = $id.publisher
  "{PUBLISHER_DISPLAY_NAME}" = $id.publisherDisplayName; "{VERSION}" = "$version.0"
}
foreach ($key in $values.Keys) { $manifest = $manifest.Replace($key, [System.Security.SecurityElement]::Escape($values[$key])) }
[System.IO.File]::WriteAllText((Join-Path $stage "AppxManifest.xml"), $manifest, [System.Text.UTF8Encoding]::new($false))

# The index that lets Windows pick the picture of the right size and scale.
$priConfig = Join-Path $work "priconfig.xml"
& $makepri createconfig /cf $priConfig /dq en-US /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed" }
& $makepri new /pr $stage /cf $priConfig /mn (Join-Path $stage "AppxManifest.xml") /of (Join-Path $stage "resources.pri") /o | Out-Null
if ($LASTEXITCODE -ne 0) { throw "makepri new failed" }

$package = Join-Path $work "Snipmunk_${version}.0_x64.msix"
$log = Join-Path $work "makeappx.log"
& $makeappx pack /d $stage /p $package /o > $log
if ($LASTEXITCODE -ne 0) { Get-Content $log | Select-Object -Last 30; throw "makeappx failed (see $log)" }

Write-Host ""
Write-Host "MSIX package (unsigned): $package"
Write-Host ("size: {0:N1} MB   identity: {1}   publisher: {2}" -f ((Get-Item -LiteralPath $package).Length / 1MB), $id.identityName, $id.publisher)
Write-Host "Upload it in Partner Center, or test it locally: docs\store.md"
