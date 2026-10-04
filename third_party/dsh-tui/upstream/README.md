# 本目录是什么

`frontend/vendor/dsh-ink/` 闭包中**派生自 dsh-TUI 之外的项目**的许可全文。判定口径：
**只按实际 vendor 进本仓库的闭包**（`frontend/vendor/dsh-ink/lib/**`，135 个文件）算，
不按上游 dsh-TUI `src/` 的完整目录算——只有被复制的部分才构成本仓库的分发。

闭包构成（`Get-ChildItem -Recurse` 实测）：

| 闭包路径 | 文件数 | 上游归属 | 本目录文本 |
|---|---|---|---|
| `frontend/vendor/dsh-ink/lib/types/ink/**` | 120 | **Ink**（https://github.com/vadimdemedes/ink，MIT）的派生/分叉 | [`INK-LICENSE.txt`](INK-LICENSE.txt) |
| `frontend/vendor/dsh-ink/lib/types/native-ts/yoga-layout/**`（`index.js` / `enums.js`） | 2 | **Meta Yoga**（https://github.com/facebook/yoga，MIT）的移植 | [`YOGA-LICENSE.txt`](YOGA-LICENSE.txt) |
| `lib/types/utils/**`（11）、`lib/types/bootstrap/state.js`、`lib/types/dsh-adapter/sharp.js` | 13 | dsh-TUI 自身代码 | 由 [`../LICENSE`](../LICENSE) 覆盖 |
| **合计** | **135** | | |

判定依据：

- `lib/types/ink/**`：文件名与结构逐一对上 Ink 的公开面（`components/{box,text,app,newline,spacer,link,erroroverview…}`、
  `hooks/use-{input,app,stdin,terminal-size…}`、`reconciler`、`dom`、`output`、`log-update`、`render-node-to-output`、
  `render-border`、`measure-text`、`squash-text-nodes`、`styles`、`wrap-text`、`cursor.js`），且闭包内自引上游
  issue：`lib/types/ink/reconciler.js:14` → `https://github.com/vadimdemedes/ink/issues/384`；
  上游 dsh-TUI 自己的文档也自述为 "Ink-based renderer"。
- `lib/types/native-ts/yoga-layout/`：`index.js` 文件头第 2 行自述
  `Pure-TypeScript port of yoga-layout (Meta's flexbox engine)`，并声明对齐
  `yoga-layout/load` 的 API 面、覆盖 `src/ink/layout/yoga.ts` 用到的子集；
  `src/ink/layout/yoga.js` 从该目录导入。**是对 Yoga 的移植（重写），不是逐字拷贝**；
  本目录按保守口径携带 Meta 的 MIT 声明。
- **闭包内不存在**上游 dsh-TUI `src/terminal-utils/latex.ts`（pi，MIT）与
  `src/components/whaleLayers.ts` / `LogoV2.tsx`（dsh-ui-whale，BSD-3）的任何对应文件：
  对 135 个文件 grep `latex`（不分大小写）= **0 命中**；闭包内没有 dsh-TUI 自有组件目录
  （只有 Ink 派生目录下的 `lib/types/ink/components/`），
  `whale` 字样只出现在 Ink 派生文件里描述鲸鱼 logo 渲染 bug 的注释（dsh-TUI 自写文本）。
  **因此这两条本次不需要许可文本**，其义务仍按 [`../NOTICE.md`](../NOTICE.md) 原样留给将来。

## 文本来源

| 本目录文件 | 逐字复制自 | 获取方式 | 是否逐字 |
|---|---|---|---|
| `INK-LICENSE.txt` | https://raw.githubusercontent.com/vadimdemedes/ink/master/license（Ink 官方仓库的许可文件） | `web_fetch`，2026-10-04 | ✅ 逐字（含两行版权行，未改写、未增删） |
| `YOGA-LICENSE.txt` | https://raw.githubusercontent.com/facebook/yoga/main/LICENSE（Yoga 官方仓库的许可文件） | `web_fetch`，2026-10-04 | ✅ 逐字 |

**为何不用"上游自带的那份"**：`@deepseek-harness-tui/dsh-tui` v0.12.0 的
`node_modules/` 里既无 `ink` 也无 `yoga-layout` 包（实测目录列表 21 个公开包 +
junction 清单，0 命中），其发布的 `lib/` 闭包内也没有任何 `Copyright` / `SPDX` /
`Licensed under` 字样（grep 0 命中）。**上游根本没有携带这两份文本**，这正是本目录存在的原因。
（dsh-TUI 自己的 `THIRD_PARTY_LICENSES` 只列了 2 条，均与本闭包无关。）

## 待核实

1. **Ink 分叉基线版本未核实**：dsh-TUI 未记录它分叉自哪个 Ink 版本，其 `package.json`
   也不依赖 `ink`。本目录的 MIT 文本取自 Ink 当前 `master` 的 `license`；MIT 全文与
   两行版权行在 Ink 各版本间一致，但**分叉基线版本号无法从闭包内确定**。
2. **版权行为何是两行**：Ink 的 `license` 同时列 Vadym Demedes 与 Sindre Sorhus 两人。
   本目录按上游文本原样保留两行——**没有**按传闻只保留一行。
3. `lib/types/ink/**` 中有一批文件在 Ink 当前 `src/` 的目录清单（2026-10-04 经 GitHub
   contents API 取得）里没有同名对应——例如 `sixel-codec.js` / `sixel-graphics.js` /
   `sixel-worker.js`、`kitty-graphics.js`、`terminal-image*.js`、`termio/**`、`selection.js`、
   `hit-test.js`、`events/**`。这些应属 dsh-TUI 在该分叉上的自有增补，由 `../LICENSE`
   （dsh-TUI MIT）覆盖；**未逐一比对每个文件的内容来源**。若将来发现其中夹带第三个上游，
   需在此追加文本。

## 边界

本目录只记录"我们复制了什么、上游是谁、文本从哪来"。这些代码仍是各自上游的作品，
本仓库不因收录而对其主张著作权；BSD-3 类上游的"不得以名义背书"条款在其条目适用时同样保留。
