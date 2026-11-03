@echo off
rem Arrastra uno o varios .mpp sobre este archivo: deja al lado un .xml que la web importa.
setlocal
if not defined JAVA_HOME (
  for /d %%J in ("%ProgramFiles%\Microsoft\jdk-*") do set "JAVA_HOME=%%J"
)
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"
where python >nul 2>nul && (set "PY=python") || (set "PY=py")
%PY% -I "%~dp0convertir.py" %*
echo.
pause
