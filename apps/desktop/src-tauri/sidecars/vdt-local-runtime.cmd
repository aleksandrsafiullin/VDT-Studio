@echo off
setlocal

set "SIDECAR_DIR=%~dp0"
set "ENTRYPOINT=%SIDECAR_DIR%vdt-local-runtime.mjs"

if not exist "%ENTRYPOINT%" (
  echo VDT desktop sidecar runtime bundle is missing. 1>&2
  exit /b 127
)

if defined VDT_NODE (
  "%VDT_NODE%" "%ENTRYPOINT%"
) else (
  node "%ENTRYPOINT%"
)
exit /b %ERRORLEVEL%
