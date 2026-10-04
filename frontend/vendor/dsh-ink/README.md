# dsh-ink — vendored render kernel (C 路地基)

Verbatim copy of the compiled Ink-compatible render kernel from
`@deepseek-harness-tui/dsh-tui` v0.12.0 (MIT). See [MANIFEST.md](MANIFEST.md) for the
135-file provenance table and [LICENSE.upstream](LICENSE.upstream).

License and attribution for this directory live in
[`third_party/dsh-tui/`](../../../third_party/dsh-tui/): upstream MIT text in
[`LICENSE`](../../../third_party/dsh-tui/LICENSE), the introduced-parts declaration in
[`NOTICE.md`](../../../third_party/dsh-tui/NOTICE.md), and the full texts for the
derived/ported **Ink** and **Meta Yoga** parts in
[`upstream/`](../../../third_party/dsh-tui/upstream/).

Nothing in `frontend/src/**`, `frontend/package.json`, `frontend/test/**` or the Python side
was touched. This directory is self-contained.

## Run the probe (one copy-pasteable line)

```powershell
cd G:\AI_Project\ace; node frontend\vendor\dsh-ink\setup-deps.mjs; node frontend\vendor\dsh-ink\probe.mjs
```

`setup-deps.mjs` is idempotent — it skips any link that already exists.

## How dependencies resolve

The vendored files are **ESM**, and Node's ESM resolver **ignores `NODE_PATH`**. They also
cannot use `frontend/node_modules`: ace's frontend pins `react@18.3.1` /
`react-reconciler@0.29.2`, while this kernel is compiled against `react@19.3.0` /
`react-reconciler@0.34.0`.

So `setup-deps.mjs` materialises a real `frontend/vendor/dsh-ink/node_modules/` and fills it
with **directory junctions** (Windows; `fs.symlinkSync(..., 'junction')`) pointing at the 21
public packages inside the already-installed dsh-tui. Node then resolves them by the ordinary
nearest-`node_modules` walk, and each package's own transitive deps resolve through realpath
inside the install tree (`react-reconciler` → `scheduler`, etc.).

- **Zero upstream `node_modules` files are copied into ace** — only 21 links. The private
  packages (`@dsh-std/*`, `@dsh-tui-vendor/*`) are never linked and never reachable.
- Override the install root on another machine:
  `$env:DSH_TUI_PKG = 'C:\path\to\node_modules\@deepseek-harness-tui\dsh-tui'`.
- The probe asserts `React.version` starts with `19.`, so a wrong-tree resolution fails loudly
  instead of silently rendering with React 18.

### Pinned public packages

`@alcalzone/ansi-tokenize@0.3.1`, `auto-bind@5.0.1`, `bidi-js@1.1.0`, `chalk@6.0.1`,
`cli-boxes@4.0.1`, `code-excerpt@4.0.0`, `emoji-regex@11.0.0`, `get-east-asian-width@1.7.0`,
`indent-string@5.0.0`, `lodash-es@4.18.1`, `react@19.3.0`, `react-reconciler@0.34.0`,
`scheduler@0.28.0`, `semver@7.8.5`, `signal-exit@4.1.0`, `sixel@0.16.0`, `stack-utils@2.0.6`,
`strip-ansi@7.2.0`, `supports-hyperlinks@3.2.0`, `usehooks-ts@3.1.1`, `wrap-ansi@10.0.2`.

If you would rather not depend on a local dsh-tui install, `npm install` exactly those pins
inside this directory — the junction step becomes unnecessary and nothing else changes.

### Known optional host anchor

`lib/types/dsh-adapter/sharp.js` tries `require.resolve('@deepseek-ai/dsh-session/package.json')`
to prefer the host's `sharp` copy. It is wrapped in `try/catch` and returns `undefined` when the
host tree is absent; image rendering falls back to text. No `@deepseek-ai/*` package is required
for the probe.
