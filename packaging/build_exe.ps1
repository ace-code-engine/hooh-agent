# ============================================================================
# build_exe.ps1 -- build and SMOKE-TEST the ACE Windows release (PyInstaller).
#
# WHY THE SMOKE GATE EXISTS
#   A frozen build fails in ways a source run never shows: resource files that
#   were never bundled, hidden imports that only resolve at runtime, and code
#   that assumes sys.executable is a Python interpreter. Shipping an exe that
#   was never run is how you find those out from users. So this script will not
#   report success without running the packaged ace.exe through real checks.
#
# ASCII-ONLY ON PURPOSE. Windows PowerShell 5.1 reads a BOM-less script as ANSI,
#   and this repository has been bitten by that more than once (CHANGELOG
#   v3.40.2, the REL-03 smoke script, and this very file once). Non-ASCII here
#   does not degrade gracefully: it turns into mojibake, which breaks quoting,
#   which breaks the whole parse. Keep every byte ASCII, comments included.
#
# USAGE
#   powershell -NoProfile -ExecutionPolicy Bypass -File packaging/build_exe.ps1
#   ... -Python C:\path\to\python.exe   pick the interpreter to freeze with
#   ... -Python python                  a command name is fine too (Get-Command)
#   ... -Clean                          wipe build/ and dist/ first
#   ... -SkipSmoke                      build only (prints a loud warning)
#
# REQUIREMENTS
#   PyInstaller must be importable by the chosen interpreter:
#       <python> -m pip install pyinstaller
#   **requests must be installed too.** In a source run ace_net/ace_http import
#   requests lazily and degrade without it, so --mock works fine; but freezing
#   decides which modules get bundled AT BUILD TIME, and once frozen ace_net
#   requires requests with no fallback left in the vendor layer. Leave it out of
#   the build env and the --preview smoke fails looking like "missing requests"
#   rather than "the package is wrong", which is a confusing trail to follow.
#   Freezing with 3.10-3.12 is safer than 3.13 for third-party wheels, but the
#   core is pure stdlib so any 3.10+ should work.
#
# EXIT: 0 = built AND every smoke scenario passed. 1 = anything failed.
# ============================================================================
[CmdletBinding()]
param(
    [string]$Python = "",
    [switch]$Clean,
    [switch]$SkipSmoke
)

$ErrorActionPreference = 'Continue'
$Here  = Split-Path -Parent $PSCommandPath       # .../ace/packaging
$Repo  = Split-Path -Parent $Here                # .../ace
$Dist  = Join-Path $Repo 'dist'
$Build = Join-Path $Repo 'build'
$Spec  = Join-Path $Here 'ace.spec'
$Requested = $Python

Write-Host "repo      : $Repo"
Write-Host "spec      : $Spec"

# -- 1. interpreter ----------------------------------------------------------
# -Python / ACE_PYTHON may be EITHER a path OR a command name (e.g. "python").
# Testing only with Test-Path is not enough, in two different ways:
#   1) `Test-Path 'python'` is False for a command name -- that is exactly how CI
#      failed with `-Python python` -> "FAIL: no usable interpreter";
#   2) a path that EXISTS may still not be runnable: Windows puts a zero-byte
#      App Execution Alias for the Store Python on PATH, and Test-Path reports it
#      as a file while invoking it fails with 9009. Picking it would look like a
#      resolved interpreter and then die later at the PyInstaller probe.
# So the rule here is: resolve to a real file AND actually run it once.
function Test-PythonRuns([string]$Exe) {
    if (-not $Exe) { return $false }
    try {
        $out = & $Exe -c "import sys; print('ok')" 2>$null
    } catch { return $false }
    return ($LASTEXITCODE -eq 0) -and ("$out".Trim() -eq 'ok')
}

function Resolve-PythonPath([string]$Candidate) {
    if (-not $Candidate) { return $null }
    $paths = @()
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
        $paths += (Resolve-Path -LiteralPath $Candidate).Path
    } else {
        $paths += (Get-Command $Candidate -ErrorAction SilentlyContinue |
                   Where-Object { $_.CommandType -eq 'Application' } |
                   ForEach-Object { $_.Source })
    }
    foreach ($p in $paths) {
        if ((Test-Path -LiteralPath $p -PathType Leaf) -and (Test-PythonRuns $p)) { return $p }
    }
    return $null
}

if ($Requested) {
    $Python = Resolve-PythonPath $Requested
    if (-not $Python) {
        Write-Host "FAIL: -Python '$Requested' is neither an existing file nor a runnable command."
        Write-Host "      (A file that exists but cannot be executed counts as neither --"
        Write-Host "       this is what the Store's zero-byte python.exe stub looks like.)"
        exit 1
    }
} else {
    $cands = @()
    if ($env:ACE_PYTHON) { $cands += $env:ACE_PYTHON }
    $cands += 'C:\aider_env\Scripts\python.exe'
    $cands += (Join-Path $Repo '.ace_env\Scripts\python.exe')
    $cands += 'python'
    $cands += 'python3'
    $cands += 'py'
    $Python = $null
    foreach ($c in $cands) {
        $Python = Resolve-PythonPath $c
        if ($Python) { break }
    }
}
if (-not $Python) {
    Write-Host "FAIL: no usable interpreter. Pass -Python <path or command>, or set ACE_PYTHON."
    exit 1
}
Write-Host "interpreter: $Python"

# -- 2. PyInstaller present? -------------------------------------------------
$pyi = (& $Python -c "import importlib.util as u; print('yes' if u.find_spec('PyInstaller') else 'no')" 2>&1) -join ''
if ($pyi.Trim() -ne 'yes') {
    Write-Host ""
    Write-Host "FAIL: PyInstaller is not importable by this interpreter."
    Write-Host "      Install it, then re-run:"
    Write-Host ("        `"" + $Python + "`" -m pip install pyinstaller")
    Write-Host ""
    Write-Host "      If pip cannot reach an index, this machine is offline for PyPI and"
    Write-Host "      the build must run where the network works (or from a local wheel)."
    exit 1
}
$pyiVer = (& $Python -c "import PyInstaller; print(PyInstaller.__version__)" 2>&1) -join ''
Write-Host "PyInstaller: $($pyiVer.Trim())"

# -- 3. requests present? ----------------------------------------------------
# Not a hard requirement for the CORE, but it is for the frozen build: see the
# header note. Checked here so the failure names the real cause.
$req = (& $Python -c "import importlib.util as u; print('yes' if u.find_spec('requests') else 'no')" 2>&1) -join ''
if ($req.Trim() -ne 'yes') {
    Write-Host ""
    Write-Host "FAIL: 'requests' is not importable by this interpreter."
    Write-Host "      The frozen bundle needs it (ace_net imports it at runtime with no"
    Write-Host "      fallback once frozen). Install it and re-run:"
    Write-Host ("        `"" + $Python + "`" -m pip install requests")
    exit 1
}
Write-Host "requests   : present"

# -- 4. clean ----------------------------------------------------------------
if ($Clean) {
    foreach ($d in @($Dist, $Build)) {
        if (Test-Path $d) { Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue; Write-Host "removed $d" }
    }
}

# -- 5. build ----------------------------------------------------------------
# --noconfirm: the spec drives the layout; we do not want an interactive prompt
# in a script. --clean: drop PyInstaller's own cache so a stale hook cannot
# silently keep a removed module in the bundle.
Write-Host ""
Write-Host "=== building (this takes a few minutes) ==="
Push-Location $Repo
try {
    & $Python -m PyInstaller --noconfirm --clean --distpath $Dist --workpath $Build $Spec 2>&1 |
        Tee-Object -Variable buildOut | Select-Object -Last 25
    $buildCode = $LASTEXITCODE
} finally { Pop-Location }
if ($buildCode -ne 0) { Write-Host "FAIL: PyInstaller exited $buildCode"; exit 1 }

$ExePath = Join-Path $Dist 'ace\ace.exe'
if (-not (Test-Path $ExePath)) { Write-Host "FAIL: expected artifact not found: $ExePath"; exit 1 }
$sizeMb = [math]::Round(((Get-ChildItem (Join-Path $Dist 'ace') -Recurse -File |
    Measure-Object -Property Length -Sum).Sum / 1MB), 1)
Write-Host ""
Write-Host "artifact : $ExePath"
Write-Host "size     : $sizeMb MB (whole folder)"

if ($SkipSmoke) {
    Write-Host ""
    Write-Host "WARN: -SkipSmoke was passed. This build has NOT been run."
    Write-Host "      Do not publish it as working. Re-run without -SkipSmoke."
    exit 0
}

# -- 6. smoke ----------------------------------------------------------------
# Every scenario is judged on: exit code 0, no traceback, no UnicodeEncodeError,
# no wrong glyphs, and the expected user-visible text actually present. A frozen
# build can pass "it starts" while failing to find prompts/ or locales/, so the
# assertions look for CONTENT, not just for a clean exit.
$evidence = Join-Path $Repo 'packaging\_smoke'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$results = @()

function Invoke-Smoke {
    # NOTE on the parameter name: it is $ExeArgs, NOT $Args. "$Args" is a
    # PowerShell automatic variable, so a parameter called that stays EMPTY --
    # every scenario then ran the exe with no arguments at all and reported
    # "Cannot validate argument on parameter 'ArgumentList'". The call sites use
    # -ExeArgs for the same reason: binding to "-Args" is swallowed even when the
    # declared parameter is named something else.
    param([string]$Name, [string[]]$ExeArgs, [string]$Mark)
    $outFile = Join-Path $evidence ("{0}.txt" -f ($Name -replace '[^A-Za-z0-9]', '_'))
    $errFile = "$outFile.err"
    foreach ($f in @($outFile, $errFile)) { if (Test-Path $f) { Remove-Item $f -Force } }
    Write-Host ""
    Write-Host "[smoke] $Name"
    Write-Host "        $ExePath $($ExeArgs -join ' ')"

    # Invoked with the call operator, NOT Start-Process. Start-Process joins
    # -ArgumentList into a single command line using C-runtime quoting rules, and
    # an argument containing spaces ("what time is it") reaches the child split
    # into separate words -- argparse then fails with "unrecognized arguments:
    # time is it". The call operator passes the argument vector to the process
    # directly, so quoting stays PowerShell's job, not ours.
    #
    # Exit code: for a native command $LASTEXITCODE holds it -- but only if the
    # command actually ran, so reset it first; otherwise a launch failure would
    # be read as the previous scenario's success.
    $global:LASTEXITCODE = 0
    & $ExePath @ExeArgs > $outFile 2> $errFile
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 1 }
    # ReadAllText (not Get-Content -Raw): it always returns a string -- an empty
    # file makes Get-Content -Raw return an array, and BOM handling is then left
    # to Encoding.UTF8 rather than to PowerShell's own guesswork.
    $raw = ''
    if (Test-Path $outFile) { $raw = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8) }
    $err = ''
    if (Test-Path $errFile) { $err = [System.IO.File]::ReadAllText($errFile, [System.Text.Encoding]::UTF8) }
    $all = "$raw`n$err"
    $okMark   = $all -match [regex]::Escape($Mark)
    $okClean  = -not ($all -match 'Traceback \(most recent call last\)')
    $okEnc    = -not ($all -match 'UnicodeEncodeError')
    $okMojib  = -not ($all -match ([char]0xFFFD))
    $ok = ($code -eq 0) -and $okMark -and $okClean -and $okEnc -and $okMojib
    $script:results += [pscustomobject]@{
        scenario = $Name; exit = $code; mark = $okMark;
        clean = $okClean; encoding = $okEnc; verdict = $(if ($ok) { 'PASS' } else { 'FAIL' })
    }
    Write-Host ("        exit={0}  mark={1}  clean={2}  encoding={3}  -> {4}" -f `
                $code, $okMark, $okClean, $okEnc, $(if ($ok) { 'PASS' } else { 'FAIL' }))
    if (-not $ok) {
        Write-Host "        --- output tail (raw evidence: $outFile) ---"
        ($all -split "`r?`n" | Select-Object -Last 15) | ForEach-Object { Write-Host "        $_" }
    }
}

# Every mark below is text the scenario ALWAYS produces -- checked against a real
# run first, not assumed. The earlier set included a mark ('code_execute') for a
# tool the scripted mock model never calls, so that assertion could never pass
# no matter how correct the package was.

# 1) --version: proves the exe starts at all (no resource access yet).
#    Mark is 'HooH ' (brand rename 2026-10-31: the banner prints HooH x.y.z).
#    number carries no "v" prefix, and the earlier mark never matched.
Invoke-Smoke -Name 'version' -ExeArgs @('--version') -Mark 'HooH '

# 2) --preview: draws the landing screen. This is the one that catches MISSING
#    RESOURCES - it reads locales/ for every label and assets/ for the logo.
Invoke-Smoke -Name 'preview' -ExeArgs @('--preview', '--preview-width', '80') -Mark 'HooH '

# 3) offline end-to-end with the scripted model: a real tool round trip, and a
#    real answer rendered from the bundled prompts/locales.
#
#    The expected text is BUILT FROM CODE POINTS instead of being written
#    literally. Reason: this file must stay ASCII, and the assertions need to
#    match Chinese output. The first version of these marks embedded the actual
#    characters, which turned the file non-ASCII, and PowerShell 5.1 read the
#    BOM-less UTF-8 as ANSI -- mojibake, off-by-one quoting, and the whole
#    script failed to PARSE on the CI runner. (The unit-test suite caught
#    nothing because test_all runs the script with pwsh on this machine, where
#    the file reads fine. Only Windows PowerShell 5.1 trips on it.)
#    Even the COMMENTS here must stay ASCII -- writing the characters out to
#    "document" the code points is enough to break the parse.
#    U+5F53 U+524D U+65F6 U+95F4 = "current time": what the mock answer contains.
$currentTime = [string]([char]0x5F53 + [char]0x524D + [char]0x65F6 + [char]0x95F4)
#    U+73B0 U+5728 U+51E0 U+70B9 U+4E86 = "what time is it now": a prompt typed
#    in Chinese, to prove non-ASCII input survives the pipeline.
$promptZh = [string]([char]0x73B0 + [char]0x5728 + [char]0x51E0 + [char]0x70B9 + [char]0x4E86)

# Smoke workspace lives in TEMP, not under the repo: a repo-relative path
# can sit inside an editor/sandbox ACL scope that denies the frozen exe the
# .guardian snapshot dir it must create (observed WinError 5 on 2026-10-31).
$ws = Join-Path ([System.IO.Path]::GetTempPath()) ('hooh-smoke-ws-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $ws | Out-Null
Invoke-Smoke -Name 'mock_turn' -ExeArgs @('--mock', '--no-tui', '--permission', 'readonly',
                                          '--project-root', $ws, '--input', 'what time is it') `
             -Mark $currentTime

# 4) the native tool-call path in the frozen bundle (--tools + full permission).
#    Same mock flow, but through function calling rather than the text protocol.
Invoke-Smoke -Name 'native_tools' -ExeArgs @('--mock', '--no-tui', '--tools',
                                             '--permission', 'full',
                                             '--project-root', $ws, '--input', $promptZh) `
             -Mark $currentTime

# NOTE: "code_execute returns 501 when frozen" is deliberately NOT a smoke
# scenario. The scripted mock model never calls code_execute, so there is no CLI
# invocation that reaches it from the exe. That behaviour is asserted directly in
# test_all [10] instead (patching sys.frozen and driving the tool), which is the
# right place for it -- a smoke gate should only assert things it can actually
# observe.

Write-Host ""
Write-Host "==================== smoke summary ===================="
$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

$failed = @($results | Where-Object { $_.verdict -ne 'PASS' })
if ($failed.Count -gt 0) {
    Write-Host ("FAIL: {0}/{1} smoke scenarios failed -- do NOT publish this build" -f $failed.Count, $results.Count)
    exit 1
}
Write-Host ("OK: {0}/{0} smoke scenarios passed" -f $results.Count)
Write-Host ""
Write-Host "package to publish : $Dist\ace   (zip the folder)"
Write-Host "reminder           : code_execute is intentionally 501 in this form;"
Write-Host "                     --install-ui / --setup have no meaning when frozen."
exit 0
