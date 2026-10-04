# dsh-TUI 来源与归属声明（NOTICE）

本目录登记本仓库从 **dsh-TUI** 引入（或计划引入）的内容及其上游归属。**只放许可与声明，
不放源码**——源码引入时按本文件逐条携带出处与文件头。

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

## 引入范围（**将引入**，尚未拷入）

按当前计划引入其**渲染内核与部分组件**（`src/ink/**` 等）及相关文案。**截至本文件写入时，
本仓库内没有任何 dsh-TUI 的源码或文案副本**；先落许可与归属，再搬代码。

## 上游归属（逐条）

dsh-TUI 自带的 `THIRD_PARTY_LICENSES` 只声明了 2 条。下列 4 处**未列入**但代码内自带出处，
引入到本仓库时**必须一并署名**：

| dsh-TUI 内的落点 | 上游 | 许可 | 义务 |
|---|---|---|---|
| `src/ink/**`（约 60 个文件；其 `docs/architecture.en.md` 自述为 "Ink-based renderer"） | Ink（Vadim Demedes） | MIT | 保留版权与许可声明 |
| `src/terminal-utils/latex.ts`（文件头 `VENDORED — do not restyle.`，行 5–21） | pi（前 `badlogic/pi-mono`）`packages/tui/src/latex.ts`，commit `fa0e1f48ac`（https://github.com/earendil-works/pi） | MIT | **文件头内联的 VENDORED 段与 MIT 全文必须逐字保留**，不许为统一风格剥掉 |
| `src/native-ts/yoga-layout/**`（其 `index.ts` 行 2 自述为 Meta Yoga 的纯 TS 移植） | Yoga（Meta） | MIT | 保留版权与许可声明 |
| `src/components/whaleLayers.ts`、`src/components/LogoV2.tsx`（其 `THIRD_PARTY_LICENSES` 只点名了 `whaleFrames.ts` / `whaleIdle.ts`，覆盖面不全） | dsh-ui-whale（https://github.com/lhh010/dsh-ui-whale，© 2026 lhh010） | BSD-3-Clause | 保留版权行与许可全文；**第 3 条：不得用 dsh-ui-whale / lhh010 之名背书本仓库** |

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

- **`vendor/dsh-std` 子模块的许可未核实**：快照内为空，无法判断。引入前需在有 `node_modules` 的
  环境跑一次 license 扫描。
- **dsh-TUI `package.json` 的 35 个运行时依赖**：快照内无 `node_modules`，`pnpm-lock.yaml` 不含
  `license` 字段，无法全量核验。已知非 MIT/Apache 的保守清单：BSD-3-Clause × 3
  （`dsh-working-activity`、`diff`、`highlight.js`）、ISC × 3（`semver`、`signal-exit`、`yaml`）、
  `lovely-mermaid` = Apache-2.0。这些依赖**不由本仓库分发**（随 npm 安装）；只有将来把它们的
  产物打进发行物时才需要登记条目。
- 全仓扫描未命中 GPL/AGPL/LGPL/MPL/SSPL/Commons Clause（依据 `.recon/D-i18n-license.md`）。

## 报告

归属有误或遗漏：开 issue 即改。安全类问题见 [`SECURITY.md`](../../SECURITY.md)。
