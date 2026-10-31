# ============================================================================
# build_release.ps1 -- one-shot release pipeline: freeze the engine, stage the
# app frontend, then build the MSI + portable zip.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File packaging/build_release.ps1
#   ... -Clean      wipe build/ and dist/ first
#   ... -SkipSmoke  pass through to build_exe (build only, loud warning)
#
# STEPS
#   1. build_exe.ps1          PyInstaller single-directory + smoke gate
#                             (dist\ace\ with ace.exe + _internal\)
#   2. build_app_payload.ps1  stage the app frontend into dist\ace\app\
#                             (vendored dsh-TUI tree + production node_modules
#                             + @deepseek-ai runtime + node.exe). The stager's
#                             own smoke proves the staged app boots.
#   3. build_installer.ps1    WiX MSI (now including app\ -- make_wix.py
#                             harvests the WHOLE payload recursively) + the
#                             portable zip.
#
# The three scripts stay runnable individually; this file only chains them and
# stops at the first failure. ASCII-ONLY ON PURPOSE (see build_exe.ps1).
#
# EXIT: 0 = MSI + zip produced. 1 = the step that failed printed why.
# ============================================================================
[CmdletBinding()]
param(
    [string]$Python = "",
    [switch]$Clean,
    [switch]$SkipSmoke
)

$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $PSCommandPath

Write-Host "=== [1/3] engine (PyInstaller + smoke) ===" -ForegroundColor Cyan
# @PSBoundParameters rebinds -Clean/-SkipSmoke, but splatting a String "True"
# into a child powershell -File call fails switch binding; pass them explicitly
# as switch tokens instead.
$exeArgs = @((Join-Path $Here 'build_exe.ps1'))
if ($Clean) { $exeArgs += '-Clean' }
if ($SkipSmoke) { $exeArgs += '-SkipSmoke' }
& powershell -NoProfile -ExecutionPolicy Bypass -File @exeArgs
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL at step 1 (build_exe)"; exit 1 }

Write-Host ""
Write-Host "=== [2/3] app payload (dsh-TUI shell + runtime) ===" -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Here 'build_app_payload.ps1')
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL at step 2 (build_app_payload)"; exit 1 }

Write-Host ""
Write-Host "=== [3/3] installer (WiX MSI + portable zip) ===" -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Here 'build_installer.ps1')
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL at step 3 (build_installer)"; exit 1 }

Write-Host ""
Write-Host "OK: release pipeline complete. Artifacts in dist\."
exit 0
