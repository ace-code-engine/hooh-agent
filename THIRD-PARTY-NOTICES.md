# Third-party notices

This project is MIT-licensed (see [`LICENSE`](LICENSE)) — but it is **not** free of
third-party code or text. It does a few different things with other people's work, and the
sections below cover them separately.

1. **Redistributes** the third-party Python packages in
   [Redistributed packages](#redistributed-packages), as unmodified wheels in
   [`vendor/`](vendor/) (3.5 MB, 16 wheels) — that directory is committed on purpose so an
   offline or air-gapped machine can `setup_env.py --ensure` without a package index.
   See [`vendor/README.md`](vendor/README.md) for why. Each wheel is byte-for-byte the file
   published by its upstream project: **not** patched, **not** repackaged, **not** stripped.
   Every wheel carries its own full license text inside `<pkg>-<ver>.dist-info/licenses/`,
   and those texts ship with this repository, so the attribution below is an index rather
   than a substitute.
2. **Adapts source code and text** from the projects in
   [Adapted source & text](#adapted-source--text), and, for dsh-TUI, **vendors** the render
   kernel byte-for-byte. Adapted files are *derived* files, not
   byte-for-byte upstream copies: upstream copyright and license terms apply to whatever we
   ship from them, and any inline license header in an upstream file is kept verbatim.

## Redistributed packages

| Package | Version | License | Upstream |
|---|---|---|---|
| certifi | 2026.7.22 | **MPL-2.0** | https://github.com/certifi/python-certifi |
| charset-normalizer | 3.5.1 | MIT | https://github.com/jawah/charset_normalizer |
| idna | 3.20 | BSD-3-Clause | https://github.com/kjd/idna |
| linkify-it-py | 2.2.0 | MIT | https://github.com/tsutsu3/linkify-it-py |
| markdown-it-py | 4.2.0 | MIT | https://github.com/executablebooks/markdown-it-py |
| mdit-py-plugins | 0.6.1 | MIT | https://github.com/executablebooks/mdit-py-plugins |
| mdurl | 0.1.2 | MIT | https://github.com/executablebooks/mdurl |
| platformdirs | 4.11.12 | MIT | https://github.com/tox-dev/platformdirs |
| prompt_toolkit | 3.0.53 | BSD-3-Clause | https://github.com/prompt-toolkit/python-prompt-toolkit |
| Pygments | 2.21.0 | BSD-2-Clause | https://pygments.org/ |
| requests | 2.34.2 | Apache-2.0 | https://github.com/psf/requests |
| rich | 15.0.0 | MIT | https://github.com/Textualize/rich |
| textual | 8.2.8 | MIT | https://github.com/Textualize/textual |
| typing_extensions | 4.16.0 | PSF-2.0 | https://github.com/python/typing_extensions |
| urllib3 | 2.8.0 | MIT | https://github.com/urllib3/urllib3 |
| wcwidth | 0.8.4 | MIT | https://github.com/jquast/wcwidth |

## Adapted source & text

These are, except where a row says otherwise, **not** byte-for-byte upstream files: this
project adapts code and UI text from them. The upstream copyright and license terms apply to
the adapted parts, and the attribution lands here **before** the first byte does, not after.

| Project | Version | License | Obligations | Landed in this repo |
|---|---|---|---|---|
| dsh-TUI (`@deepseek-harness-tui/dsh-tui`) | 0.12.0 | MIT | Keep the upstream copyright + permission notice with every adapted or copied part | **Landed 2026-10-04** — render kernel vendored byte-for-byte, 135 files / 27,890 lines, at [`frontend/vendor/dsh-ink/`](frontend/vendor/dsh-ink/); per-file provenance in its [`MANIFEST.md`](frontend/vendor/dsh-ink/MANIFEST.md); per-part upstreams in [`third_party/dsh-tui/NOTICE.md`](third_party/dsh-tui/NOTICE.md) |

The dsh-TUI render kernel has landed: 135 upstream files, copied byte-for-byte into
[`frontend/vendor/dsh-ink/`](frontend/vendor/dsh-ink/), carrying the upstream MIT text as
[`LICENSE.upstream`](frontend/vendor/dsh-ink/LICENSE.upstream) (SHA256 identical to the
upstream `LICENSE`). It requires no private package. Its per-file table lives in
[`frontend/vendor/dsh-ink/MANIFEST.md`](frontend/vendor/dsh-ink/MANIFEST.md).
[`third_party/dsh-tui/NOTICE.md`](third_party/dsh-tui/NOTICE.md) lists the
upstreams of the parts *inside* dsh-TUI (Ink · pi · Yoga · dsh-ui-whale ·
dsh-anchored-standard · mathjax-tex-svg) and the one dependency whose license is still
**unverified** (the `vendor/dsh-std` submodule, which the vendored closure does not use).
The vendored closure also contains derivations/ports of **Ink** and **Meta Yoga**; their full
license texts live in [`third_party/dsh-tui/upstream/`](third_party/dsh-tui/upstream/).

## Notes on the licenses that carry obligations

- **certifi — MPL-2.0.** File-level copyleft. Redistribution of the unmodified wheel is
  permitted; the license text travels inside the wheel. If this project ever *modifies*
  certifi's source, those modified files must be published under MPL-2.0.
- **requests — Apache-2.0.** Redistribution requires the license and the upstream `NOTICE`
  file; both are inside the wheel (`requests-2.34.2.dist-info/licenses/`).
- **PSF-2.0 / BSD / MIT** — permissive; attribution and the license text are retained
  inside each wheel.

## Not redistributed

Packages installed from a live index at runtime (or declared in
[`requirements.txt`](requirements.txt)) are the user's own install, not a redistribution by
this project. The **safety core** — the execution layer, gateway, and memory — deliberately
depends on the Python standard library only; see `docs/ADR.md` (ADR-004).

## Assets

`assets/logo.svg`, `assets/ace.ico`, and `demo/*.svg` are original work created for this
project (the icon is rasterized from the SVG by `packaging/make_icon.py`). No third-party
fonts, game assets, or commercial artwork are bundled. The `demo/*.svg` files reference
only a generic monospace font *stack* by name — no font file is redistributed.

## Reporting

If you believe something here is attributed incorrectly or is missing, open an issue and it
will be fixed. See [`SECURITY.md`](SECURITY.md) for the security-reporting channel.
