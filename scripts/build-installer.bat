@echo off
rem ----------------------------------------------------------------------------------------------------------------------------
rem Builds the Snipmunk installer (a release NSIS setup) and opens the folder it is in.
rem
rem   * Needs pnpm and cargo (Rust) on the PATH.
rem   * The first build downloads the NSIS tools once into %LOCALAPPDATA%\tauri; later builds reuse them.
rem   * Cargo's build folder is kept on E: (this drive has the room; C: is almost full): E:\SecondDawn\snipmunk\target-release.
rem     Delete that folder to start from scratch; it is not part of the project.
rem   * Run it from anywhere: it goes to the project folder first.
rem ----------------------------------------------------------------------------------------------------------------------------
setlocal
cd /d "%~dp0.."

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found. Install it first ^(https://pnpm.io/installation^) and open a new terminal.
  goto :end
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo cargo was not found. Install Rust first ^(https://rustup.rs^) and open a new terminal.
  goto :end
)

rem Free space on E: (a release build with its dependencies needs several GB).
set "FREE_GB="
for /f %%G in ('powershell -NoProfile -Command "[math]::Floor((Get-PSDrive E).Free/1GB)" 2^>nul') do set "FREE_GB=%%G"
if "%FREE_GB%"=="" (
  echo Could not read the free space of drive E:. Is the drive there?
  goto :end
)
echo Free space on E: %FREE_GB% GB
if %FREE_GB% LSS 10 echo WARNING: less than 10 GB free on E:. The build may fail; free some space first.

rem Cargo builds on E: (never on C:).
set "CARGO_TARGET_DIR=E:\SecondDawn\snipmunk\target-release"

echo.
echo Installing the web dependencies...
call pnpm install --frozen-lockfile
if errorlevel 1 goto :failed

echo.
echo Building the release installer ^(this takes a while the first time^)...
call pnpm tauri build --bundles nsis
if errorlevel 1 goto :failed

set "OUT=%CARGO_TARGET_DIR%\release\bundle\nsis"
echo.
echo Done. The installer is in:
echo   %OUT%
for %%F in ("%OUT%\*-setup.exe") do echo   %%~nxF  ^(%%~zF bytes^)
start "" "%OUT%"
goto :end

:failed
echo.
echo The build failed. Read the messages above.

:end
echo.
pause
endlocal
