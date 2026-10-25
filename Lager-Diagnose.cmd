@echo off
setlocal
cd /d "%~dp0"
echo Enshrouded - reine Lagerdiagnose
echo Dieses Zusatzpaket gehoert in den vorhandenen Mod-Studio-Ordner.
echo Es liest Serverdateien und schreibt nur unter Data\diagnostics.
echo Spiel und Server werden weder gestartet noch beendet.
echo.
if not exist "%~dp0engine\enshrouded-patcher.exe" (
  echo FEHLER: engine\enshrouded-patcher.exe fehlt.
  echo Beide Diagnosedateien direkt in den vorhandenen Tool-Ordner entpacken.
  pause
  exit /b 1
)
set "PKG_EXECPATH=PKG_INVOKE_NODEJS"
"%~dp0engine\enshrouded-patcher.exe" "%~dp0Lager-Diagnose.js" "%~1"
set "diagnosticExitCode=%ERRORLEVEL%"
echo.
if not "%diagnosticExitCode%"=="0" echo Diagnose abgebrochen. Fehlermeldung oben beachten.
pause
exit /b %diagnosticExitCode%
