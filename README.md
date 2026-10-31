# HooH

<div align="center">

<img src="assets/logo.svg" width="96" alt="HooH" />

### An execution layer that places the safety boundary **below the model**.

**The model proposes; code decides.**

[English](README.md) · [简体中文](README.zh-CN.md) · [Release notes](UPDATES.md) · [Docs](docs/README.md) · [Contributing](CONTRIBUTING.md)

[![CI](https://github.com/ace-code-engine/hooh-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/Version-1.2.0-7DA1DE)](https://github.com/ace-code-engine/hooh-agent/releases)
[![Release](https://img.shields.io/github/v/release/ace-code-engine/hooh-agent?label=Download&color=7DA1DE)](https://github.com/ace-code-engine/hooh-agent/releases)
<a href="CHANGELOG.md"><img alt="Latest" src="https://img.shields.io/badge/latest-v1.2.0%20(2026--10--31)-7DA1DE"></a>
[![License](https://img.shields.io/badge/License-MIT-7DA1DE)](LICENSE)
[![Safety core](https://img.shields.io/badge/safety%20core-zero--dep-orange)](docs/security/SECURITY-MODEL.md)
[![Model API](https://img.shields.io/badge/model%20API-requires%20requests-blue)](docs/CONFIGURATION.md)
[![UI](https://img.shields.io/badge/UI-en%20%C2%B7%20zh%20%C2%B7%20ja-7DA1DE)](#three-shells)
[![Security](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml/badge.svg?label=Security%20scans)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml)
[![CodeQL](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml/badge.svg?event=push&label=CodeQL)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/badge/github/ace-code-engine/hooh-agent)](https://securityscorecards.dev/viewer?uri=github.com/ace-code-engine/hooh-agent)
[![Bandit](https://img.shields.io/badge/Bandit-clean-4C1)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml)
[![pip-audit](https://img.shields.io/badge/pip--audit-clean-4C1)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml)

</div>

---

## What it is

Every tool call — files, commands, network, MCP — passes through a single decision point:
**permission gate → path & sensitive-target boundary → write-ahead snapshot → HMAC-chained audit**.
The safety core is **pure standard library**: the boundary holds when the prompt does not
(jailbreak, injected content, tampered tool output).

> **互 (HooH)** — *mutual*: two horizontal bones locked by one vertical stroke. Every action
> gets an equal and reversible response. A snapshot is written before every write, so `/undo`
> always has something to undo. The name is a tribute — see [the note below](#naming--credits).

## What makes it different

- **Safety below the model, not in the prompt.** Permissions, paths, sandbox and rollback are harness code.
- **Read-only by default.** Elevation is a human action (`/permission write`).
- **Snapshot + `/undo`** on every write, HMAC-signed, not writable by the agent.
- **Self-driven.** Persistent goals, subagents, a knowledge base, and one command to switch among **9 vendors · 10 endpoints**.
- **Three shells, one engine.** The full dsh-TUI multi-kernel UI / a Swiss-spec classic frontend / a pure-Python fallback — the decision chain stays singular.

## Get it: double-click and go

**No error-reading, no Python install, no Node install.** Grab the installer, double-click, click **HooH** in the Start menu:

| Your situation | Download | How to use |
|---|---|---|
| Windows, want it working | **`hooh-<ver>-windows-amd64.msi`** | Double-click → Start menu → **HooH** (ships Python runtime + full UI + Node) |
| Portable (unzip, no system install) | **`hooh-<ver>-windows-amd64.zip`** | Unzip → double-click `ace.cmd` |
| Wire HooH into another agent (Cline / Claude Desktop / Cursor) | **`hooh-mcp-<ver>-<platform>.zip`** | Configure per [docs/MCP-SERVER.md](docs/MCP-SERVER.md) — the boundary, without changing your agent |
| Source folks | `git clone` this repo | `hooh.cmd --mock` for the offline demo / `hooh.cmd` for a real model |

**Only these artefacts ship**; the MSI is self-contained (engine + full UI + Node runtime) and runs `--mock` offline.

**[Download the latest release](https://github.com/ace-code-engine/hooh-agent/releases)** · [Release notes](UPDATES.md) · [Open an issue](https://github.com/ace-code-engine/hooh-agent/issues/new/choose)

## 30 seconds in

```text
Double-click HooH (or run `ace` in a terminal)
  ↓
Type a sentence, press Enter
  ↓
When it needs to write/run, HooH asks first → snapshots → then acts
  ↓
Unhappy? /undo rolls back to before the action
```

From source: `hooh.cmd --mock` (offline demo, no key, no network) · `hooh.cmd` (real model, guided setup).
The full slash-command reference is **[docs/COMMANDS.md](docs/COMMANDS.md)**.

## What it can do

- **Act**: files, commands, code, web search, document parsing (Word/Excel/PPT/PDF), SQLite, a browser — each through the decision chain;
- **Guard**: read-only by default, elevation requires approval; a snapshot precedes every write (HMAC-chained audit); `/undo` rolls back;
- **Drive**: persistent goals (resume across restarts), subagents, a task tree, a knowledge base, plan mode;
- **Connect**: an MCP server (lend the decision boundary to other agents), event hooks, custom commands and skills;
- **Switch**: 9 model vendors · 10 endpoints in one command; en/zh/ja UI.

**What does HooH block, and what does it not?** Read **[docs/security/SECURITY-FAQ.md](docs/security/SECURITY-FAQ.md)** — eleven questions, answered.

## Three shells

| Shell | Entry | Looks like | For |
|---|---|---|---|
| **Full app** (default) | HooH double-click / `ace` | The dsh-TUI multi-kernel UI: landing page, streaming Markdown, tool cards, status bar, command palette | Daily use |
| **Classic frontend** | `ace classic` | Swiss-spec UI: two-lane main screen, one accent colour per screen | Fallback (frozen, bug-fix only) |
| **Pure Python** | `ace --no-tui` | A plain REPL with no UI dependency | Scripts / CI / old terminals |

Behind all three sits **the same engine and the same decision chain** — the shell can change, the safety boundary does not.

## Docs

| Looking for | Go here |
|---|---|
| 5-minute start · ten classic traps | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) |
| What HooH blocks / does not | [docs/security/SECURITY-FAQ.md](docs/security/SECURITY-FAQ.md) |
| Layered architecture · full tree · ADRs | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Every command and flag | [docs/COMMANDS.md](docs/COMMANDS.md) |
| Every config key | [docs/CONFIGURATION.md](docs/CONFIGURATION.md) |
| Why HooH · vs prompt guardrails | [docs/WHY.md](docs/WHY.md) |
| Capability list | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) |
| Packaging & release (MSI / zip / MCP / sandbox) | [docs/PACKAGING-EXE.md](docs/PACKAGING-EXE.md) |
| Tests · CI · promise guards | [docs/TESTING.md](docs/TESTING.md) |
| Engineering debt · handoff | [docs/HANDOFF.md](docs/HANDOFF.md) |
| Full docs index | [docs/README.md](docs/README.md) |

## Contributing

Found a trap, have an idea, want to add a feature — start at **[CONTRIBUTING.md](CONTRIBUTING.md)**:
environment → standard flow → the eight-step add-a-tool checklist → PR.
User-visible changes per release are summarised in **[UPDATES.md](UPDATES.md)**; technical detail in [CHANGELOG.md](CHANGELOG.md).

> The author is a student: weekdays are for classes, issues / PRs are handled on weekends.
> Messages are read and noted — no rush.

## Security scanning (authoritative line)

CI runs a **Security workflow** separate from tests — four authoritative scanners in parallel, results in the GitHub Security tab:

| Scanner | What it covers | Authority |
|---|---|---|
| **CodeQL** (GitHub native) | Static taint/injection analysis for Python + TypeScript (security-extended) | GitHub's own SAST, reviewable findings |
| **Bandit** | Python SAST; medium+medium confidence fails the build (every exception carries a `# nosec` + compensating-control note, manually triaged) | Industry-standard Python SAST |
| **pip-audit** | Dependency CVEs (locked runtime + every package in the build env) | PyPA's official auditor, `--strict` |
| **OpenSSF Scorecard** | Supply-chain maturity (branch protection / pinned deps / SAST presence / token permissions) | Published by OpenSSF infra, publicly queryable |

Each one is a **standing CI gate**: any red blocks the PR — not a screenshot of a one-off run.

## Security

- Read-only by default; a physical snapshot precedes every write, failures roll back, the snapshot dir is not writable by the agent;
- Permission gate, path & sensitive-target boundary, HMAC-chained audit — all harness code, none of it in the prompt;
- Egress through a single gate (pin-to-IP + per-hop re-check); commands get a three-way verdict (allow / prompt / forbidden);
- Full model: **[docs/security/SECURITY-MODEL.md](docs/security/SECURITY-MODEL.md)**; release commitments: **[SECURITY.md](SECURITY.md)**.

## Naming & credits

**HooH (互)** is **a tribute, not an asset grab**. 互 is the shape of this system: the model
proposes, code decides; a snapshot first, so `/undo` means something. The repo contains **no
HoYoverse assets** — that sentence covers **naming and assets only**, not third-party code:
adapted sources and text are listed in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
The visual language (the 互 geometric mark, three horizontals one vertical) is drawn from scratch —
no tracing, no extraction, no redistribution.

> The author is a long-time HoYoverse player; the name salutes the "Equilibrium" aeon of
> *Honkai: Star Rail*. If HoYoverse (or any rights holder) finds the naming unfitting,
> **one issue and it changes** — no argument, no delay.

## License

[MIT](LICENSE) © 2026 jincheng3870682453-hash

Third-party notices: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) — this repo both
redistributes unmodified third-party wheels and **adapts** third-party sources and text;
item by item in that file.
