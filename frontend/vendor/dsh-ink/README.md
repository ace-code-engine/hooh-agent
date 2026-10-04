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

`frontend/src/**`, `frontend/test/**` and the Python side are untouched by this directory.
`frontend/package.json` is touched only to declare what the kernel needs from ace:
`react` / `react-reconciler` (already there) and — since the second two-React trap —
`usehooks-ts@^3.1.0`, because a package that itself imports `react` must be installed by ace
(see the hard invariant below). This directory stays self-contained: still exactly 135 vendored
`.js` files, byte-for-byte.

## Run the probe (one copy-pasteable sequence)

```powershell
cd G:\AI_Project\ace\frontend
npm install                          # react@19.3.0 / react-reconciler@0.34.0 / usehooks-ts@3.1.1（内核全部 react 使用者的唯一真源）
node vendor\dsh-ink\setup-deps.mjs   # 建/修 junction；"自身 import react"的包一律不建；幂等 + 自愈
node vendor\dsh-ink\probe.mjs        # PATH C/D/E 守卫（react 单实例 / useInput 真渲染 / 逐个依赖比对），失败 exit 1
```

**先 `npm install` 再 `setup-deps`，并且一律从 `frontend/` 起跑**：`frontend/node_modules/`
才是 react 的真实来源，没装它时脚本会以 `MISMATCH/ABSENT` 退出 2（不会静默退化）。
（脚本本身按 `import.meta.url` 定位、不读 cwd，但从 `frontend/` 起跑能保证前置依赖一定就位。）

`setup-deps.mjs` 是**幂等 + 自愈**的：连跑两次结果一致（第二次输出 `18 already correct`）；
若已有 junction 指错（例如旧版脚本留下的 dsh-tui 版 `react`，或指向 dsh-tui 的 `usehooks-ts`），
它会 `re-pointed` / `react-importer links removed` 拆掉重做，而不是"存在就跳过"。

## 硬不变量：所有 `import react` 的包都必须解析到 ace 那一份

**`react`、`react-reconciler`，以及一切"自身会 `import react`"的传递依赖（当前 = `usehooks-ts`），
全仓只能解析到一个实例：ace 自己的 `frontend/node_modules/*`。** 两个陷阱其实是同一个根：

- **陷阱一（静默空屏）**：`react` / `react-reconciler` 指向 dsh-tui 时，内核一份、`src/**` 一份。
  两份 React 19 的**元素能互认，但 hook 不能** —— 带 `useState` 的组件抛 `Invalid hook call`，
  **静默渲染成空屏（零报错）**。
- **陷阱二（静默 ERROR 屏，更隐蔽）**：光看 `react` 自己不够 —— **谁使用 react 才算数**。
  `lib/types/ink/hooks/use-input.js` 既 `import react` 又 `import usehooks-ts`，而
  `usehooks-ts` **自身也 `import react`**。Node 的 ESM 解析**按 realpath 走**：只要
  `vendor/dsh-ink/node_modules/usehooks-ts` 是指向 dsh-tui 的 junction，它自己的 react 就落到
  `…\@deepseek-harness-tui\dsh-tui\node_modules\react` = 第二份 React。于是内核拿 ace 的
  dispatcher、`usehooks-ts` 要 dsh-tui 的 ⇒ 任何调 `useInput` 的组件一渲染就
  `Invalid hook call` / `Cannot read properties of null (reading 'useRef')`，而且**不抛**，
  内核把它画成 ERROR 屏 —— **真机上就是输入框起不来，却看不到任何报错**。

所以 `setup-deps.mjs` 里 `ACE_OWNED = {react, react-reconciler, usehooks-ts}` 这三个包
**不建任何 junction**，改由 `frontend/package.json` 声明、`npm install` 装进
`frontend/node_modules`，让 Node 的「最近 `node_modules` 上溯」自然拿到唯一那份。
脚本结尾再自检一次（`vendor/dsh-ink/node_modules/` 里不许残留这三个名字的链接，
真源必须落在 `frontend/node_modules/`，否则 `exit 1`）；旧版脚本留下的错链接会被 unlink 自愈。

**怎么知道"哪些包 import react"**：不用手抄 —— `probe.mjs` 的 `PATH E` 会扫 `lib/**` 的全部
bare specifier 得到包名，再扫每个包的源码，凡是匹配 `from 'react'` / `require('react')` 的
都逐一断言「从**该包目录**解析 react」得到的与 ace 侧是同一份文件。名单漂了就红。

## How dependencies resolve

The vendored files are **ESM**, and Node's ESM resolver **ignores `NODE_PATH`**. So
`setup-deps.mjs` materialises a real `frontend/vendor/dsh-ink/node_modules/` and fills it with
**directory junctions** (Windows; `fs.symlinkSync(..., 'junction')`) to the public packages.
Node then resolves them by the ordinary nearest-`node_modules` walk, and each package's own
transitive deps resolve through realpath inside the target tree.

- **18 个包**指向已安装的 dsh-tui（`$env:DSH_TUI_PKG` 可换机器时覆盖安装根）。
- **`react` / `react-reconciler` / `usehooks-ts` 例外（`ACE_OWNED`）**：一律**不建 junction**，
  由 `frontend/package.json` + `npm install` 提供，解析到 ace 自己的 `frontend/node_modules/*`，
  见上面的硬不变量。这三个被指错时，`probe.mjs` 的 PATH C/D/E 会红。
- **Zero upstream `node_modules` files are copied into ace** — only 18 links, and
  `frontend/vendor/dsh-ink/node_modules/**` contains **0 regular files**. The private packages
  (`@dsh-std/*`, `@dsh-tui-vendor/*`) are never linked and never reachable.
- 这条路径**不能**换成 `NODE_PATH`（ESM 解析器忽略它），**更不许**把包拷进仓库 ——
  拷贝会破坏 135 个 vendored `.js` 的逐字节证据，还给"两份 React"开口子。

### Probe guard（失败必须响，不许静默）

`probe.mjs` 的守卫分三层：

**`PATH C`** — react / react-reconciler 单实例：取**两侧**的 react，四重断言：

1. ace 侧（`frontend/src` 的解析起点）与内核侧（`lib/types/ink/ink.js` 的解析起点）**解析到同一份文件**；
2. 两个 import 拿到的**是同一个对象**（`aceReact === kernelReact`，不只是 `version` 相同）；
3. 用 **ace 侧的 React** 造一个一次性 `useState` 组件，交给内核 `renderToScreen` 真渲染一次，
   断言**不是空屏**（`hooks-alive-7`）。

**`PATH D`（陷阱二的守卫）** — 真渲染一个**调用 `useInput` 的组件**（它 = 内核 `use-input.js`
+ `usehooks-ts`），断言拿到预期文本 `useinput-alive`：**空屏、ERROR 屏、抛错三种都算失败**。
`renderToScreen` 没有 error boundary，坏了表现为**空屏**；真机路径（`render`/`renderSync` →
`components/app.js` 的 `getDerivedStateFromError` → `ErrorOverview`）会画出
` ERROR Cannot read properties of null (reading 'useRef')` —— 所以 `PATH D` 还有一条
**真机路径**的分支：用假 stdout 真渲染同一条组件，断言输出里是预期文本、且没有 `ERROR`。
这个陷阱以前零报错，只有真渲染两层才抓得住。

**`PATH E`** — 枚举 `lib/**` 里的全部公开包，逐个判断它是否 `import react`；是的话就断言
**从该包目录解析 react** 得到的与 ace 侧是同一份文件，失败时打印两侧绝对路径 + 各自版本。
反向验证时它给出的是 `usehooks-ts` 的包目录与它拿到的 dsh-tui 版 react —— 修的入口一眼可见。
（扫描是**目录级**的：跳过 `umd/` 与 `*.d.ts`，不做完整模块图可达性。零依赖、够用；
已知上限：某个包把 `import react` 只放在 Node 加载不到的 bundle 里时会误报 —— 当前闭包无此情况。）

任一条失败即 `exit 1`，并打印两侧的绝对路径 + 修复命令。反向验证：
把 `vendor/dsh-ink/node_modules/usehooks-ts`（或 `react`）手工 junction 回 dsh-tui，
`PATH A/B` 依旧全 PASS（所以肉眼看不出来），`PATH D` 渲染出空屏/ERROR 屏、`PATH E` 报出
`usehooks-ts` 指向 dsh-tui 的 react，`PROBE_EXIT=1`；再跑一次 `setup-deps.mjs` 即自愈。

### Pinned public packages

`@alcalzone/ansi-tokenize@0.3.1`, `auto-bind@5.0.1`, `bidi-js@1.1.0`, `chalk@6.0.1`,
`cli-boxes@4.0.1`, `code-excerpt@4.0.0`, `emoji-regex@11.0.0`, `get-east-asian-width@1.7.0`,
`indent-string@5.0.0`, `lodash-es@4.18.1`, `react@19.3.0`, `react-reconciler@0.34.0`,
`scheduler@0.28.0`, `semver@7.8.5`, `signal-exit@4.1.0`, `sixel@0.16.0`, `stack-utils@2.0.6`,
`strip-ansi@7.2.0`, `supports-hyperlinks@3.2.0`, `usehooks-ts@3.1.1`, `wrap-ansi@10.0.2`.

If you would rather not depend on a local dsh-tui install, `npm install` exactly those pins
inside this directory — **但 `react` / `react-reconciler` / `usehooks-ts` 除外**：这三个必须仍是
ace `frontend/node_modules` 的那一份（在本目录装成真实目录 = 第二份 React，`setup-deps.mjs`
会以"是真实目录而非 junction"/"vendor 侧残留"报错拒绝，别绕过去）。

### Known optional host anchor

`lib/types/dsh-adapter/sharp.js` tries `require.resolve('@deepseek-ai/dsh-session/package.json')`
to prefer the host's `sharp` copy. It is wrapped in `try/catch` and returns `undefined` when the
host tree is absent; image rendering falls back to text. No `@deepseek-ai/*` package is required
for the probe.
