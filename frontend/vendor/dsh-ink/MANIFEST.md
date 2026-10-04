# MANIFEST — vendored dsh-tui ink render kernel

Upstream package: `@deepseek-harness-tui/dsh-tui` v0.12.0
Upstream install path: `C:\Users\69215\AppData\Roaming\npm\node_modules\@deepseek-harness-tui\dsh-tui`
License: MIT, Copyright (c) 2026, chimney (ccch1mneyyy) — see `LICENSE.upstream`
Copied verbatim: **yes**, every file byte-for-byte (`copyFileSync`), source layout preserved.
None of the 135 copied files carry a per-file license/copyright header
(grep for `Copyright|SPDX|Licensed under` over the closure = 0 hits), so nothing was stripped;
the upstream package-level LICENSE is vendored as `LICENSE.upstream`.

**Totals: 135 files / 27890 lines**, all `.js` (compiled ESM).

License and attribution declarations for this directory — including the full texts for the
derived/ported Ink and Meta Yoga parts — live in [`third_party/dsh-tui/`](../../../third_party/dsh-tui/).

## Dependency resolution

Only bare (non-relative) specifiers below are needed; every one is a **public** npm package.
No private package (`@dsh-std/*`, `@deepseek-ai/*`, `@dsh-tui-vendor/*`) is *required* by the
kernel closure. The single `@deepseek-ai/*` mention in the tree is an optional host anchor in
`lib/types/dsh-adapter/sharp.js` (`createRequire().resolve('@deepseek-ai/dsh-session/package.json')`
inside `try/catch`; returns `undefined` and falls back to text when the host tree is absent).
See `README.md` for how the rest are resolved.

| bare specifier | version resolved upstream | import sites |
|---|---|---|
| `@alcalzone/ansi-tokenize` | 0.3.1 | 4 |
| `auto-bind` | 5.0.1 | 1 |
| `bidi-js` | 1.1.0 | 1 |
| `chalk` | 6.0.1 | 2 |
| `cli-boxes` | 4.0.1 | 1 |
| `code-excerpt` | 4.0.0 | 1 |
| `emoji-regex` | 11.0.0 | 1 |
| `get-east-asian-width` | 1.7.0 | 1 |
| `indent-string` | 5.0.0 | 1 |
| `lodash-es/noop.js` | 4.18.1 | 2 |
| `lodash-es/throttle.js` | 4.18.1 | 1 |
| `react` | 19.3.0 | 30 |
| `react-reconciler` | 0.34.0 | 1 |
| `react-reconciler/constants.js` | 0.34.0 | 3 |
| `react/jsx-runtime` | 19.3.0 | 17 |
| `semver` | 7.8.5 | 1 |
| `signal-exit` | 4.1.0 | 1 |
| `sixel` | 0.16.0 | 1 |
| `stack-utils` | 2.0.6 | 1 |
| `strip-ansi` | 7.2.0 | 2 |
| `supports-hyperlinks` | 3.2.0 | 1 |
| `usehooks-ts` | 3.1.1 | 1 |
| `wrap-ansi` | 10.0.2 | 1 |

## File list (135)

| # | path (relative to `frontend/vendor/dsh-ink/`) | source package | version | verbatim |
|---|---|---|---|---|
| 1 | `lib/types/bootstrap/state.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 2 | `lib/types/dsh-adapter/sharp.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 3 | `lib/types/ink/ansi.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 4 | `lib/types/ink/bidi.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 5 | `lib/types/ink/clearterminal.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 6 | `lib/types/ink/colorize.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 7 | `lib/types/ink/components/alternatescreen.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 8 | `lib/types/ink/components/app.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 9 | `lib/types/ink/components/appcontext.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 10 | `lib/types/ink/components/box.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 11 | `lib/types/ink/components/button.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 12 | `lib/types/ink/components/clockcontext.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 13 | `lib/types/ink/components/cursordeclarationcontext.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 14 | `lib/types/ink/components/erroroverview.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 15 | `lib/types/ink/components/image.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 16 | `lib/types/ink/components/link.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 17 | `lib/types/ink/components/newline.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 18 | `lib/types/ink/components/noselect.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 19 | `lib/types/ink/components/rawansi.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 20 | `lib/types/ink/components/scrollbox.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 21 | `lib/types/ink/components/spacer.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 22 | `lib/types/ink/components/stdincontext.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 23 | `lib/types/ink/components/terminalfocuscontext.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 24 | `lib/types/ink/components/terminalsizecontext.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 25 | `lib/types/ink/components/text.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 26 | `lib/types/ink/constants.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 27 | `lib/types/ink/cursor.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 28 | `lib/types/ink/devtools.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 29 | `lib/types/ink/dom.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 30 | `lib/types/ink/events/click-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 31 | `lib/types/ink/events/context-menu-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 32 | `lib/types/ink/events/dispatcher.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 33 | `lib/types/ink/events/drag-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 34 | `lib/types/ink/events/emitter.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 35 | `lib/types/ink/events/event-handlers.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 36 | `lib/types/ink/events/event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 37 | `lib/types/ink/events/focus-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 38 | `lib/types/ink/events/input-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 39 | `lib/types/ink/events/keyboard-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 40 | `lib/types/ink/events/paste-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 41 | `lib/types/ink/events/pointer-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 42 | `lib/types/ink/events/resize-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 43 | `lib/types/ink/events/terminal-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 44 | `lib/types/ink/events/terminal-focus-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 45 | `lib/types/ink/events/wheel-event.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 46 | `lib/types/ink/flush-tick.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 47 | `lib/types/ink/focus.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 48 | `lib/types/ink/frame.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 49 | `lib/types/ink/geometry-trace.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 50 | `lib/types/ink/get-max-width.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 51 | `lib/types/ink/hit-test.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 52 | `lib/types/ink/hooks/use-animation-frame.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 53 | `lib/types/ink/hooks/use-app.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 54 | `lib/types/ink/hooks/use-copy-on-select.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 55 | `lib/types/ink/hooks/use-declared-cursor.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 56 | `lib/types/ink/hooks/use-input.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 57 | `lib/types/ink/hooks/use-interval.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 58 | `lib/types/ink/hooks/use-search-highlight.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 59 | `lib/types/ink/hooks/use-selection.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 60 | `lib/types/ink/hooks/use-stdin.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 61 | `lib/types/ink/hooks/use-tab-status.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 62 | `lib/types/ink/hooks/use-terminal-focus.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 63 | `lib/types/ink/hooks/use-terminal-images.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 64 | `lib/types/ink/hooks/use-terminal-size.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 65 | `lib/types/ink/hooks/use-terminal-title.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 66 | `lib/types/ink/hooks/use-terminal-viewport.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 67 | `lib/types/ink/ink.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 68 | `lib/types/ink/input-suppression.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 69 | `lib/types/ink/instances.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 70 | `lib/types/ink/kitty-graphics.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 71 | `lib/types/ink/layout/engine.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 72 | `lib/types/ink/layout/geometry.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 73 | `lib/types/ink/layout/node.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 74 | `lib/types/ink/layout/yoga.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 75 | `lib/types/ink/line-width-cache.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 76 | `lib/types/ink/log-update.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 77 | `lib/types/ink/measure-element.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 78 | `lib/types/ink/measure-text.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 79 | `lib/types/ink/node-cache.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 80 | `lib/types/ink/optimizer.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 81 | `lib/types/ink/output.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 82 | `lib/types/ink/parse-keypress.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 83 | `lib/types/ink/reconciler.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 84 | `lib/types/ink/render-border.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 85 | `lib/types/ink/render-node-to-output.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 86 | `lib/types/ink/render-to-screen.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 87 | `lib/types/ink/renderer.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 88 | `lib/types/ink/root.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 89 | `lib/types/ink/screen.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 90 | `lib/types/ink/selection.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 91 | `lib/types/ink/sixel-codec.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 92 | `lib/types/ink/sixel-graphics.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 93 | `lib/types/ink/sixel-worker.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 94 | `lib/types/ink/squash-text-nodes.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 95 | `lib/types/ink/stringwidth.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 96 | `lib/types/ink/styles.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 97 | `lib/types/ink/supports-hyperlinks.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 98 | `lib/types/ink/tabstops.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 99 | `lib/types/ink/terminal-focus-state.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 100 | `lib/types/ink/terminal-image-protocol.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 101 | `lib/types/ink/terminal-image.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 102 | `lib/types/ink/terminal-querier.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 103 | `lib/types/ink/terminal.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 104 | `lib/types/ink/termio.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 105 | `lib/types/ink/termio/ansi.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 106 | `lib/types/ink/termio/csi.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 107 | `lib/types/ink/termio/dec.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 108 | `lib/types/ink/termio/esc.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 109 | `lib/types/ink/termio/osc.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 110 | `lib/types/ink/termio/parser.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 111 | `lib/types/ink/termio/sgr.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 112 | `lib/types/ink/termio/tokenize.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 113 | `lib/types/ink/termio/types.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 114 | `lib/types/ink/timeline-rail.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 115 | `lib/types/ink/transcript-highlight.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 116 | `lib/types/ink/truncatetowidth.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 117 | `lib/types/ink/update-overflow-guard.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 118 | `lib/types/ink/useterminalnotification.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 119 | `lib/types/ink/warn.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 120 | `lib/types/ink/widest-line.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 121 | `lib/types/ink/wrap-text.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 122 | `lib/types/ink/wrapansi.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 123 | `lib/types/native-ts/yoga-layout/enums.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 124 | `lib/types/native-ts/yoga-layout/index.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 125 | `lib/types/utils/debug.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 126 | `lib/types/utils/earlyinput.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 127 | `lib/types/utils/env.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 128 | `lib/types/utils/envutils.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 129 | `lib/types/utils/execfilenothrow.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 130 | `lib/types/utils/fullscreen.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 131 | `lib/types/utils/intl.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 132 | `lib/types/utils/log.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 133 | `lib/types/utils/paths.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 134 | `lib/types/utils/semver.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
| 135 | `lib/types/utils/sliceansi.js` | @deepseek-harness-tui/dsh-tui | 0.12.0 | yes |
