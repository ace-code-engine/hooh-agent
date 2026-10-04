# Claude Code 的 TUI 实现 + 风格词典（色卡网格）方案

> 三个问题：（1）Claude Code（v2.1.282）的 TUI 到底怎么做的；（2）你给的那张
> Style Dictionary（编号 + 色块 + 中英双名的两列网格）在终端里怎么画；（3）它该落在 ace 的哪里。
> 预览图见 [`docs/style-dictionary-preview.svg`](style-dictionary-preview.svg)。
>
> **可信度分级**（全文遵守）：`【一手】`= 我在本机 `bin/claude.exe` 里直接读到 / 抠出的原文；
> `【第三方】`= 公开逆向文档（互证且与一手不冲突）；`【存疑】`= 有冲突或无一手证据，**不作为结论**。

---

## 第一部分、Claude Code 的 TUI

### 1. 取证方法

Claude Code 已经不是可读的 npm 包：`G:\ClaudeCode\npm-global\node_modules\@anthropic-ai\claude-code\bin\claude.exe`
是 **230 MB 的 Bun 编译单文件**（v2.1.282），JS 内嵌在可执行文件里。指纹：

| 指纹 | 结论 |
| --- | --- |
| `v8::`、`use strict`、`require(`、`__esModule`、`esbuild` | V8 + CommonJS，JS 被内嵌而非编译成机器码 |
| `B:/~BUN/root/chunk-cqq33y7k.js` | Bun 单文件编译的虚拟路径 |
| `react-reconciler` `19.2.0`、`currentDispatcherRef`、`__REACT_DEVTOOLS_GLOBAL_HOOK__` | React 19.2.0 + Reconciler |
| `useStdout`、`jsx-runtime`、`e(n,{color:"warning",children:…})`、`dimColor:!0`、`wrap:"wrap"` | Ink 风格的 `Box/Text` 组件树 |

方法：`findstr` 定位 + 流式扫描取匹配点 ±120 字节上下文（脚本见本文档"附录"）。

### 2. 渲染栈：Ink 被 fork 到认不出来

- 【第三方】*"Claude Code started with Ink, then forked it beyond recognition... a custom rendering engine that shares Ink's conceptual DNA."*
- 【一手】自研层带性能埋点与显式修复路径：`flushSyncFromReconciler`、`fiberLive`、`lastRowAnchored`、
  `reassertFrom`、`scanElementSubtree`、`staleAbsolute`、`slowestWrite`。
- 【一手】**blit 快速路径**：`if(!n.dirty && !E && n.pendingScrollDelta===void 0 && z && z.x===N && …) d.blit(g,I,X,Z,te,…)`
  —— 未脏且几何未变就整块从上一帧复制，不做逐 cell 重排。
- 【一手】raw 直写通道：宿主元素 `ink-root/box/text/virtual-text/link/progress/raw-ansi`，
  其中 `ink-raw-ansi` 直接 `write(...)` 绕过重排。

### 2.5 渲染层内部：**这就是一个 2D 游戏引擎**

"TUI 引擎 ≈ 像素游戏引擎"不是比喻，是这套代码的字面结构。每个方块（cell）自己带
`(字形, 前景色, 背景色)`，渲染器只负责把脏掉的那一块 blit 过去：

| 引擎概念 | Claude Code 里的原文（【一手】） |
| --- | --- |
| 帧缓冲 + 双缓冲 | `reset(n,d,f){this.width=n; this.height=d; this.screen=f; this.operations.length=0; Nd(f,n,d)}`，另有 `prevScreen` |
| 脏矩形 / blit 队列 | `blit(n,d,f,m,y,g){this.operations.push({type:"blit",src:n,x:d,y:f,width:m,height:y,restoreNoSelect:…,unclipped:…})}`；`blitsOver(n)` 判重叠 |
| 字形图集 + 材质表 | `charPool` / `getCharPool` / `stylePool` / `getStylePool` / `getHyperlinkPool` / `getAtlasKeyCount` / `lineCells=new tf(m,y.charPool)` |
| 场景图节点类型 | `ink-root` / `ink-box` / `ink-text` / `ink-virtual-text` / `ink-link` / `ink-progress` / `ink-raw-ansi` |
| 布局引擎 | 每个节点挂 `m.yogaNode?.setMeasureFunc(m1.bind(null,m))`（`ink-text`）与 `p1`（`ink-raw-ansi`）→ **Yoga 确实在用**（此前我按 `yoga-layout` 字面量探测没命中，是因为被改名打包；`yogaNode` 是直接证据） |
| 精灵坐标与命中测试 | `n.style.position==="absolute"`、`absoluteRectsCur.push(sf(n,z,m,y))`、`cachedLayout={x,y,width,height,top,background}`、`hoverIgnoresBlankCells` |
| 每帧失效判据 | `z.x!==N \|\| z.y!==B \|\| z.width!==F \|\| z.height!==H \|\| z.background!==R` → 全部相等且非脏才走 blit |

**这条对 Ace 的意义**：你不需要照抄它的渲染器，但应当**照它的分层来想问题**——
"数据（谁定稿了）→ 布局（哪一格放什么）→ 绘制（每格的 char/fg/bg）→ 输出（脏矩形 or 同步包帧）"。
第四层才是平台差异（Windows 强制全量重绘）该待的地方。第三部分的 `render_grid()` 就是这第三层。

### 3. 帧率与防闪烁（**这里推翻了两份第三方文档的说法**）

- 【一手】**实测修正**：第三方文档说的 `FRAME_INTERVAL_MS = 100 (10 FPS)` 和
  `lodash throttle 16ms (~60fps)` **在 2.1.282 里都不存在**（`FRAME_INTERVAL_MS` 字面量搜不到）。
  真实存在的是：**100ms 网格量化 + 480ms 下限**：
  `var Uo=480; function be(o){return a.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT?Math.max(o,Uo):o}`、
  `h=…Math.ceil(be(o)/xg)*xg`，钩子默认参 `function Sa(o=16)`。
- 【一手】**Windows 自动降级**：`if(O()==="windows"||a.WT_SESSION) process.env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT??="1"`
  —— Windows / Windows Terminal 下强制 ≥480ms 的**全量重绘**。这解释了它在 Windows 上的手感差异，
  也是"同一份 TUI 在不同终端要不同渲染策略"的最好例子。
- 【一手】新的 fullscreen 渲染器是**灰度发布**的：`CLAUDE_CODE_NO_FLICKER`、`/tui fullscreen`、
  `CLAUDE_CODE_TUI_TRIAL="fullscreen"`，并带崩溃 canary 自动回退
  （*"fullscreen disabled: a previous fullscreen launch on this machine died before it was healthy"*）。
  **连"不许闪"都是分批上线的。**
- 【第三方】BSU/ESU 原子帧、cell 级 diff、damage 矩形、StylePool 预序列化；流式 markdown 分
  `StreamingMarkdown`（容忍未闭合围栏）与静态 `Markdown` 两套，按内容哈希 LRU 复用，只重解析变化的尾部。

### 4. 布局与转录

- 【第三方】四槽位：`Obz({scrollable, bottom, overlay, modal})`；`bottom` 承载 task/permission/prompt/elicitation/cost；
  `overlay` 当前给 `tool-permission`；`modal` 预留未占用。
- 【第三方】transcript 是**独立视图树**（`screen === "transcript"` 走专门分支），不是主界面的展开态。
- 【一手】转录窗口：`C1A = 30` —— `showAllInTranscript === false` 时**只保留最近 30 条消息**，
  另有 `unseenDivider`（"N new messages"）标记你离开期间新增的部分。
- 【存疑】虚拟滚动：第三方称有 `VirtualMessageList`；【一手】在主路径上 `scrollRef` 传 `void 0`、`rL = false`，
  更像**未接线的休眠支线**。→ 不要引用"它做了虚拟化"。

### 5. 状态行：**它不是 UI，是一条外部命令**

这条最值得 ace 直接抄：

- 【第三方】`"statusLine": {"type":"command","command":"~/.claude/statusline.sh"}`，Claude Code 通过 **stdin 喂 JSON**，
  脚本回什么就渲染什么。
- 【一手】注入的 JSON 字段：`session_id/session_name`、`model{id,display_name}`、
  `workspace{current_dir,project_dir,added_dirs,git_worktree,repo}`、`version`、`output_style{name}`、
  `total_input_tokens/total_output_tokens/context_window_size/current_usage/used_percentage/remaining_percentage`、
  五小时/七天限额的 `used_percentage + resets_at`、`exceeds_200k_tokens`、`cost/duration`、
  `permissionMode`、`vimMode`、`effort`、`thinkingEnabled`；另有 `subagentStatusLine`（轮询 300ms/5000ms）。
- 含义：**状态行是"声明式数据 + 用户自己的渲染器"**，而不是主程序里写死的一段拼接。
  ace 现在是 `tui/app.py:821 _status_text()` 拼接 + `ui/ace_layout.py:101 fit_status_line()` 优先级两套（见第三部分）。

### 6. 主题：语义 token 表（真彩），亮度基底两套，枚举含 `auto`

- 【一手】真实 token 表（摘录）：`autoAccept: rgb(135,0,255)`、`claude: rgb(215,119,87)`、
  `permission: rgb(87,105,247)`、`planMode: rgb(0,102,102)`、`diffAdded: rgb(105,219,124)`、
  `diffRemoved: rgb(255,168,180)`、`diffAddedWord: rgb(47,157,68)`、`diffRemovedWord: rgb(209,69,75)`、
  `text: rgb(0,0,0)`、`inverseText: rgb(255,255,255)`、`success: rgb(44,122,57)`、
  `error: rgb(171,43,63)`、`warning: rgb(150,108,30)`。
- 【一手】枚举：`["auto","dark","light","dark-daltonized","light-daltonized","dark-ansi","light-ansi"]`
  （第三方漏了 `auto`）；亮暗判定就是 `r.startsWith("light")`。
- 【一手】基底：`light {background:"#f9f9f7", foreground:"#000000"}`、`dark {background:"#1f1f1e", foreground:"#ffffff"}`；
  另有一张**极小的 16 色基础表**（`black/red/green/yellow/blue/magenta/cyan/white`）与语义 token **两层并存**，
  `*-ansi` 就是走这一层的变体。
- 【一手】自定义主题：`__new_custom_theme__`、`setPreviewTheme/savePreview/cancelPreview`；引导语
  *"Choose the text style that looks best with your terminal"*。
- **结论**：Claude Code 的 `/theme` 预览的是**文字样式**，逐项让你看"名字用这套配色渲染出来什么样"，
  **它没有色卡网格**。你那张 Style Dictionary 是另一件事——所以第二部分才是真正要解决的问题。

### 7. 审批与输入

- 【第三方】审批是**模态 overlay + 唯一焦点**：`focusedInputDialog` 是 14 项优先级链
  （message-selector > sandbox-permission > tool-permission > prompt > worker-sandbox-permission >
  elicitation > cost > idle-return > …），任何时刻只有一个东西能拿到键盘。
- 【一手/第三方一致】标准三选项：`Yes` / `Yes, and don't ask again …` / `No`；
  sandbox 分支第三项是 `No, and tell Claude what to do differently`；"don't ask again" 写
  `addRules + behavior:"allow" + destination:"localSettings"`。
- 【第三方】**Esc 不是统一 close**：`onCancel` 按分支执行副作用（tool-permission → `onAbort()` + 清 confirm queue；
  prompt → reject 并 abort；其他 → 清流式状态或把输入暂存回消息流）。
- 【一手】排队消息提示带阈值：`queuedCommandUpHintCount` 超过 `YFt` 次就不再提示
  （文案三态：`Press up to edit queued messages, Enter to send them immediately:` /
  `Press up to select a queued message to edit, or Enter to send them now` /
  `Press up to select a queued message, then Enter to edit it`）。
- 【一手】提示系统有冷却：`{id:"theme-command", content:()=>"Use /theme to change the color theme", cooldownSessions:20}`；
  本机 `~/.claude/.config.json` 里就是计数（`"tui":{"tipId":"no-flicker","numStartups":24}`）。
- 【第三方】键位是**上下文敏感路由**，上下文枚举 17 项
  （Global/Chat/Autocomplete/Confirmation/Help/Transcript/HistorySearch/Task/ThemePicker/Settings/Tabs/
  Attachments/Footer/MessageSelector/DiffDialog/ModelPicker/Select/Plugin）。

### 8. 工具结果与截断

- 【一手】截断判据：`function v(o,{columns:l}){ if(o.isImage) return !1; return lP(o.stdout,l)||lP(o.stderr,l) }`
  —— **按列宽判断**，图像永不截断。
- 【一手】无输出/中断/后台的固定文案：`"(No output)"`、`"Interrupted"`、`"Running in the background"`；
  图像是 `"[Image data detected and sent to Claude]"`；超时单独挂块。
- 【一手】写文件卡：`"Wrote ", count, " line(s)", " to ", path`，非 verbose 时 `overflowY:"hidden"` +
  `maxHeight` + 一个 `expandable` 标记。
- 【第三方】超长结果**落盘**到 session 的 `tool-results/`，transcript 只留 `<persisted-output>` 预览；
  结果走 `toolUseResult` sidecar 而不是 transcript 的 `tool_result.content`。
- 【一手】折叠出口统一：`(ctrl+o to expand)`。

### 9. Claude Code 这一半的可抄 / 不可抄

**可抄**：① 状态行 = 外部命令 + stdin JSON（声明式数据，渲染归用户）；② 提示疲劳（阈值 + `cooldownSessions`）；
③ 模态审批 + **唯一焦点链**；④ Esc 按分支执行副作用而不是一律 close；⑤ 截断按列宽判断、图像不截断、
超长落盘只留 preview；⑥ Windows 自动降级成全量重绘（承认平台差异）。

**不可抄**：① 自研 fiber 渲染层——ace 用 Textual/prompt_toolkit 就够，这是这一行里最贵的决定；
② "两个第三方文档互相矛盾"这件事本身值得记：**闭源产品的逆向文档会过时**，能读二进制就别读二手。

---

## 第二部分、色卡网格在终端里怎么画

### 1. 正方形色块：只有一个正解

cell 是 1 宽 : 2 高，所以：

| 方案 | 序列 | 形状 | 结论 |
| --- | --- | --- | --- |
| **2 空格 + 背景色** | `\x1b[48;2;199;36;74m  \x1b[49m` | 2 列 × 1 行 = 正方形 | **采用**。背景填充恒等于 cell 矩形，不吃字体度量 |
| `▀` + 前景色 | `\x1b[38;2;…m▀` | 1 列 × 半行 = 正方形 | 备选（窄版）。依赖字形度量 |
| `██` / `█` | — | 1:2 **矩形** | 不是正方形，只适合进度条 |

- `▀` 的风险有据：WezTerm 默认开 `custom_block_glyphs` **自己合成**方框字形，注释写
  *"Ideally this option wouldn't exist, but it is present to work around a hinting issue in freetype"* ——
  "▀ 是不是真的半格"由终端 + 字体决定，不由你决定。
- Textual 自己的色卡就是背景填充：`src/textual/color.py:25`，
  `Text(" " * 20, style=f"on rgb({r},{g},{b})")`；Rich `__main__` 同理。
- 背景 vs 前景：背景方案复制成纯文本时是**空格**（干净）；终端开透明/opacity 时背景块会跟着半透明；
  背景天然支持叠加"选中/反显"。

### 2. 五个会真的坏掉的坑（都有出处）

1. **conhost 会静默把真彩量化成 16 色**，不报错：MS 文档
   *"For these extended colors, the Windows Console will choose the nearest appropriate color from the existing 16 color table"*。
   → 必须**自己**按探测到的 profile 降级，"发了 `48;2` 就以为对了"是错的。
2. **`SGR 2`（dim）不在 MS 的 SGR 表里**（表里只有 0,1,22,4,24,7,27,30-37,38,39,40-47,48,49,90-107）。
   → 别用 dim 做"小号灰英文名"，用**显式灰阶** `38;5;243`。
3. **`SGR 1` 在 Windows 是"前景亮度标志"**，即加粗会改前景色 → bold 只用在默认前景上。
4. **别用 `WT_SESSION` 判能力**（rich#140，Windows Terminal 维护者亲述：
   *"WT_SESSION is not an API… It's safer to use feature detection"*；>10.0.15063 才有 24-bit）。
   **ace 本地已有这个坑**：`ui/ace_term.py:66-74` 正在用 `WT_SESSION` 决定 unicode/bracketed_paste/mouse；
   色块这条线应当走 `:60-62` 的 `COLORTERM` 分支。
5. **`─`（U+2500）East Asian Width = Ambiguous**：CJK locale 下可能双宽，GBK 下是双字节全宽字符
   （GB2312 0xA9A4），每行多 1 cell 导致整列错位。稳妥度：ASCII `-` ＞ DEC 线绘 `\x1b(0q…\x1b(B` ＞ `─`。
6. **不要铺整页米白底**（`48;2;250;248;243`）：会和用户的终端底色/主题打架，opacity 下还会有缝。
   让底色透出来，浅底深字交给 dark/light 双调色板（`ui/ace_theme.py:26-65` 已有）。

> 另外：中文名每字 2 cell，列宽/padding/换行/快照**必须用显示宽度算，不能用 `len()`**；
> 英文小字天然 1 cell/字——这正是"中文名 vs 英文名"在终端里最好用的层级差。

### 3. 降级：truecolor → 256 → 16 → 无色

探测端复用 `ui/ace_term.py:39-80` 的 `color`/`truecolor`（yes/no/**unknown**，unknown 走保守档）。

| 档 | 色块 | 说明 |
| --- | --- | --- |
| truecolor | `\x1b[48;2;R;G;Bm  \x1b[49m` | 用 `49` 只复位背景，别用 `0` |
| 256 | `\x1b[48;5;Nm  \x1b[49m` | N 用下面算法算 |
| 16 | `\x1b[40-47m` / `\x1b[100-107m` 最近邻 | |
| 无色 | `█ ▓ ▒ ░ ·`（ASCII 兜底 `# % + .`）亮度 5 档 | 必须**同时显示 hex 或名字**，否则是假降级 |

256 算法可照抄 Rich `Color.downgrade()`（纯函数）：转 HLS；**饱和度 < 0.15 判灰** →
`gray=round(L*25)`，`0→16`、`25→231`、否则 `231+gray`（灰阶 232-255）；否则 6×6×6 立方
`c6 = c/95 if c<95 else 1+(c-95)/40`，`N = 16+36*round(r6)+6*round(g6)+round(b6)`。
灰阶分支正是这套设计稿（大量低饱和）的关键。

无色档的诚实说明：**亮度相同的两个颜色天然不可区分**（`#FF0000` 与 `#0000FF` 亮度接近），
所以这一档必须有文字兜底。另一条本仓库已验证的原则：**低色深不插值、过半直接跳档**
（`ui/ace_spinner.py:90-104`，测试 `test_all.py:10437`）。

### 4. 布局算法

```
render(items, W, profile, unicode):
  M=2; GAP=4; SW=2                 # 页边 / 两列之间 / 色块占 2 cell
  MINCOL = SW + 1 + 1 + 6          # 色块 + 空格 + 最少 6 显示列的名字
  cols = 2 if W >= 2*MINCOL + GAP else 1     # 80/120 → 2 列；60 → 1 列
  cw   = (W - 2*M - GAP*(cols-1)) // cols    # 余数给最后一列
  每项 = [编号 DIM] [空格] [色块 BG] [空格] [中文名 BOLD] [空格] [英文名 GRAY] + pad 到 cw
  项与项之间：要么空行，要么细线 —— 二选一（终端行高固定，不能靠 line-height 微调呼吸感）
```

参考实现：Textual `color.py`（色卡=背景填充空格串、`Color.monochrome` 亮度加权 0.2126/0.7152/0.0722）、
Rich `color.py`（`downgrade()` 完整算法 + SGR 拼装）、lipgloss（**降级放写出端**，非 TTY 直接全剥色：
*"If output isn't a TTY… colors will be stripped entirely"*；浅/深底用 `LightDark()` 而不是调亮度）、
colorprofile（探测=纯函数读 env，降级=write 时转换）、lipgloss `table/testdata/*.golden`
（网格排版的验收方式就是 **golden 文本快照**）。

### 5. 可测性（不需要眼睛）

两个纯函数：

1. `render_grid(items, W, profile, unicode) -> list[list[Segment]]`，`Segment=(text, role)`，
   `role ∈ {DIM, NONE, BG, BOLD, GRAY}`，**BG 段只带 rgb，不带转义串**；
2. `downgrade(rgb, profile) -> str`（返回 `48;5;N` 或 `48;2;…` 的参数部分）。

会真失败的断言：

- 每行 `sum(display_width(text)) == W`（一条抓住全部对齐 bug，含 CJK 双宽与 `─` 变宽）；
- 每个色块段 `display_width == 2` 且 `role == 'BG'`（"正方形"被断言住了）；
- `downgrade` 表驱动（`#FF0000`→256:196；纯灰→232-255）+ 幂等；
- 无色档：`|lum(a)-lum(b)| >= 阈值` 时断言两者字形不同；
- **60/80/120 × truecolor/256/16/none = 12 个 golden 文本**，改一行排版就 diff。

---

## 第三部分、方案：这张图落在 ace 的哪里

### 0. 先明确这张图是什么、不是什么

- 它是 `docs/style-dictionary-preview.svg`，**画的是设计意图**：12 项、两列、编号 + 色块 + 中英双名、
  只靠留白与灰阶分层。已做结构自检（XML 合法、12 项无一溢出/与英文名重叠）。
- 它**不是**逐 cell 的真终端渲染。真终端里：色块 = 2 空格 + 背景色；细线要用 ASCII 或 DEC 线绘；
  亮色那屏的米白底**必须由主题提供**（实现里不铺整页底色）。
- 顺便一个反直觉的结论：**Claude Code 没做这件事**（它的 `/theme` 预览文字样式，不是色卡网格）。
  所以这是"样本里没人做对的一块"，而不是抄谁的作业。

### 1. 推荐：做成一个 `/theme` 风格词典页

顺序上它应该是**第一个"只在一条路上实现"的功能**，正好当"定渲染器"的试金石（见
[`docs/TUI-DESIGN-STUDY.md`](TUI-DESIGN-STUDY.md) 第十节）。

| 步骤 | 做什么 | 落点 |
| --- | --- | --- |
| 1 | 纯函数渲染器：`render_grid()` + `downgrade()`，无 IO、无打印、不看时钟 | 新增 `ui/ace_swatches.py` |
| 2 | 能力探测复用既有实现（并把 `WT_SESSION` 判定改走 `COLORTERM`） | `ui/ace_term.py:60-74` |
| 3 | 颜色来源复用语义 token，不新增调色板 | `ui/ace_theme.py:26-65` |
| 4 | 色块绘制与 `█` 条统一（现在 `ace_dialog.py:38`、`ace_layout.py:145` 各画一份） | 同上 |
| 5 | 装进选择器（↑↓ 选、回车应用、`/` 过滤、Esc 取消），选中行实时预览 | `ui/ace_selector.py` / `ai_code.py` 命令表 |
| 6 | 12 个 golden + 显示宽度断言 | `test_all.py`（沿用 `check()` 风格） |

### 2. 明确不做

- 不做色卡动画、不做渐变（`ui/ace_spinner.py` 的"不插值"原则同样适用）。
- 不为它写第二套 Textual 实现。**如果要写第二遍，那说明第一步"定渲染器"必须先做。**
- 不引入 `wcwidth` 依赖：`unicodedata.east_asian_width` 够用；等遇到 emoji ZWJ 精确宽度再说。

### 3. 验收标准（都可执行）

1. 60 / 80 / 120 三个宽度下，每一行的显示宽度**严格等于**终端宽度；
2. truecolor / 256 / 16 / 无色四档都不串色；无色档在亮度差 ≥ 阈值时字形不同，且**每项都带 hex 或名字**；
3. 任何档位下色块恰好占 2 cell；
4. `python test_all.py` 全绿（含新增 section）；
5. 人工确认只有一处：色块在**你的**终端里是否真的看着像正方形（这条只能人眼，属"物理世界要调的旋钮"）。

---

## 第四部分、像素技术目录（15 个仓库 + Claude Code，全部带出处）

### 4.1 一个格子里能塞几个像素

| 颗粒度 | 做法 | 谁在用 |
| --- | --- | --- |
| 1 字形 | `█ ▀ ▄` 当实心/半实心 | 所有人 |
| **2 像素** | `▀` 上半个 = 前景色、下半个 = 背景色（一个格子 = 上下两个像素） | `opencode-go image/images.go:34-48`（最干净）、Reasonix `serve_qr.go:104-124`（两个 QR module 压一格）、oh-my-pi `apps/git/avatar.ts:10-29`（identicon）、pi `doom-component.ts:39`（真彩放 DOOM 帧） |
| **4 子像素** | 四分之一方块 `▛▜▙▟▘▝▖▗` 组合出 16 种图案 | Claude Code 的三角色精灵；plandex `view.go:225-262` 的中段截断；gemini-cli `AppHeader.tsx:30-45` 小 logo |
| **8 点** | 盲文 U+2800 起，一个格子 2×4 点阵 | codex `renderer.rs:13-15,41,270`（60×24 格 = **11520 个采样点**的 logo 形变动画）、Codewhale `pet_sim.rs:789-824`（鱼/水母/宠物）、`mark.rs:55-75`（品牌字标由 PNG 生成） |

盲文位掩码表（两家的写法一致，可直接抄）：

```python
BRAILLE_BITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]   # [dy][dx]
grid[y // 4 * w + x // 2] |= BRAILLE_BITS[y % 4][x % 2]
char = chr(0x2800 | bits)
```

**反直觉**：8 个 TS/Ink 仓库里**没有一个**用盲文画图（oh-my-pi 只拿 `⣾⣽⣻⢿⡿⣟⣯⣷` 当 8 帧 spinner）；
真点阵只有 Rust 两家在用。跨语言分派很清楚：**Ink 系画色阶，Rust 系画点阵。**

### 4.2 什么场景用哪种颗粒度（这才是审美，不是技术）

| 要画什么 | 用什么 | 出处 |
| --- | --- | --- |
| 波形 / 电平 / 频谱 | `▁▂▃▄▅▆▇█` 8 级 + 峰值衰减 0.84/帧 | codex `voice_strip.rs:206`、oh-my-pi `live-visualizer.ts:28,96` |
| 进度 / 配额 | `█`×n + `░`×m，**故意只做整格**，`round()` | codex `rate_limits.rs:24-26,374-384`、Codewhale `workbar.rs:283-288`、crush `filepicker.go:285` |
| 柱状图（要半格） | 8 级 partial block `[' ','▁',…,'█']`，负值用反色做上锚 | codex `painting.rs:36-42,65-68,90-92` |
| 图片 / 头像 / 二维码 | `▀` 双像素逐 2 行采样 | opencode-go `images.go:34-48`、Reasonix `serve_qr.go`、pi `daxnuts.ts:43-53` |
| 密度场 / 水面 / 热力 | `░▒▓█` 四档 + 哈希抖动消色带 | oh-my-pi `splash.ts:32-37,77-82`、crush `availableRunes` |
| 品牌字标 / 插画 | 盲文点阵（从 PNG 生成，不手绘） | Codewhale `mark.rs:50-75`、codex 空态动画 |
| 微光 / 呼吸 | 只改**背景色**，余弦 `powi(8)`、每 3 列采样、遇文字行截断 | Codewhale `ambient_life.rs:1245-1284` |
| 阴影 / 立体字 | `_` `^` `~` 标记语言（空格+bg / ▀(fg+bg) / ▀(仅 fg)） | kilocode `kilo-logo.tsx:7-11`、opencode `logo.ts` |

### 4.3 十二条可复用规则

1. **取帧用时钟取模，不要累加计数器**：`frames[elapsed_ms // 80 % n]` —— 多组件天然同拍、后台不空转。Codewhale `spinner.rs:45-49`、codex `voice_strip.rs:69`、Reasonix `chrome.go:114`、oh-my-pi `segments.ts:186`。
2. **掉帧只跳帧，不狂闪**：`steps = floor(elapsed / interval)` 一次推进多帧。oh-my-pi `loader.ts:158-163`。
3. **背压**：下一帧延迟 = `max(周期, 本帧实测成本 × 9)` → 帧越贵动画越慢，天花板 ≤10% CPU。oh-my-pi `loader.ts:170-181`。
4. **最小显示时长**：<400ms 的任务不播动画，只显示静止 `›`；plandex 硬等到 700/350ms。Codewhale `spinner.rs:23-24`、plandex `spinner.go:10-11,37-43`。
5. **帧表要"点数连续"**：`["⣀","⣄","⣤","⣦","⣶","⣦","⣤","⣄"]` 相邻差 1 点，才不会有空白跳变（有断言）。Codewhale `spinner.rs:18,137-146`。
6. **进度条先扣掉 chrome（括号+百分比）再算条宽**，并按字形 `display_width` 折算格数（容忍双宽字形）。oh-my-pi `progress-bar.ts:42-48,127-135`。
7. **渐变色预渲染成 ramp，逐帧只做位移**（`BlendHcl` 生成 width 长色带）。crush `anim.go:222,466-511`。
8. **同色 run 合并再输出**：一帧只发几组 SGR，而不是每字符一组。oh-my-pi `shimmer.ts:238-253`、codex `codex-reset-fireworks.ts:259-273`。
9. **周期性背景预烘帧缓存**：138 帧 `Uint16Array` fg/bg，换帧 = memcpy。opencode/kilocode `bg-pulse-render.ts`。
10. **降级分三档**：真彩单字形+色阶 → 16 色用 `dim()` 代透明度 → ASCII 映射表（`░▒▓→":"`、`█▀▄▊▌→"#"`、`▏▎▍→"|"`）。Codewhale `glyphs.rs:44-90`、codex `palette.rs:19-35`。
11. **图像预算降级要保持原高度**（"a budget demotion never shrinks the block"），否则布局跳动。oh-my-pi `components/image.ts:856-866`。
12. **帧预算写死并断言**：`assert!(cols<=60 && rows<=24)`、`MAX_PET_FRAMES=256`。codex `renderer.rs:13-15`、`pets/model.rs:29`。

### 4.4 审美规则（这一节比技术重要，且全都是"减"）

- **收慢一点更好看**：Codewhale 把 spinner 从 8Hz 降到 5Hz，注释写 *"without the restless flicker the faster table produced"*（`spinner.rs:29-31`）；氛围帧从 80ms 调到 120ms（*"no longer feels restless next to real content"*）。
- **别硬切**：12.5Hz 的全开全关掩码在真彩下 *"look like dropped frames"*，改成余弦交叉淡入（`ambient_life.rs:1269-1272`）。
- **一个事实只能有一个主人**：两条侧道同时放脉动剪影，会 *"read as resident scenery instead of a passing visitor"*，所以水母恒定 ≤1（`whales.rs:132-136`）。
- **低色终端必须靠字形而不是颜色区分**：留 `□ / ■` 一对宽窄相同的填充/空心字形（codex `palette.rs:19-22`）。
- **手工画的美术会被下架**：Codewhale 删掉手绘鲸鱼，*"the only sanctioned terminal mark is the one generated from the brand master path"*（`underwater.rs:606-610`）。
- **减少动效是设置项，不是彩蛋**：Claude Code `prefersReducedMotion`（*"Reduce or disable animations for accessibility (spinner shimmer, flash effects, etc.)"*）、codex `MotionMode::Reduced → 直接不画`、Codewhale 窄窗口直接 return。
- **动画会"看起来冻住"**：crush 有专门的回归测试断言"agent 不忙时不转 spinner"（`session_busy_test.go:471`）——缓存/重绘一断，动画就是 bug。

### 4.5 会真的坏掉的坑（Windows 相关的前两条对 ace 直接影响）

1. **老 conhost 的实测字宽不是 1**：Reasonix 用 `WriteConsoleW` + 光标回读量出 `'█':1 '│':1 '─':1` 但 **`'●':2 '■':2 '◆':2 '·':2 '…':2`**（`glyph_fit_test.go:15-22`，注释 #10540），并带一张 `conhostBestFit` 替换表。ace 面向 Windows 用户，这条必须接（`ui/ace_cards.py` 的 `TOOL_GLYPH`/`GLYPH_FALLBACK` 已是同类机制）。
2. **能力探测的响应会漏成可见文本**：cline 直接放弃 kitty 位图，因为探测回包会显示成
   `Gi=31337, s=1, v=1, a=q, t=d, f=24; AAAA`（`opentui-env.ts:1-21`）。
3. **tmux/复用器里不能用光标定位放图**（外层终端不知道窗格滚动状态）。oh-my-pi `kitty-graphics.ts:66-68`。
4. **sixel 高度必须是 6 的倍数**，否则终端多占一行把图底切掉（oh-my-pi `terminal-capabilities.ts:1348-1367`、codex `sixel.rs:12-16`）。

### 4.6 谁干脆不用格子

plandex 全仓 **0 处**块字符（装饰靠 emoji）；goose 没有 ratatui/crossterm，块字符仅 1 处，把逐格绘制整个交给第三方库。
**这是合理的懒惰**——不画就不会画错。ace 的选择是画（色卡、卡片、任务树已经在了），那就把上面这些规则挑着用，而不是全都上。

---

## 附录：取证脚本（可复现）

```powershell
# 在 230MB 的 Bun 单文件里按字节找可读 JS 字符串，并打印 ±120 字节上下文
$exe = 'G:\ClaudeCode\npm-global\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
$enc = [System.Text.Encoding]::GetEncoding(28591)
$fs = [System.IO.File]::OpenRead($exe); $buf = New-Object byte[] (8MB); $carry = ''
while (($read = $fs.Read($buf, 0, $buf.Length)) -gt 0) {
  $chunk = $carry + $enc.GetString($buf, 0, $read)
  $i = $chunk.IndexOf('你的关键字', [StringComparison]::Ordinal)
  if ($i -ge 0) { ($chunk.Substring([Math]::Max(0,$i-120), 280) -replace '[^\x20-\x7E]', '.') }
  $carry = $chunk.Substring($chunk.Length - 400)
}
$fs.Dispose()
```

⚠️ **Unicode 字形（█ ▀ ⏺ ⎿ 等）不要用这个方法探测**：二进制里混有压缩数据与 ripgrep/bun 自带的
字符串，命中率极低且全是噪声。字形结论只在**可读 JS 上下文**里才可信。
