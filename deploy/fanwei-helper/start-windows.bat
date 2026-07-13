@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "INSTALL_DIR=%LOCALAPPDATA%\YikaoFanweiHelper"
set "CONFIG_FILE=%INSTALL_DIR%\config.env"
set "PID_FILE=%INSTALL_DIR%\helper.pid"

if not exist "%INSTALL_DIR%\node.exe" exit /b 1
if not exist "%INSTALL_DIR%\server\fanwei_local_helper_cli.mjs" exit /b 1

if exist "%CONFIG_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%CONFIG_FILE%") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if exist "%PID_FILE%" (
  set /p OLD_PID=<"%PID_FILE%"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$pidText='!OLD_PID!'; if ($pidText -match '^\d+$' -and (Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue)) { exit 0 } else { exit 1 }"
  if not errorlevel 1 exit /b 0
  del /q "%PID_FILE%" >nul 2>&1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$install=$env:LOCALAPPDATA + '\YikaoFanweiHelper';" ^
  "$node=Join-Path $install 'node.exe';" ^
  "$entry=Join-Path $install 'server\fanwei_local_helper_cli.mjs';" ^
  "$stdout=Join-Path $install 'helper.log';" ^
  "$stderr=Join-Path $install 'helper-error.log';" ^
  "$process=Start-Process -FilePath $node -ArgumentList @($entry) -WorkingDirectory $install -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru;" ^
  "Set-Content -LiteralPath (Join-Path $install 'helper.pid') -Value $process.Id -Encoding ascii"

if errorlevel 1 exit /b 1
exit /b 0
