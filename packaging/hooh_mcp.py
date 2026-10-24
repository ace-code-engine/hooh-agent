#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hooh_mcp.py -- frozen entry point for the self-contained MCP server.

Why this file exists
--------------------
The MCP pack (`packaging/mcp/`) used to ship **source only**: `ace-mcp.cmd` /
`ace-mcp.sh` look for `python3` on the host and bail out with exit 127 if it is
missing. That makes "attach HooH to Cline / Cursor / Claude Desktop" a task for
people who already have a Python toolchain -- the exact audience an MCP server
should NOT require that from.

This entry point exists so the pack can ship a **PyInstaller executable** that
carries its own interpreter. Same shape as the main build (`packaging/ace.spec`),
just aimed at the MCP door.

It adds NO logic of its own. The whole MCP path already exists and is shared:

    stdout swap -> build AgentCLI -> ai_code._run_mcp(cli, out)

That is what `ai_code.py --mcp` does. Duplicating any of it here would create a
second implementation to keep in sync, which is how the CLI and this server
would drift apart. The only thing this file owns is the *argument surface*: a
deliberate subset (see below), because a frozen server has no use for `--mock` /
`--tools` / `--install-ui` / REPL flags.

Argument surface (deliberately a subset)
----------------------------------------
    --project-root DIR      workspace the host's tool calls act on (default: cwd)
    --permission LEVEL      readonly | write | full            (default: readonly)
    --sandbox MODE          off | job | docker                 (default: off)
    --kb DIR                external knowledge base directory
    --skills DIR            file-based skills directory
    --approval-policy NAME  approval policy (see docs/CONFIGURATION.md)

Everything else stays configurable the normal way: `~/.ai_code.json`, project
`.ace/`, or environment variables -- `merge_config` handles all of them.

ASCII-only on purpose: this file is read on Windows by PyInstaller and this repo
has been burned twice by "BOM-less UTF-8 read as ANSI" (CHANGELOG v3.40.2,
REL-03). Comments in Chinese buy nothing here and cost risk.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _bootstrap_path() -> None:
    """Make the repo root importable in BOTH layouts this file runs in.

    - from a checkout:    packaging/hooh_mcp.py -> root is one level up
    - from a frozen exe:  modules are already inside the bundle and sys._MEIPASS
                          is on sys.path; the walk below finds it first.

    Walks up to the directory that actually holds ai_code.py instead of assuming
    "..", so moving this file one level down does not silently break it.
    """
    here = Path(__file__).resolve()
    for candidate in (here.parent, *here.parents):
        if (candidate / "ai_code.py").is_file():
            if str(candidate) not in sys.path:
                sys.path.insert(0, str(candidate))
            return


def _parse(argv=None):
    parser = argparse.ArgumentParser(
        prog="hooh-mcp",
        description="HooH MCP server -- the host does the thinking, HooH rules on "
                    "each tool call (permission gate / path boundary / audit).",
    )
    parser.add_argument("--project-root",
                        help="workspace the tool calls act on (default: current directory)")
    parser.add_argument("--permission", choices=["readonly", "write", "full"],
                        help="permission level (default: readonly)")
    parser.add_argument("--sandbox", choices=["off", "job", "docker"],
                        help="where terminal_exec / code_execute run "
                             "(off = host with in-process policy checks only)")
    parser.add_argument("--kb", help="external knowledge base directory")
    parser.add_argument("--skills", help="file-based skills directory")
    parser.add_argument("--approval-policy",
                        help="approval policy (see docs/CONFIGURATION.md)")
    return parser.parse_args(argv)


def _as_config_args(ns):
    """Fill in every attribute `ai_code.merge_config` touches.

    merge_config reads a few attributes directly (base_url / api_key / model /
    permission / project_root) and the rest through getattr. Instead of copying
    the CLI's whole argparse surface, hand it the complete set of names with None
    where this door has no opinion -- None means "not specified", which is
    exactly what merge_config expects.
    """
    for name in ("base_url", "api_key", "model", "sandbox_image"):
        if not hasattr(ns, name):
            setattr(ns, name, None)
    ns.tools = False          # the MCP door exposes the tool surface to the HOST
    ns.fullscreen = False
    ns.max_history = 0
    ns.context_window = 0
    ns.no_compact = False
    return ns


def main(argv=None) -> int:
    _bootstrap_path()

    # Imported after the path bootstrap; these are the same modules the CLI uses.
    import ai_code  # noqa: E402

    # Headless door: pin the conservative default explicitly (WP-AGENCY flipped
    # the interactive CLI default to "write"; an MCP exe driven by a host agent
    # must not inherit that).
    cfg = ai_code.merge_config(_as_config_args(_parse(argv)),
                               default_permission="readonly")

    # --- stdout is the PROTOCOL channel -------------------------------------
    # Same swap as ai_code.main()'s --mcp branch, for the same reason: one stray
    # character on stdout is a malformed JSON-RPC message and the host fails to
    # parse it. Swapping sys.stdout to stderr turns the engine's hundreds of
    # print() calls into host-visible logs without touching engine code. The
    # real protocol handle is kept aside and handed to McpServer.
    proto_out = sys.stdout
    sys.stdout = sys.stderr
    cfg["mcp"] = True
    cfg["_mcp_out"] = proto_out

    # ADR-002 guard: approval_policy=never with no kernel boundary has no
    # legitimate use. The CLI refuses early so the operator gets a sentence
    # instead of a traceback; the frozen server must behave identically.
    refusal = ai_code.execution_layer.policy_refusal_code(
        cfg.get("approval_policy"), cfg.get("sandbox", "off"),
        cfg.get("sandbox_policy"))
    if refusal:
        print(ai_code.c("red", ai_code.t("policy_refused_" + refusal)),
              file=sys.stderr)
        return 2

    cli = ai_code.AgentCLI(cfg)          # mock=False: this door never calls a model
    # The "where is this machine's boundary" line is printed INSIDE _run_mcp --
    # do not print it here too. It was duplicated in the first build of this
    # file, and a second copy of an operator-facing message is how the two
    # copies start disagreeing. One source: ai_code._run_mcp.
    return ai_code._run_mcp(cli, proto_out)


if __name__ == "__main__":
    sys.exit(main())
