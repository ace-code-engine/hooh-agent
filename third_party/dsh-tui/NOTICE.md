# dsh-TUI 来源与归属声明（NOTICE）

本目录登记本仓库从 **dsh-TUI** 引入的内容及其上游归属。**只放许可与声明，不放源码**——
已引入的源码落在 [`frontend/vendor/dsh-ink/`](../../frontend/vendor/dsh-ink/)，随拷贝携带
上游许可全文与逐文件清单。

## 引入对象

| 项 | 值 |
|---|---|
| 上游包 | `@deepseek-harness-tui/dsh-tui` |
| 版本 | `0.12.0` |
| 上游仓库 | https://github.com/ccch1mneyyy/dsh-TUI |
| 许可 | MIT（全文见本目录 [`LICENSE`](LICENSE)，**逐字复制，不得改动**） |
| 版权人 | Copyright (c) 2026, chimney (ccch1mneyyy) |
| 获取日期 | 2026-10-04 |
| 获取快照 | 本地 `G:\ai工作区\dsh-TUI-main\dsh-TUI-main`（`package.json` 的 `version` = `0.12.0`） |
| 获取途径（本次引入） | 本机 npm 全局安装 `C:\Users\69215\AppData\Roaming\npm\node_modules\@deepseek-harness-tui\dsh-tui`（`package.json` 的 `version` = `0.12.0`） |

## 引入范围（**已引入**）

渲染内核闭包：**135 个文件 / 27,890 行**（行数按 `split('\n')` 口径；同一批文件按行尾符
口径为 27,755 行，两种口径的文件集合相同），全部为编译后的 ESM `.js`。落点
[`frontend/vendor/dsh-ink/`](../../frontend/vendor/dsh-ink/)，保留上游目录结构（`lib/types/**`）。

- **逐字拷贝**：`copyFileSync` 原样复制，无改写、无删减、无重排；135 个文件内均不含逐文件
  许可/版权头（对闭包 grep `Copyright|SPDX|Licensed under` = 0 命中），故不存在被剥除的声明。
  本次抽查 135/135 个文件与上游 SHA256 一致（抽样明细见 `.recon/M3-notice.md`）。
- **上游许可全文随拷贝**：`frontend/vendor/dsh-ink/LICENSE.upstream`，
  SHA256 `54f2c59427af6a22111dade86a39605a17826a7d44e98801c42e3ab21889f884`，
  与上游包内 `LICENSE` 逐字节一致。
- **引入日期**：2026-10-04。
- **逐文件清单**：见 [`frontend/vendor/dsh-ink/MANIFEST.md`](../../frontend/vendor/dsh-ink/MANIFEST.md)
  （135 行逐文件 provenance 表 + 依赖解析说明）。**本文件不再抄录该清单**，只保留这一处指针，
  避免两处漂移。
- **依赖**：闭包只引用公开 npm 包，**无需任何私有包**（`@dsh-std/*` / `@deepseek-ai/*` /
  `@dsh-tui-vendor/*`）。核对结果：全闭包扫描 `@dsh-std/*`、`@dsh-tui-vendor/*` 0 命中；
  `@deepseek-ai/*` 仅出现在 `lib/types/dsh-adapter/sharp.js`（2 处注释 + 1 处 `try/catch` 内的
  可选宿主锚点 `createRequire().resolve('@deepseek-ai/dsh-session/package.json')`，宿主树缺失时
  回落到文本渲染）。私有包既未链接也不可达（`setup-deps.mjs` 只连 21 个公开包）。
- **边界**：该闭包仍是上游作品，本仓库不因收录而对其主张著作权；这里记录的只是逐字携带、
  出处与署名。

## 上游归属（逐条）

dsh-TUI 自带的 `THIRD_PARTY_LICENSES` 只声明了 2 条。下列 4 处**未列入**但代码内自带出处，
引入到本仓库时**必须一并署名**：

| dsh-TUI 内的落点 | 上游 | 许可 | 义务 |
|---|---|---|---|
| `src/ink/**`（约 60 个文件；其 `docs/architecture.en.md` 自述为 "Ink-based renderer"） | Ink（Vadim Demedes） | MIT | 保留版权与许可声明 |
| `src/terminal-utils/latex.ts`（文件头 `VENDORED — do not restyle.`，行 5–21） | pi（前 `badlogic/pi-mono`）`packages/tui/src/latex.ts`，commit `fa0e1f48ac`（https://github.com/earendil-works/pi） | MIT | **文件头内联的 VENDORED 段与 MIT 全文必须逐字保留**，不许为统一风格剥掉 |
| `src/native-ts/yoga-layout/**`（其 `index.ts` 行 2 自述为 Meta Yoga 的纯 TS 移植） | Yoga（Meta） | MIT | 保留版权与许可声明 |
| `src/components/whaleLayers.ts`、`src/components/LogoV2.tsx`（其 `THIRD_PARTY_LICENSES` 只点名了 `whaleFrames.ts` / `whaleIdle.ts`，覆盖面不全） | dsh-ui-whale（https://github.com/lhh010/dsh-ui-whale，© 2026 lhh010） | BSD-3-Clause | 保留版权行与许可全文；**第 3 条：不得用 dsh-ui-whale / lhh010 之名背书本仓库** |

**与本次引入范围的关系**：135 文件闭包只覆盖上表第 1 行（Ink 派生，落点
`frontend/vendor/dsh-ink/lib/types/ink/**`）与第 3 行（Yoga 移植，落点
`frontend/vendor/dsh-ink/lib/types/native-ts/yoga-layout/**`，对应文件 `index.js` / `enums.js`）。
第 2 行（`src/terminal-utils/latex.ts`）与第 4 行（whale 相关组件）**不在闭包内、本次未引入**；
其义务条款原样保留，将来引入时必须逐条兑现。

**已补（2026-10-04）**：闭包内随行携带的许可全文原先只有 dsh-TUI 自身的 MIT
（`frontend/vendor/dsh-ink/LICENSE.upstream`）；Ink 与 Yoga 的版权行与 MIT 全文**上游本就没带**
（这也是上表存在的原因）。现按**实际 vendor 闭包**补齐到本目录 [`upstream/`](upstream/)：

- [`upstream/INK-LICENSE.txt`](upstream/INK-LICENSE.txt) —— 覆盖闭包内 `lib/types/ink/**` 全部
  **120** 个文件（Ink 的派生/分叉），文本逐字取自 Ink 官方仓库 `license`；
- [`upstream/YOGA-LICENSE.txt`](upstream/YOGA-LICENSE.txt) —— 覆盖闭包内
  `lib/types/native-ts/yoga-layout/**` 的 **2** 个文件（Meta Yoga 的纯 TS 移植），文本逐字取自
  Yoga 官方仓库 `LICENSE`。

文本来源、逐字性、文件↔上游对应关系与**待核实项**（Ink 分叉基线版本）见
[`upstream/README.md`](upstream/README.md)。上表第 2 行（pi / `latex.ts`）与第 4 行
（dsh-ui-whale / whale 组件）**在闭包内没有任何对应文件**（对 135 个文件 grep `latex` 0 命中、
闭包内没有 dsh-TUI 自有组件目录），故本次不为它们补文本；其义务条款原样保留，将来引入时再逐条兑现。

dsh-TUI 已自行声明的 2 条（若引入对应文件，同样适用）：

| dsh-TUI 内的落点 | 上游 | 许可 |
|---|---|---|
| `src/components/whaleFrames.ts`、`src/components/whaleIdle.ts` | dsh-ui-whale（© 2026 lhh010） | BSD-3-Clause |
| 锚定渲染相关代码 | dsh-anchored-standard（© 2026 xiaobright；Portions © 2026 DeepSeek） | MIT |

dsh-TUI 内嵌的 vendor 目录**不在本次引入范围内**，仅登记备查：

| 落点 | 许可 | 说明 |
|---|---|---|
| `vendor/mathjax-tex-svg/` | Apache-2.0 | 若将来引入，**必须同时携带**其 `LICENSE` 与 `NOTICE` |
| `vendor/dsh-std/`（子模块 → https://github.com/T-Auto/dsh-std.git） | **未核实** | 快照内该目录为空，`pnpm-workspace.yaml` 声明的 7 个 `@dsh-std/*` 包来自这里。**许可核实前不引入**，本仓库不为它做任何许可声明 |

## 未核实 / 待人工复核

- **已引入的 135 文件闭包不依赖上述未核实项**：闭包内 `@dsh-std/*`、`@dsh-tui-vendor/*` 0 命中，
  `@deepseek-ai/*` 只有 `sharp.js` 里的可选锚点（见上文）。因此 `vendor/dsh-std` 的许可未核实
  状态不影响本次引入，本仓库仍不为它做任何许可声明。
- **`vendor/dsh-std` 子模块的许可未核实**：快照内为空，无法判断。引入前需在有 `node_modules` 的
  环境跑一次 license 扫描。
- **dsh-TUI `package.json` 的 35 个运行时依赖**：快照内无 `node_modules`，`pnpm-lock.yaml` 不含
  `license` 字段，无法全量核验。已知非 MIT/Apache 的保守清单：BSD-3-Clause × 3
  （`dsh-working-activity`、`diff`、`highlight.js`）、ISC × 3（`semver`、`signal-exit`、`yaml`）、
  `lovely-mermaid` = Apache-2.0。这些依赖**不由本仓库分发**（随 npm 安装）；只有将来把它们的
  产物打进发行物时才需要登记条目。本次引入的闭包只用 junction 链接其中 21 个公开包，
  **未复制任何上游 `node_modules` 文件**，且该链接目录被 `frontend/.gitignore` 的
  `node_modules/` 规则排除，因此不构成本仓库的分发。
- 全仓扫描未命中 GPL/AGPL/LGPL/MPL/SSPL/Commons Clause（依据 `.recon/D-i18n-license.md`）。

## 报告

归属有误或遗漏：开 issue 即改。安全类问题见 [`SECURITY.md`](../../SECURITY.md)。
