@echo off
rem ACE launcher. Job: find a usable Python, then hand over to ai_code.py.
rem Usage: ace [args]    e.g.  ace --input "what time is it"  |  ace --install-ui  |  ace --setup
rem ---------------------------------------------------------------------------
rem ASCII-ONLY ON PURPOSE. Do not add non-ASCII text (Chinese, emoji, smart
rem quotes) to this file, not even inside rem comments or echo strings.
rem Why: cmd.exe tracks its position in a batch file by byte offset, and that
rem bookkeeping breaks when the file contains multi-byte characters while the
rem console code page changes (chcp 65001 below does exactly that). The symptom
rem is ugly and confusing: cmd resumes reading mid-line and executes the TAIL of
rem a comment as if it were a command, so the user sees
rem     'xxx' is not recognized as an internal or external command
rem with fragments of our own comments. All localized user-facing text lives in
rem Python (locales/*.json), which handles encoding properly.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
rem Set ACE_DIRECT_CHAT=1 to skip the landing screen and go straight to chat.
cd /d "%~dp0"

rem Interpreter resolution order:
rem   1) ACE_PYTHON environment variable (explicit choice)
rem   2) setup_env.py --print-python: ACE_PYTHON -> project .ace_env -> common
rem      local dev envs -> PATH, probing which one can really import the UI deps
rem   3) fall back to any interpreter that starts (works, minus the overlay menu)
rem   4) the py -3 launcher
set "_ACE_PROBE="
if defined ACE_PYTHON (set "_ACE_PROBE=%ACE_PYTHON%")
if not defined _ACE_PROBE (if exist "C:\aider_env\Scripts\python.exe" set "_ACE_PROBE=C:\aider_env\Scripts\python.exe")
if not defined _ACE_PROBE (if exist ".ace_env\Scripts\python.exe" set "_ACE_PROBE=.ace_env\Scripts\python.exe")
if not defined _ACE_PROBE (where python >nul 2>nul && python -c "import sys" >nul 2>nul && set "_ACE_PROBE=python")
if not defined _ACE_PROBE (where py >nul 2>nul && set "_ACE_PROBE=py -3")

set "_ACE_PY="
if defined ACE_PYTHON (set "_ACE_PY=%ACE_PYTHON%")
if not defined _ACE_PY (if defined _ACE_PROBE if exist "setup_env.py" (
    for /f "usebackq delims=" %%p in (`%_ACE_PROBE% "setup_env.py" --print-python 2^>nul`) do set "_ACE_PY=%%p"
))
if not defined _ACE_PY (if defined _ACE_PROBE set "_ACE_PY=%_ACE_PROBE%")

if not defined _ACE_PY (
    echo [ACE] No usable Python found. Install 3.10+ and put it on PATH,
    echo       or set ACE_PYTHON to the full path of your python.exe.
    pause
    exit /b 1
)

rem --setup / --install-ui: prepare UI deps first, then start.
if /i "%~1"=="--setup" (
    "%_ACE_PY%" setup_env.py --ensure || goto :env_failed
    shift
)
if /i "%~1"=="--install-ui" (
    "%_ACE_PY%" setup_env.py --ensure || goto :env_failed
    shift
)

rem ---------------------------------------------------------------------------
rem `ace proxy [args]`: start the OpenAI-compatible endpoint that lets dsh-TUI
rem (its UI, its keybindings) drive ace's engine. Socket stays on 127.0.0.1.
rem MUST be handled before the frontend dispatch below -- otherwise "proxy"
rem is just an unknown argv token that gets passed to the Ink frontend, which
rem ignores it and starts the normal UI instead.
rem See docs/design/DSH-TUI-BRIDGE.md.
rem ---------------------------------------------------------------------------
if /i "%~1"=="proxy" (
    shift
    "%_ACE_PY%" tools\ace_openai_proxy.py %*
    goto :eof
)

rem ---------------------------------------------------------------------------
rem `ace tui [args]`: dsh-TUI's UI driving ace's engine.
rem
rem This is the B bridge (docs/design/DSH-TUI-BRIDGE.md). It starts the local
rem OpenAI-compatible endpoint, then hands over to dsh-tui -- the UI is theirs,
rem the agent loop/tools/permissions are ours. ace's own Ink frontend is NOT
rem what you get here; use plain `ace` for that.
rem
rem ONE-TIME setup, inside dsh-tui:  /provider -> add custom
rem   baseURL   http://127.0.0.1:8787/v1
rem   protocol  openai-completions
rem   apiKey    anything (ace does not check it)
rem   models    pick the discovered entry "ace", then /model ace
rem ---------------------------------------------------------------------------
if /i "%~1"=="tui" (
    shift
    where dsh-tui >nul 2>nul
    if errorlevel 1 (
        echo [HooH] dsh-tui was not found on PATH. Install it first:
        echo           npm i -g @deepseek-harness-tui/dsh-tui
        pause
        exit /b 1
    )
    rem PARENS ARE BANNED INSIDE THIS BLOCK - echo, rem, everything. Inside an
    rem if-block cmd closes the block at the FIRST bare close-paren it scans,
    rem even inside a rem or an echo: the rest of the block then runs
    rem unconditionally on EVERY launch. That is exactly how plain "ace" ended
    rem up in dsh-tui on 2026-10-24 - the user saw it auto-route to the dsh UI
    rem and never reached the real frontend dispatch. Escape with ^ if you must.
    echo [HooH] ace engine endpoint: http://127.0.0.1:8787/v1  - model: ace
    echo        First run only, inside dsh-tui: /provider  then add a custom one
    echo          baseURL   http://127.0.0.1:8787/v1
    echo          protocol  openai-completions
    echo          apiKey    anything - not checked
    echo        then pick the discovered model "ace" and run /model ace
    rem Branding + provider route, idempotent: dsh-tui splash says HooH, the
    rem whale is off, and the "ace" route points at the endpoint below.
    "%_ACE_PY%" "%~dp0tools\dsh_bridge_setup.py"
    start "ace-proxy" /min "%_ACE_PY%" "%~dp0tools\ace_openai_proxy.py" --project-root "%~dp0" --permission readonly
    dsh-tui %*
    goto :eof
)

rem ---------------------------------------------------------------------------
rem Frontend dispatch (2026-10-31 REVERTED to classic-default): the vendored
rem dsh shell (frontend/dsh-ui, `ace ui`) self-exits its ink app ~370ms after
rem mount -- it has never been fully alive in this repo (its baseline smoke
rem was failing). Until that is fixed, the WORKING UI is frontend/src.
rem The global npm dsh-tui is never invoked from this launcher.
rem PARENS ARE BANNED inside if-blocks here - see the tui block above.
rem Batch quirks: shift does NOT affect %*, undefined vars expand literally.
rem ---------------------------------------------------------------------------
set "_ACE_REST="
if /i "%~1"=="ui" (
    if not "%~2"=="" for /f "tokens=1,* delims= " %%a in ("%*") do set "_ACE_REST=%%b"
    goto :fe_shell
)
goto :fe_frontend

:fe_frontend
if defined ACE_LEGACY_UI goto :ace_python
where node >nul 2>nul
if errorlevel 1 (
    echo [HooH] Node was not found on PATH -- the Ink frontend needs Node 18+.
    echo       Falling back to the Python REPL.
    goto :ace_python
)
if not exist "frontend\node_modules\tsx\dist\cli.mjs" (
    echo [HooH] frontend dependencies are not installed yet.
    echo       Install them once with:
    echo           cd frontend
    echo           npm install
    echo       Falling back to the Python REPL for now.
    goto :ace_python
)
rem tsx discovers tsconfig.json from the CURRENT DIRECTORY, not from the
rem location of the file it is given. Run it from the repo root and it finds
rem no tsconfig, falls back to the classic JSX transform, and the first
rem render() dies with "React is not defined" -- while "npm start" keeps
rem working, because there the cwd is frontend. So run it from frontend too.
pushd "%~dp0frontend"
node "node_modules\tsx\dist\cli.mjs" "src\index.tsx" %*
rem Double-click survival: a nonzero exit here closed the window instantly -
rem the user saw a flash and could never read the error. Hold it open.
if errorlevel 1 pause
popd
goto :eof

:fe_shell
if defined ACE_LEGACY_UI goto :ace_python
where node >nul 2>nul
if errorlevel 1 (
    echo [HooH] Node was not found on PATH -- the Ink frontend needs Node 18+.
    echo       Falling back to the Python REPL.
    goto :ace_python
)
if not exist "frontend\node_modules\tsx\dist\cli.mjs" (
    echo [HooH] frontend dependencies are not installed. Run: ace --install-ui
    pause
    exit /b 1
)
pushd "%~dp0frontend"
node "node_modules\tsx\dist\cli.mjs" "dsh-ui\hooh\entry.tsx" %_ACE_REST%
rem Double-click survival: hold the window open on failure.
if errorlevel 1 pause
popd
goto :eof

:ace_python
"%_ACE_PY%" ai_code.py --tools --max-history 12 %*
goto :eof

:env_failed
echo [ACE] Environment setup failed ^(reason above^). Offline install: drop the
echo       wheels into vendor\ and retry.
pause
exit /b 1
