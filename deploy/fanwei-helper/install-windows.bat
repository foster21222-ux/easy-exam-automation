@echo off
setlocal EnableExtensions

set "SOURCE_DIR=%~dp0"
set "INSTALL_DIR=%LOCALAPPDATA%\YikaoFanweiHelper"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_LAUNCHER=%STARTUP_DIR%\YikaoFanweiHelper.bat"

echo [1/4] Installing Yikao Fanwei Helper...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

if exist "%INSTALL_DIR%\helper.pid" (
  set /p OLD_PID=<"%INSTALL_DIR%\helper.pid"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$pidText='%OLD_PID%'; if ($pidText -match '^\d+$') { Stop-Process -Id ([int]$pidText) -Force -ErrorAction SilentlyContinue }"
  del /q "%INSTALL_DIR%\helper.pid" >nul 2>&1
)

xcopy "%SOURCE_DIR%*" "%INSTALL_DIR%\" /E /I /Y /Q >nul
if errorlevel 1 (
  echo Installation failed while copying files.
  pause
  exit /b 1
)

>"%INSTALL_DIR%\config.env" echo YIKAO_HELPER_HOST=127.0.0.1
>>"%INSTALL_DIR%\config.env" echo YIKAO_HELPER_PORT=18765
>>"%INSTALL_DIR%\config.env" echo YIKAO_HELPER_CHROME_PORT=19222
>>"%INSTALL_DIR%\config.env" echo YIKAO_CONSOLE_ORIGINS=http://172.16.13.214:8765
>>"%INSTALL_DIR%\config.env" echo YIKAO_HELPER_RUNTIME_DIR=%INSTALL_DIR%

echo [2/4] Registering current-user startup launcher...
if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%"
copy /Y "%INSTALL_DIR%\start-windows.bat" "%STARTUP_LAUNCHER%" >nul

echo [3/4] Starting local helper...
call "%INSTALL_DIR%\start-windows.bat"
if errorlevel 1 (
  echo The helper could not be started. Check "%INSTALL_DIR%\helper-error.log".
  pause
  exit /b 1
)

echo [4/4] Opening the shared Fanwei page...
start "" "http://172.16.13.214:8765/fanwei-test"
echo Installation completed.
timeout /t 2 /nobreak >nul
exit /b 0
