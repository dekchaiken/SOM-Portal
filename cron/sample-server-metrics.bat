@echo off
REM ──────────────────────────────────────────────────────────────────
REM  Centralize-SOM — Server Metrics Sampler (Windows)
REM
REM  Edit PHP_EXE below to point at your MAMP/XAMPP PHP binary.
REM
REM  Register with Task Scheduler (run as SYSTEM, every 1 minute):
REM    schtasks /create /tn "Centralize-SOM Metrics" ^
REM             /tr "%~dp0sample-server-metrics.bat" ^
REM             /sc minute /mo 1 /ru SYSTEM
REM ──────────────────────────────────────────────────────────────────

set "PHP_EXE=C:\MAMP\bin\php\php8.2.0\php.exe"
set "SCRIPT=%~dp0sample-server-metrics.php"

if not exist "%PHP_EXE%" (
  echo [ERROR] PHP not found at %PHP_EXE%
  echo Edit PHP_EXE in %~f0 to point at your PHP binary.
  exit /b 1
)

"%PHP_EXE%" "%SCRIPT%"
exit /b %ERRORLEVEL%
