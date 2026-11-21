@echo off
rem ----------------------------------------------------------------------------------------------------------------------------
rem Builds the Snipmunk installer (a release NSIS setup) and opens the folder it is in.
rem
rem   * Needs pnpm and cargo (Rust) on the PATH.
rem   * The first build downloads the NSIS tools once into %LOCALAPPDATA%\tauri; later builds reuse them.
rem   * Cargo's build folder is kept on E: (this drive has the room; C: is almost full): E:\SecondDawn\snipmunk\target-release.
rem     Delete that folder to start from scratch; it is not part of the project.
rem   * Run it from anywhere: it goes to the project folder first.
rem   * At the end it prints BUILD OK with the full path of the setup file, or BUILD FAILED with the exit code. It always pauses.
rem ----------------------------------------------------------------------------------------------------------------------------
setlocal EnableDelayedExpansion
cd /d "%~dp0.."

set "RESULT=0"
set "STEP="

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found. Install it first ^(https://pnpm.io/installation^) and open a new terminal.
  set "RESULT=1"
  set "STEP=pnpm not found"
  goto :report
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo cargo was not found. Install Rust first ^(https://rustup.rs^) and open a new terminal.
  set "RESULT=1"
  set "STEP=cargo not found"
  goto :report
)

rem Free space on E: (a release build with its dependencies needs several GB).
set "FREE_GB="
for /f %%G in ('powershell -NoProfile -Command "[math]::Floor((Get-PSDrive E).Free/1GB)" 2^>nul') do set "FREE_GB=%%G"
if "%FREE_GB%"=="" (
  echo Could not read the free space of drive E:. Is the drive there?
  set "RESULT=1"
  set "STEP=drive E: not found"
  goto :report
)
echo Free space on E: %FREE_GB% GB
if %FREE_GB% LSS 10 echo WARNING: less than 10 GB free on E:. The build may fail; free some space first.

rem Cargo builds on E: (never on C:).
set "CARGO_TARGET_DIR=E:\SecondDawn\snipmunk\target-release"

echo.
echo Installing the web dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 (
  set "RESULT=!errorlevel!"
  set "STEP=pnpm install"
  goto :report
)

echo.
echo Building the release installer ^(this takes a while the first time^)...
call pnpm tauri build --bundles nsis
if errorlevel 1 (
  set "RESULT=!errorlevel!"
  set "STEP=pnpm tauri build"
  goto :report
)

rem The installer: the newest *-setup.exe in the bundle folder (its name has the version in it, so it is searched, not spelled out).
set "OUT=%CARGO_TARGET_DIR%\release\bundle\nsis"
set "SETUP="
for /f "delims=" %%F in ('dir /b /a-d /o-d "%OUT%\*-setup.exe" 2^>nul') do (
  if not defined SETUP set "SETUP=%OUT%\%%F"
)
if not defined SETUP (
  echo The build finished, but there is no *-setup.exe in %OUT%.
  set "RESULT=1"
  set "STEP=the setup file is missing"
  goto :report
)

:report
echo.
echo ================================================================
if "%RESULT%"=="0" (
  echo BUILD OK
  echo   Installer: !SETUP!
  echo ================================================================
  start "" explorer.exe /select,"!SETUP!"
) else (
  echo BUILD FAILED  ^(!STEP!, exit code !RESULT!^)
  echo   Scroll up to the first line that says "error" ^(or "ERR_" for pnpm^): it is the cause.
  echo ================================================================
)
echo.
pause
endlocal & exit /b %RESULT%
