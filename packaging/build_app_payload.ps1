# ============================================================================
# build_app_payload.ps1 -- stage the HoohShell app (dsh-TUI vendored tree + its
# runtime node_modules + a portable node.exe) into the release payload.
#
#   INPUT   <repo>\frontend\dsh-ui\         the vendored app tree (source)
#           <repo>\frontend\package.json    the dependency manifest
#   OUTPUT  <payload>\app\dsh-ui\           app tree, ready to run
#           <payload>\app\node_modules\     PRODUCTION deps only (npm ci)
#           <payload>\app\node.exe          portable Node runtime
#
# WHY A STAGED COPY: `npm ci --omit=dev` must run in a directory that owns its
# package.json and lockfile. The repo tree's node_modules carries dev deps
# (typescript, vitest, @types/*) that the app never loads at runtime -- roughly
# 25 MB of dead weight per install -- and CI must not mutate the developer's
# tree. So: copy package.json + package-lock.json + the app source, npm ci
# there, then copy node_modules back into the payload.
#
# WHERE THE RUNTIME PLATFORM PACKAGES COME FROM: the vendored app statically
# imports @deepseek-ai/* runtime packages (cordis, dsh-session, ...). Those are
# NOT on npm at the versions the tree needs; they ship inside the official dsh
# install. If `npm root -g` has @deepseek-ai/dsh, its node_modules are merged
# into the staged node_modules (junction-free real copies -- the payload must
# survive a ZIP move). Without them the app still boots its own UI but the
# hooh KERNEL backend fails to load -- so their presence is verified when the
# source tree is available, and reported as a warning otherwise.
#
# WHY node.exe SHIPS IN THE PAYLOAD: the frozen release promises "no Python
# needed"; promising "no Node needed" too makes the app entry work on a clean
# machine. node.exe is a single ~80 MB binary; zipped inside the MSI it adds
# ~25 MB. Taken from the build machine's Node (>= 22), matching the app's
# engines field (>= 18, but 22+ is what upstream tests).
#
# ASCII-ONLY ON PURPOSE (see build_exe.ps1 for the mojibake history).
#
# USAGE
#   powershell -NoProfile -ExecutionPolicy Bypass -File packaging/build_app_payload.ps1
#   ... -Payload dist\ace      payload root (default: dist\ace)
#   ... -Node <path>           node.exe to ship (default: resolved from PATH)
#
# EXIT: 0 = payload staged and self-checked. 1 = failed (reason printed).
# ============================================================================
[CmdletBinding()]
param(
    [string]$Payload = "",
    [string]$Node = ""
)

$ErrorActionPreference = 'Stop'
$Here  = Split-Path -Parent $PSCommandPath
$Repo  = Split-Path -Parent $Here
$App   = Join-Path $Repo 'frontend\dsh-ui'
$Front = Join-Path $Repo 'frontend'

if (-not $Payload) { $Payload = Join-Path $Repo 'dist\ace' }
$AppDir  = Join-Path $Payload 'app'
$UiDir   = Join-Path $AppDir 'dsh-ui'
$NmDir   = Join-Path $AppDir 'node_modules'

Write-Host "repo     : $Repo"
Write-Host "app tree : $App"
Write-Host "payload  : $AppDir"

# -- 1. sources present? ------------------------------------------------------
if (-not (Test-Path (Join-Path $App 'package.json'))) {
    Write-Host "FAIL: app tree not found: $App (is frontend/dsh-ui vendored?)"
    exit 1
}
$lock = Join-Path $Front 'package-lock.json'
if (-not (Test-Path $lock)) {
    Write-Host "FAIL: $lock missing (run npm install in frontend\ once; npm ci needs the lockfile)"
    exit 1
}

# -- 2. node.exe --------------------------------------------------------------
if (-not $Node) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { Write-Host "FAIL: node not found on PATH (pass -Node <path>)"; exit 1 }
    $Node = $cmd.Source
}
$nodeVer = & $Node --version
if ($nodeVer -notmatch '^v(2[2-9]|[3-9]\d)\.') {
    Write-Host "WARN: node $nodeVer is older than the tested v22+; continuing."
}
Write-Host "node     : $Node ($nodeVer)"

# -- 3. stage the app tree ----------------------------------------------------
if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $UiDir | Out-Null

# The tree ships as SOURCE (tsx runs TS directly); keep every file except the
# local node_modules (rebuilt below) and the .vitest cache.
cmd /c "robocopy `"$App`" `"$UiDir`" /E /NFL /NDL /NJH /NJS /NP /XD node_modules .vitest-tmp .ace_sessions .guardian /XF .agent_memory.json .shell-debug.log >nul"
if ($LASTEXITCODE -ge 8) { Write-Host "FAIL: robocopy app tree exited $LASTEXITCODE"; exit 1 }
Write-Host "  + dsh-ui tree"

# The app tree imports BACK into the classic frontend sources in two places:
# activityFrames (spinner frames, single source of truth) and hooh/engine.ts
# (resolvePython). Ship frontend/src + the frontend tsconfig next to dsh-ui
# so those relative imports resolve exactly as in the repo.
#
# NOTE (2026-10-31): the rest of `frontend/src` (`App.tsx`, `index.tsx`, the
# classic Swiss-spec UI) is NOT part of this runtime -- `ace classic` has no
# frozen branch and only ever runs from a source checkout (ace.cmd :fe_frontend
# pushd's into <repo>\frontend). So its ink-kernel imports never resolve here
# and `frontend/vendor` is deliberately not staged; adding it would just bloat
# the payload. Only the two bridge modules above are reachable from dsh-ui.
Copy-Item (Join-Path $Front "src") $AppDir -Recurse -Force
Copy-Item (Join-Path $Front 'tsconfig.json') $AppDir -Force

# -- 4. production node_modules (staged npm ci) --------------------------------
$Stage = Join-Path $env:TEMP ("hooh-app-nm-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item (Join-Path $Front 'package.json') $Stage
Copy-Item $lock $Stage
Push-Location $Stage
try {
    Write-Host "  + npm ci --omit=dev (staged; does not touch the repo tree)"
    # PS 5.1 turns npm's stderr warnings into terminating error records when a
    # script runs under -File; run npm via cmd so warnings stay warnings, and
    # judge success by the exit code only.
    cmd /c "npm ci --omit=dev --no-audit --no-fund >npm-ci.log 2>&1"
    Get-Content npm-ci.log | Select-Object -Last 4 | ForEach-Object { Write-Host "      $_" }
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: npm ci exited $LASTEXITCODE"; Pop-Location; exit 1 }
} finally { Pop-Location }

# The @dsh-std/* deps are file: refs into dsh-ui/_vendor; npm copies them into
# the stage, but they must RESOLVE relative to the payload. They are already
# inside the app tree (dsh-ui/_vendor), so point node at them the same way the
# repo does: real copies under node_modules. npm already materialized the file:
# deps as real directories -- just move the whole node_modules over.
if (Test-Path $NmDir) { Remove-Item $NmDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $NmDir | Out-Null
# /E (copy) + delete the stage, NOT /MOVE: MOVE treats a single locked file
# (npm's own log handles) as fatal, while plain copy only warns (exit < 8).
# robocopy via cmd: under PS 5.1 direct invocation mis-handles the non-ASCII
# payload path (mangled codepage) and can report bogus dir failures (exit 8/9)
# on the first pass when the target carries state from an earlier attempt.
# Empirically a second pass completes (everything skipped, exit 0), so run
# up to twice and judge the LAST exit code.
# Convergence loop: each pass lands more of the tree before stopping; a fresh
# destination needs up to a handful of passes. Six is generous (76 -> 305 dirs
# converged in four on the dev machine); a real failure still exits here.
$roboTries = 0
do {
    cmd /c "robocopy `"$Stage\node_modules`" `"$NmDir`" /E /NFL /NDL /NJH /NJS /NP >nul"
    $roboTries++
    if ($roboTries -ge 6) { break }
} while ($LASTEXITCODE -ge 8)
# The non-ASCII payload path makes robocopy report a bogus exit (8/9) even when
# every file landed (observed: identical trees, 8477 files / 29.2 MB both sides,
# while robocopy insists on 8). The arbiter is a real tree comparison, not the
# exit code: count files and bytes on both sides.
$srcFiles = Get-ChildItem (Join-Path $Stage 'node_modules') -Recurse -File
$dstFiles = Get-ChildItem $NmDir -Recurse -File
$srcSum = ($srcFiles | Measure-Object Length -Sum).Sum
$dstSum = ($dstFiles | Measure-Object Length -Sum).Sum
if ($srcFiles.Count -ne $dstFiles.Count -or $srcSum -ne $dstSum) {
    Write-Host ("FAIL: node_modules copy incomplete (src {0} files / {1:N1} MB vs dst {2} files / {3:N1} MB)" -f `
        $srcFiles.Count, ($srcSum / 1MB), $dstFiles.Count, ($dstSum / 1MB))
    exit 1
}
Write-Host ("  verified: {0} files / {1:N1} MB identical" -f $dstFiles.Count, ($dstSum / 1MB))
Remove-Item $Stage -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  + node_modules (production)"

# -- 5. merge the @deepseek-ai runtime packages (from the local dsh install) ---
$npmRoot = & npm root -g 2>$null
$dshNm = Join-Path $npmRoot '@deepseek-ai\dsh\node_modules'
if (Test-Path $dshNm) {
    $merged = 0
    Get-ChildItem $dshNm -Directory | ForEach-Object {
        $target = Join-Path $NmDir $_.Name
        if (-not (Test-Path $target)) {
            Copy-Item $_.FullName $target -Recurse -Force
            $merged++
        }
    }
    Write-Host "  + @deepseek-ai runtime packages merged from global dsh: $merged"
    # cordis must be a SINGLE instance per process; the copy IS the single
    # instance inside the payload (nothing else in the payload provides one).
} else {
    Write-Host "WARN: global dsh install not found at $dshNm"
    Write-Host "      the hooh KERNEL backend will fail to load in this payload"
    Write-Host "      (install dsh once: npm i -g @deepseek-ai/dsh --vertical or per docs)"
}

# @dsh-std/* are file: deps pointing INTO the app tree (dsh-ui/_vendor/...);
# npm ci run in a directory outside that tree materializes them as EMPTY dirs.
# The payload ships the app tree, so copy the real stub packages over them.
$dshStdSrc = Join-Path $UiDir '_vendor\dsh-std'
if (Test-Path $dshStdSrc) {
    Get-ChildItem $dshStdSrc -Directory | ForEach-Object {
        $target = Join-Path $NmDir ('@dsh-std\' + $_.Name)
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        Copy-Item $_.FullName $target -Recurse -Force
    }
    Write-Host '  + @dsh-std stub packages (from app tree _vendor)'
}

# dsh-working-activity (activity frames source; types + config.js at runtime)
$tuiNm = Join-Path $npmRoot '@deepseek-harness-tui\dsh-tui\node_modules\dsh-working-activity'
if ((Test-Path $tuiNm) -and -not (Test-Path (Join-Path $NmDir 'dsh-working-activity'))) {
    Copy-Item $tuiNm (Join-Path $NmDir 'dsh-working-activity') -Recurse -Force
    Write-Host "  + dsh-working-activity"
}

# -- 6. node.exe into the payload ---------------------------------------------
Copy-Item $Node (Join-Path $AppDir 'node.exe') -Force
Write-Host "  + node.exe"

# -- 7. self-check -------------------------------------------------------------
$checks = @(
    (Join-Path $UiDir 'backends\hooh\app-entry.ts'),
    (Join-Path $NmDir 'tsx\dist\cli.mjs'),
    (Join-Path $NmDir 'react\package.json'),
    (Join-Path $AppDir 'node.exe')
)
foreach ($c in $checks) {
    if (-not (Test-Path $c)) { Write-Host "FAIL: self-check missing: $c"; exit 1 }
}
$nmCount = (Get-ChildItem $NmDir -Directory).Count
$sizeMb = [math]::Round(((Get-ChildItem $AppDir -Recurse -File |
    Measure-Object -Property Length -Sum).Sum / 1MB), 1)
Write-Host "payload  : $AppDir ($sizeMb MB, $nmCount packages)"

# -- 8. smoke: the staged app boots far enough to pass the TTY gate ------------
$env:DSH_TUI_BACKEND = 'hooh'
$env:DSH_TUI_LAUNCHER_VERSION = '0.0.0-payload-smoke'
$env:ACE_MOCK = '1'
# Same PS 5.1 discipline: both streams into a file via cmd, then read it.
$smokeOut = Join-Path $env:TEMP 'hooh-payload-smoke.log'
$nodeExe = Join-Path $AppDir 'node.exe'
$tsxJs = Join-Path $NmDir 'tsx\dist\cli.mjs'
$entry = Join-Path $UiDir 'backends\hooh\app-entry.ts'
cmd /c "`"$nodeExe`" `"$tsxJs`" `"$entry`" >`"$smokeOut`" 2>&1"
$code = $LASTEXITCODE
Remove-Item Env:\DSH_TUI_BACKEND -ErrorAction SilentlyContinue
Remove-Item Env:\DSH_TUI_LAUNCHER_VERSION -ErrorAction SilentlyContinue
Remove-Item Env:\ACE_MOCK -ErrorAction SilentlyContinue
$out = Get-Content $smokeOut -Raw -ErrorAction SilentlyContinue
if ($out -match 'requires an interactive terminal') {
    Write-Host "smoke    : OK (boot reached the TTY gate -- modules resolve, kernel registry loads)"
} elseif ($code -eq 0) {
    Write-Host "smoke    : OK (clean exit)"
} else {
    Write-Host "FAIL: staged app smoke failed (exit $code):"
    ($out -split "`r?`n" | Select-Object -Last 10) | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Host "OK: app payload staged."
exit 0
