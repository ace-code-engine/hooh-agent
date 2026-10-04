# 同行怎么做 TUI：`pi` 与 Claude Code 源码研读

> 目的：**别猜，读源码**。看两个公认做得好的 CLI agent（`pi`、Claude Code）的界面**是怎么实现的**，
> 哪些是 ace 已经做对的，哪些是可以直接搬的，哪些是明确不该搬的。
>
> 材料（一手）：
> - `pi`：`G:\agents\repos\pi` —— 自研 TUI 框架 `packages/tui`（≈30 文件）+ 聊天界面 `packages/coding-agent/src/modes/interactive`（50+ 组件）
> - Claude Code：仓库内 `.ace-cc-zh/ORIGINALS`（从 sourcemap 无损还原的原始源码），含**它自带的 Ink 分支** `ink/ink.tsx`（78KB）与 `components/design-system/`（15 个原语）
> - 同快照里还有 `crush` / `opencode` / `gemini-cli` / `codex`，本报告不展开。

---

## 一、两家最大的共识（**ace 已经做对了**）

| 共识 | pi 的证据 | Claude Code 的证据 |
| --- | --- | --- |
| **主屏转录 = 终端真回滚缓冲**，写出去就不再重画 | `TuiMainScreen` 逐行 diff，滚出视口的行永不重写（`tui-main-screen.ts:247-342`） | `ink.tsx:990` 注释：*unchanged cells don't need repainting. **Scrollback is preserved.*** |
| **只重画"非静态"的最后一帧** | 同上（`previousLines` 之外无状态） | `ink.tsx:1716`：*only render last frame of non-static output* |
| **清屏会吃掉用户回滚缓冲 —— 这是大忌** | 只在换宽/换高时 `\x1b[2J\x1b[H\x1b[3J` | `ink.tsx:488` 注释：*the 2J below **wipes the user's main-screen scrollback*** |
| **全屏另开备用屏**（主屏留给历史） | `TuiMainScreen` / `TuiAltScreen` 是**接口级二选一**（`tui-renderer.ts:18-47`） | `ink/components/AlternateScreen.tsx` |

> ace 现状：Python 引擎早就是两车道（`ui/ace_canvas.py:17`、`ui/ace_engine_repl.py:7`）；
> Ink 前端今天刚上 `<Static>`；`repl()` 里那句"进聊天清屏"今天已删（与 CC 那条注释同一个教训）。

---

## 二、`pi` 的做法：**自研框架，不赌 Ink**

| # | 做法 | 证据 |
| --- | --- | --- |
| 1 | 主屏渲染器：`previousLines` **逐行 diff** + 视口跟踪（`maxLinesRendered` / `previousViewportTop`），只在首帧/换宽/换高才整屏重画 | `tui-main-screen.ts:124-342` |
| 2 | **同步输出**：每批写入前后包 `\x1b[?2026h` … `\x1b[?2026l`（防撕裂/频闪；不认识该模式的终端会忽略） | `tui-main-screen.ts:280,302` |
| 3 | 全屏转录 = `ScrollView{follow:'end', primary:true, overscroll:'chain', scrollbar:'auto'}`；另有转录内搜索、搜索命中样式、"跳到底部"提示、选中即复制、右键粘贴 | `chat-viewport.ts:22-45`、`tui-renderer.ts:24-44` |
| 4 | 底部是 **dock**（`VStack` + `basis/grow/shrink/minSize`）：待发消息 / 状态 / 编辑器(minSize 3) / 页脚，各自可伸缩 | `chat-viewport.ts:31-45` |
| 5 | 对话框/选择器是 **overlay**（anchor + margin + options），**合成进"行缓冲"再 diff**，不是布局流里的元素 | `tui.ts:201-268`、`tui-main-screen.ts:266-269` |
| 6 | Markdown 是**真引擎**：`marked` + `highlight.js` + LaTeX + Mermaid + 内联图片（`terminal-image.ts` 23KB，Kitty/iTerm 协议） | `components/markdown.ts`（33KB） |
| 7 | 输入体验当第一等公民：编辑器 84KB、键盘解析 45KB、kill-ring、模糊补全 26KB | `components/editor.ts`、`keys.ts`、`autocomplete.ts` |
| 8 | 自研 flex 布局引擎（不依赖 Yoga） | `layout.ts`（15KB） |
| 9 | `TUI` 用一个 **Proxy** 包着，组件在 renderer 被换掉后仍然可用 | `tui-renderer.ts:51-79` |

---

## 三、Claude Code 的做法：**改 Ink，而不是换掉它**

| # | 做法 | 证据 |
| --- | --- | --- |
| 1 | 自带 Ink 分支：多了 **DOM 层**（`markDirty` / `scheduleRenderFrom` / `markCommitStart`）+ reconciler + **按 cell 的节点缓存**（"未变的 cell 不用重画"） | `ink/ink.tsx`（78KB）、`ink/components/ScrollBox.tsx` 的 import |
| 2 | `ScrollBox`：命令式 `scrollTo` / `scrollBy`；位置在**同一趟 Yoga 布局**里读（避免节流渲染读到过期坐标） | `ink/components/ScrollBox.tsx:19-30` |
| 3 | **先有设计系统原语，再拼界面**：`Dialog` `Divider` `ListItem` `Pane` `Tabs` `ProgressBar` `StatusIcon` `Byline` `FuzzyPicker` `ThemedBox/Text` `ThemeProvider` | `components/design-system/`（15 文件） |
| 4 | 终端细节单独成原语：`NoSelect` `Link`（超链接）`RawAnsi` `Newline` `Spacer`；尺寸/焦点/时钟各一个 Context | `ink/components/` |
| 5 | 全屏：`AlternateScreen`；静态输出与动态输出分流（见 §一） | 同上 |

---

## 四、逐项对照：他们 → ace 现在 → 差在哪

| 能力 | pi / CC | ace 现在 | 差距 |
| --- | --- | --- | --- |
| 主屏转录进真回滚 | ✓ | ✓ Python 两车道；✓ Ink 今天上 `<Static>` | **已对齐** |
| 行级 diff + 视口跟踪 | ✓ | Ink 内部做；Python 侧自己画 | 中间 |
| **同步输出 `?2026`** | ✓（pi） | ✗ **全项目 0 处**（上游 Ink 也没有 → Ink 侧做不了，除非 fork） | **可直接补（Python 侧）** |
| 全屏转录 + 滚动条 + 搜索 + 跳到底 | ✓ | ✗ 引擎的 `/fullscreen` 是**空转**、Ink 侧无 | 大 |
| Overlay 式对话框（不顶动转录） | ✓ | ✗ 现在是布局流元素 → 菜单/对话框会把转录顶来顶去 | 中 |
| 设计系统原语层 | ✓ CC 15 个原语 / pi `theme.ts` 38KB | 有 cell/canvas/render 三层，**组件层没有原语契约** | 中 |
| Markdown | marked+高亮+LaTeX+图片 | 受控子集（今天补了表格） | 中 |
| 输入体验 | kill-ring / 多键绑定 / 模糊补全 | 有 vim 子集 + 历史补全 | 中 |
| 内联图片 / Mermaid / LaTeX | ✓ pi | ✗ | 低优先 |

---

## 五、按性价比排序：可搬清单

**P0（小、立竿见影）**
1. **同步输出包帧**：Python 引擎重画底部车道时，把整批写入包进 `\x1b[?2026h` … `\x1b[?2026l`
   （`ui/ace_engine_repl.py` / `ui/ace_screen.py` 的 flush 处）。不认识的终端会忽略 ✓ 无兼容风险。
   Ink 侧做不了（`write` 由 Ink 内部控制）——**如实记进天花板**，这也是"Python 引擎当主面"的又一条理由。
2. **把"写出去的行不许重写"写成断言**（现在只有 golden 图，缺这条纪律）。

**P1（中）**
3. **全屏转录**：`follow:'end'` + 滚动条 + "跳到底部" + 转录内搜索（对齐 pi 的三参数模型）。
4. **对话框改 overlay 合成**（先合成进行缓冲，再 diff）——顺手解决"菜单把转录顶上顶下"。
5. **设计系统原语层**：`Dialog / Divider / ListItem / Pane / Tabs / StatusIcon / ThemedBox / ThemedText`
   （ace 的 `ui/ace_*` 已有 cell/canvas，缺的是**组件级契约**）。

**P2（大）**
6. Markdown 升级（代码高亮、脚注、内联图片）；7. 输入体验（kill-ring、多键绑定、模糊补全）。

---

## 六、明确不搬

- **不写第三套渲染器**：ace 已有 Ink 前端 + Python 引擎两套；pi 敢自研是因为它只有一套。再自研 = 三倍维护。
- **不学 pi 的单文件风格**：`interactive-mode.ts` **239KB** 一个文件 —— 那是维护灾难，不是学习对象。
- **不引内联图片/LaTeX/Mermaid**（除非明确要）：收益小、依赖重。
- **不为"两个面都好看"各写一套样式**：CC 的答案是**一份 design-system 原语**，不是两份。

---

## 七、结论

1. **架构方向已经对了**：主屏进真回滚 + 只重画动态帧 + 清屏是禁忌 —— 三家（含 ace）同一结论，且都被真实投诉验证过。
2. **差距不在"框架选型"，在"渲染控制力"**：pi 靠自研拿到同步输出/视口/overlay；CC 靠 fork Ink 拿到 cell 级增量。ace 的 Ink 侧**没有这些钩子**，Python 侧**自己画所以都有机会**。
3. 因此下一步优先级与"主面"选择是同一件事：**先把 Python 引擎补齐到 pi 的水准（P0+P1），Ink 只做能做的（去框、token 对拍）**。
