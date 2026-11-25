@echo off
rem Shows the sizes of Snipmunk's build folders and deletes them, one question at a time.
rem Only build output is touched: everything here is made again by the next build.
setlocal
cd /d "%~dp0.."

echo Snipmunk build folders in %CD%
echo.
echo Stop your dev session first ("tauri dev" and the Snipmunk it started).
tasklist /fi "imagename eq snipmunk.exe" 2>nul | find /i "snipmunk.exe" >nul && echo WARNING: Snipmunk is running right now.
tasklist /fi "imagename eq cargo.exe" 2>nul | find /i "cargo.exe" >nul && echo WARNING: cargo is running right now.
echo.
for %%D in (target target-release target-test) do call :size "%%D"
echo.

call :ask "target-test" "Delete target-test, the test builds?"
call :ask "target\debug\incremental" "Delete target\debug\incremental? The next dev build takes a little longer."
call :ask "target\release" "Delete target\release? The next release build compiles everything again."
call :ask "target-release" "Delete target-release? The next installer build compiles everything again."

echo.
echo Now:
for %%D in (target target-release target-test) do call :size "%%D"
echo.
pause
exit /b 0

:size
if not exist "%~1\" (
  echo   %~1: not there
  exit /b 0
)
powershell -NoProfile -Command "$s = (Get-ChildItem -LiteralPath '%~1' -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum; '  {0}: {1:N1} GB' -f '%~1', ($s / 1GB)"
exit /b 0

:ask
if not exist "%~1\" exit /b 0
choice /c YN /n /m "%~2 [Y/N] "
if errorlevel 2 exit /b 0
rmdir /s /q "%~1"
if exist "%~1\" (
  echo   Not everything in %~1 could be deleted: is the dev session still running?
) else (
  echo   Deleted %~1.
)
exit /b 0
