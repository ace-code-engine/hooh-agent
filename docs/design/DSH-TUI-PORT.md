# dsh-TUI 移植方案（配色 + 页面布局）

> 来源：[github.com/ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)，本机副本在
> `G:\ai工作区\dsh-TUI-main\dsh-TUI-main`（TypeScript + 自研 Ink 渲染器，`src/` 下 400+ 文件）。
> 目标：把它成体系的**配色**与**页面布局**移植进 ace，并给 ace 加上自定义主题色能力。
> 本文只写决策与数字，不写走过场。

---

## 一、它有什么（可抄的部分）

| 资产 | 它的位置 | 我们对应的位置 |
| --- | --- | --- |
| 雾蓝色板 `dark` / `light` / `dark-ansi`（73 个 token） | `src/theme.ts:239-480` | `ui/ace_theme.py` 的 `THEMES`/`CELL_THEMES`（17 个 token） |
| `auto` 伪主题（OSC 11 跟随终端背景） | `src/theme.ts:189-219` | 我们的 `detect_theme()`（`COLORFGBG`，没有 OSC 11） |
| 自定义主题 `~/.dsh-tui/themes/<name>.json`（`base` + `colors` 局部覆盖） | `src/customTheme.ts` | `~/.ace/themes/<name>.json`（本方案新增） |
| 色值六种写法（`#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `ansi256()` / `ansi:name`） | `src/customTheme.ts:57-136` | `ace_theme.sgr()` |
| 开屏降级阶梯（窄终端先撤鲸鱼、再撤大字、最后一行纯文字） | `src/components/splashLayout.ts`、`launchpadLayout.ts:177-201` | `landing_lines()`（现在只有一档） |
| 网格：页边距 / 列间距 / 行内间隔 / 块间距 | `src/components/PageMargin.tsx`、`tuiDisplayPrefs.ts:98-110` | `ui/ace_panel.py`（有宽度感知，没有网格常量） |
| 侧栏分割：`chat ≥ 64`、`panel ≥ 28`、分隔 1 列 → 合计 **93 列**才分栏 | `src/components/sidePanel/dimensions.ts:20-37` | `ui/ace_fullscreen.py`（无分栏） |
| 字形清单（`❯ ● ✓ ✗ ⎿ ─ ╭╮╰╯ ▌` …）与东亚宽窄风险 | `src/terminal-utils/figures.ts` 等 | `ui/ace_cards.py` 的 `TOOL_GLYPH` / `GLYPH_FALLBACK`（已有同类机制） |

**它比我们多的是 token 粒度，不是审美。** 它有 85 个槽位（syntax/diff/toolDot/subagent 各自成组），
我们只有 17 个 —— 所以移植是**按语义挑**，不是逐字搬：`accent→accent`、`inactive→dim`、
`promptBorder→border`、`toolCardBackground→user_bg`、`toolNameExec→perm_ro`（读=青）、
`toolNameMutate→perm_write`（写=金）。

---

## 二、阶段①（已完成）：配色地基 + 自定义主题色

### 2.1 先修根因：三种值格式 → 一张表

改之前，同一件事有三个互不兼容的表示，三个地方各存一套：

| 系统 | 值格式 | 谁在用 |
| --- | --- | --- |
| `THEMES` + `tc()` | Rich 色名（`ansiyellow`） | 只有测试 |
| `CELL_THEMES` + `cell()` | 现成 SGR 串（`38;5;173`） | 引擎屏（`ui/ace_render.py`） |
| `ai_code.ANSI` + `c()` | 完整转义（`\033[33m`） | **全部传统 REPL / 首屏 / 卡片 / Markdown，且完全不认主题** |

于是"改一次色要改三个地方，其中两个必然被漏"。现在：

- **`ui/ace_theme.py` 是唯一真相源**：`PALETTES` 一张表（色板名 → token → 值），
  `sgr()` 是**唯一**认格式的地方（`#RRGGBB` / `rgb()` / `ansi256()` / `ansi:name` / Rich 色名 / 现成 SGR 串 / `bg:` 前缀）。
- `c()` 取值顺序：结构色（bold/dim/italic/reset）→ `ace_theme.sgr_for(token)` → 旧 `ANSI` 表兜底。
  **未知色名仍然降级为不上色**（这是踩过两次崩溃的回归点）。
- `frontend/src/theme/tokens.ts` 做同一张表的镜像，`test/theme.test.ts` **直接读那个 .py 逐条比对** ——
  这是"两套 UI 都跟"的强制手段，不是靠文档提醒。

### 2.2 不改变默认外观

`detect_theme()` 仍然返回 `dark` / `light`（旧两套，值一个字没动）。
雾蓝必须显式要求：`--color mist-dark` 或 `--color auto`。
实测踩到的回归：第一版把 `COLORFGBG` 浅底检测改成返回 `mist-light`，直接顶掉了
"浅底 → light" 这条既有契约（测试红）。**升级不该替用户决定他要看什么颜色。**

### 2.3 `--color` 的语义（一个开关，两种写法）

```
ace --color mist-dark                      # 选色板
ace --color auto                           # 跟随终端背景 → mist-light / mist-dark
ace --color accent=#FF9EC7,warn=#E0C08A    # 在当前色板上局部覆盖
ace --color sakura                         # ~/.ace/themes/sakura.json
```

判据是**值里有没有 `=`**：有 = 覆盖式，没有 = 色板名。认不出来返回空串/`ok=false`，
调用方**如实报错**（静默忽略的症状是"这个开关怎么没生效"，用户会以为功能坏了）。

自定义主题文件（形式照 dsh-TUI，`base` + `colors` 局部覆盖）：

```json
{"name": "sakura", "displayName": "樱花粉", "base": "mist-dark",
 "colors": {"accent": "#FF9EC7", "warn": "#E0C08A"}}
```

未知键与坏值**逐键跳过**（警告），坏 JSON 只废掉那一个文件 —— 一个坏主题不该挡住启动。
主题名是用户输入，`_safe_theme_name()` 挡住路径穿越。

**未做**：持久化的 `/theme` 选择器（dsh-TUI 有热切换 + 实时预览）。等布局阶段一起做，
免得为一个还没有的界面写选择器。

### 2.4 终端外壳也收进色板（阶段②顺手清的尾账）

底栏 / 补全菜单 / 全屏会话 / 选择器这四处此前**各自内联一份十六进制**
（`ai_code.py`、`ace_fullscreen.py`、`ace_selector.py`），换色要改三个地方、必然漏两个。
现在共用 `ace_theme.ptk_styles()`：dark / light 的值**逐字保留**（含"这两套本来就共用
同一份外壳、没分深浅"这件事），雾蓝外壳则**全部**由同一张色板推出来。

这一层刻意**不塞进 17 个语义 token**：它管的是"界面底色与选中块"，语义 token 管的是
"文字该是什么颜色"；混在一起会把前端 `theme.test.ts` 钉死的 17-token 契约撑大，
而收益只是三个外壳。

顺手抓到一个会让用户直接崩的 bug：**prompt_toolkit 的色名白名单里没有
`ansibrightwhite`**（`ansibrightblack` / `ansibrightblue` 都有，实测只缺这一个），
而雾蓝 16 色板的 `text` 正是它（照 dsh-TUI 的 `ansi:whiteBright` 抄的）——
`--color mist-ansi` 一开经典 REPL 就 `ValueError`。现在进 prompt_toolkit 前统一过一道
`_ptk()` 名字修正，并且有一条**逐色板喂给 `Style.from_dict`** 的测试守着这件事。

---

## 三、阶段②③：页面布局

### 3.1 抄什么（有精确数字，可直接落）

**坐标约定**：`PageMargin` 是**唯一**减页边距的地方，它把 `TerminalSizeContext` 收窄成内容区；
它以下的每一屏都按**内容宽**算，**不许再减一次**（我们目前没有这层，所以每条规则里都塞着 `- 2`）。

| 量 | 它 | 落到 ace |
| --- | --- | --- |
| 页边距（默认） | `x=2, y=1`（另有 none/slim/roomy/custom；上限 `8x4`） | `ui/ace_panel.fit_width` 之上加一层 |
| 开屏卡片宽 | `max(24, min(columns-4, 72))` | `landing_lines` 的菜单区 |
| 开屏 参数行缩进 / 分隔 | `paddingLeft 2` / `'  ·  '`（5 格） | 会话面板那几行 |
| 提示行与卡片的呼吸 | 2 行（紧 1 行） | — |
| 开屏角落板 | 2 行 + 预留 1 行 = 预算 3 行 | `_footer()` |
| 转录侧槽 | **2 列**（<60 列直接不画，但槽位保留） | `ui/ace_fullscreen.py` |
| 输入卡片 | **3 行** = 上边框 + 1 行值 + 下边框（`╭ ╮ ╰ ╯`，**不画左右边框**） | `ace_prompt.LineEditor` |
| 状态行 | 最多 3 行（上下文条 1 + 字段 1 + 补充 1），`paddingX=1`，组间 `gap=2`；`barWidth<14` 不画条 | `ui/ace_layout.fit_status_line` |
| 侧栏分栏 | `chat ≥ 64` + `panel ≥ 28` + 1 列分隔 = **≥93 才分**；比例默认 `0.68`，每步 4 列 | 新增 |
| 分栏内部 | `PanelBar(1) + 细线(1) + 内容(rows-4) + 细线(1) + 提示(1)` | 新增 |

**垂直节奏（最核心的一条）**：每个块**上方恰好 1 行空行，第一个块除外**；
job-group 成员是 **0**（那条空行正是"分组"要消掉的分隔符）。
临时浮层（选择器/补全）占 **0 布局高度** —— 所以打开选择器永远不重排转录。

**开屏降级阶梯（十档，自上而下取第一个放得下的）**：
先撤两处呼吸行（2→1）→ 参数行的间隔 → Tips 行 → 提示行 → **最后才撤画**（13 行的像素画）。
即：**空白永远比内容先被撤掉**。横向断点：大字 `titleWidth`（56 / 72 两档），画 40 列。

### 3.2 分三步，每步可单独验收

1. ✅ **网格层（已完成）**：`ui/ace_cell.content_width(cols, margin)` 成了**全仓唯一减页边距的地方**
   （抄 `PageMargin` 的那条不变量：它把终端尺寸收窄成内容尺寸，下面每一屏都按内容宽算、**不许再减一次**）。
   `SessionScreen` 新增 `margin=` 并让**车道一（转录）与底部区走同一条缩进**；`ace_cell.margin()`
   也支持自定义格数。`ace_screen.check()` 里加了 60 / 80 / 120 三档 golden：底部区每条**恰好等于终端宽**、
   左右各 `MARGIN` 格、转录同样缩进。
   *为什么先做这个*：ace 此前是反过来——每个屏各自拿终端宽再各减各的（`fit_width(cols, margin=4)`
   一处、`ace_screen` 一处、全屏状态行一处），"还剩几列"有几种算法，窄终端上就表现为有的地方溢出、
   有的地方白留。
2. ✅ **状态行（已具备，顺手修了一处死分支）**：研究里点名的"两份状态行实现"在本仓已经收敛——
   `tui/app.py` 那条字符串拼接分支随 `tui/` 一起拆了，`cli._footer()` 与 `--preview` 都走
   `ace_layout.fit_status_line`（带 priority 与丢弃顺序）。但引擎屏的 `_status_line` 把
   `fit_status_line` 返回的 **`(样式类, 文本)` 当 `(字段名, 文本)`** 去比 `== "permission"` ——
   样式类实际是 `"class:footer-w"`，那条分支**永远不命中**，于是"当前是写权限"这个最该看见的事实
   被画成了次要灰。现在按样式类映射语义角色：只读灰（安全不上色）/ 可写黄 / 全权红 / 目标绿。
3. ✅ **输入区（已完成，且纠正过一次）**：`ui/ace_screen.input_card(rows, bleed_width)` ——
   输入行上下**两条出血到终端左右边缘的整宽细线**，菜单/提示行接在线之后。
   *纠正*：第一版我照 `EffortInputBorder` 的**启动页**输入卡做成了「内容宽 + 圆角 `╭ ╮ ╰ ╯`」，
   而 dsh-TUI 的**聊天页**输入行是上下两条整宽细线（看它的真实截图确认）。同一个组件名在两处
   形态不同，抄错了版本 —— 圆角框是启动页的东西。
   渲染层为此有一条判据：`SessionScreen.set_region` 对「宽度已经等于终端宽」的行**原样放行**
   （出血结构线不加页边距），内容行照旧吃页边距。前端 `<Input>` 同样补上了上下两条 `Rule`
   （`bleed` 默认开），`test/page-margin.test.tsx` 钉住"线从第 0 列直通右缘、输入行留在内容列"。

5. ✅ **首屏与聊天头部去掉圆角边框（已完成）**：`landing_lines()` / `_session_panel` /
   `_recent_panel` 原来用 `ace_panel.box()` 画两个圆角框 —— 而 `docs/TUI-SWISS-SPEC.md`
   §1.2 写的就是"**不用边框**，分区只用整宽细线"、§五 禁止清单第一条也是"边框"。
   **这不是"要不要抄它"，是自家规范没落地**；dsh-TUI 的首屏/聊天头部恰好同为零边框。
   现在分区一律走 `ace_panel.section()`（并给 `section()` 加了 `right=`，把版本号从"框的上边框"
   挪到"标题行右端"）。演示图四张随之重录，`demo/record_demo.py --check` exit 0。

**状态行的三段式：核过之后**不抄 —— dsh-TUI 的第一段是**上下文占用条**，而我们的字段行里
已经有 `上下文 N%` 这一项（`_status_segments` 的 `context` 段）。同一条事实画两遍是重复表示，
不是布局；第三段"常驻补充行"在我们这也没有内容可放。所以 Python 侧的状态行**保持一行**，
规范里的"最多 3 行"没被违反（它是上限，不是配额）。

4. **Ink 前端**：核过之后，剩下的**不是**我原先以为的那几项 ——

   - ✅ **`PageMargin` 已经移植过了**：`frontend/src/components/layout/PageMargin.tsx` 开头就写着
     借鉴对象是 dsh-TUI v0.12.0（MIT）的 `PageMargin.js`，`PAGE_INSET = {x:2, y:1}` 与上游
     `normal` 档一致，连"内容盒必须给**数值宽**（百分比宽会宽出 2x）"这个坑都记了。
     本方案里的 `ace_cell.content_width`（Python 侧）与它是同一条款的两个实现。
   - ✅ **状态行的丢弃规则也已经同口径**：`frontend/src/components/StatusLine.tsx` 的
     `fitSegments` 是"引擎分段优先 + 按优先级丢 + 按**显示宽度**比"，与 `ace_layout.fit_status_line`
     一条口径。三段式在这里同样**不抄**（理由同上：上下文占用已经在字段行里）。
   - ⛔ **"状态行钉在最底"没做成 —— 卡在内核，不在意愿。** dsh-TUI 靠 `OverlayAbove`
     （绝对定位 + `bottom:100%` + `opaque` 遮挡）让弹层零布局高度，状态行因此永远不会被顶走。
     照它的写法实现了一遍、并**用真实渲染取证**之后，结论是**我们这个 vendored 内核接不住**，
     三条硬证据：
     ① **没有遮挡能力**：内核里 `opaque` / `occlusion` 出现 **0 次**（`kernel.d.ts` / `kernel.js`
        全查）。上游的 `opaque` 正是"浮层矩形内每格用空格垫满、绝不重影"；没有它，浮层只写
        自己那几个字符的格子 —— 实测盖在转录上得到 `菜单一一行`（"转录第二行"的残字透出来）。
     ② **没有高度上报**：`Menu` 只能收"列表项窗口"（`height` → `render/menu.windowBounds`），
        标题/提示行的**渲染总高**不在内；而浮层是**从顶部裁**的，被裁掉的第一行正好是列表首项
        —— 也就是默认的选中项。实测：锚点上方 2 行时菜单只剩一行提示，选中项 `/help` 看不见。
     ③ **合成的行位置不稳定**：同一棵树两次渲染，浮层分别落在第 0/1 行与只落在第 1 行，
        对不上；把每行垫满空格反而更乱（`["转录第一行","  录第二行", …]`）。
     
     证据齐了之后我把这套东西**删掉了**（`OverlayAbove.tsx` / `overlayBudget.ts` /
     两个测试文件，一个没留）—— 不留无人消费、且已知会重影的半成品。要做这条，前置条件是
     **给 vendored 内核补 opaque 合成能力**（或换一个支持它的内核）：那是内核侧的工作，
     不是前端排版工作，也不该由"抄布局"这件事顺手吞下。

     旁证：`frontend/src` 全仓 `position="absolute"` 仍是 **0 处** —— 不是没人想到，
     是这台内核上没人敢用。
   - ❌ **工具卡的 `⎿ ` 缩进槽不抄**：dsh-TUI 的工具体是 3 列槽（首行 `' ⎿ '`、其余 `'   '`）。
     ace 现在是 `marginLeft={2}` 的两格缩进 —— 层级效果相同，而 `⎿` 属东亚歧义字形
     （`docs/TUI-SWISS-SPEC.md` §5 明令"不赌歧义字形"），换上去要动两侧 golden 换一个纯审美差异。
   - ❌ **`SidePanel`（≥93 列分栏）不做**：那是 dsh-TUI 有、ace 没有的**产品面**（右侧面板 + 分栏
     比例 + 拖拽），属于新功能而不是"移植布局"。要做请单独立项。

**首屏（Launchpad）不照搬**：dsh-TUI 的 Launchpad 是"hero + 输入卡 + 参数行 + 提示 chips + 角落板"，
而 ace 的首屏是一个**启动菜单**（7 个条目 + 会话面板）。把菜单换成输入卡是**产品决定**，不是移植，
不由这次顺手做掉。角落板同理（它属于首屏，不属于引擎屏的底部区）。

**阶段②到此收口**：3.1 表里能搬的三项（页边距单点、输入卡片、状态行按宽度丢分段）都已落地或被核定；
状态行三段式与角落板经核实属于"重复表示"与"首屏产品面"，不搬（理由见上）。

### 3.25 参考件第二轮（会话管理屏 + 可点）——已做的与做不了的

上游又露了两屏：**会话管理**（双栏 + 顶部标签 + 筛选行 + 右对齐计数 + 右缘滚动条 + 底部键位栏）与
**聊天页细节**（折叠思考行写明展开键、工具卡右对齐耗时、悬挂缩进、底部回顾行、状态条整宽反显）。

**✅ 已做（P2）**：列表行改成**两行一条**——主行右对齐计数、次行降灰放会话文件名
（`ace_panel.list_row`，首屏「最近会话」先落地）。右对齐才便于竖着比大小，次行降灰才分得出主次。

**✅ 已做（引擎屏底栏）**：状态条挪到输入区**下面**（上游 `Chat.tsx:6154`），整宽反显、`上下文 N%` 固定右端。

**⛔ 点击：内核只在备用屏派发，主屏做不到。** 这条花了不少时间，结论是硬的：

- 内核把能力全给了（`BoxProps.onClick`/`onMouseEnter`/`onWheel`/`onContextMenu`，命中测试
  `hit-test.js`），`Root.tsx` 也挂了 `MouseTracking`（主屏也上报鼠标事件）——但**没有任何组件消费**，
  所以"点了没反应"。
- 真因在 `lib/types/ink/ink.js`：`dispatchClick` / `dispatchContextMenu` 开头都是
  `if (!this.altScreenActive) { logMouseDebug('dispatchClick skipped — alt screen inactive', …); return false }`。
  用内核自带的 `DSH_TUI_DEBUG_MOUSE=1` 实证：事件到了（`mouse arrive {col,row}`）、坐标也对，
  紧接着就是 `dispatchClick skipped — alt screen inactive`。
- 为什么上游这么设计：主屏下帧只占屏幕底部一块，鼠标报的是**绝对屏幕坐标**，映射不回帧行。
  上游自己没解决，只在备用屏（`--fullscreen`）里派发。
- 我们做了组件侧接线（`ListItem` 加 `onClick`/`onHover`/`right`，`Picker` 点一项即认定、
  悬停跟随光标），**备用屏下一开闸就能用**；但套件里驱动不了备用屏那条路
  （`<AlternateScreen>` 挂载后合成 stdin 不再被消费；内核日志 `alt-screen enter {inkFound:true}`
  说明 `setAltScreenActive(true)` 调到了，鼠标序列却进不去），所以**没有端到端验过**，
  只把"主屏点不动"这个事实写成断言钉住（`frontend/test/click.test.tsx`）。
- 结论：**"全可点"在我们的主屏默认模式下不可能实现**，除非给内核补坐标映射（`\x1b[6n` 回读光标行
  再换算），那是内核侧工作。

**⏳ 未做（P1）**：**会话管理屏**（双栏 + 标签 + 筛选 + 滚动条 + 底部栏）。这是**一屏新功能**，
不是排版微调；数据面要接 `.ace_sessions/` 与 workspace store，交互面要接键位与（备用屏下的）点击。

**✅ 已做（P1）**：**会话管理屏** `frontend/src/components/sessions/SessionManager.tsx` ——
双栏（左工作区 / 右会话）+ 筛选行 + 右对齐计数 + 两行一条 + 底部键位栏，照用户给的那张截图。
入口接在**既有的 `/resume` / `Alt+H`** 上（不新增键位、不动协议）：选中后回传的仍是
`/resume <编号>`。纯逻辑拆在 `sessions/layout.ts`（分组 / 过滤 / 工作区名），可单测。
7 个 i18n 键 × 三语，并登记进 `i18n-complete.test.ts` 的键表白名单。

*看真帧才抓到的三个错*（不是猜的，都是渲染出来才看见）：
1. 按"会话路径的父目录"分工作区 → 所有项目都会显示成 `.ace_sessions`（会话都放在
   `<项目根>/.ace_sessions/`）。必须**穿过**那一层，取项目根。
2. 标题右边拿 `sessions_turns` 显示"会话条数"，渲出来是「4 轮」—— 键用错了，另立 `sessions_manage_count`。
3. 左栏表头 `N 个工作区` 在 60 列下**折行**，左栏第一行不再是表头 —— 按栏宽截断。

**⏳ 数据面还差一块**：引擎的 `sessions.request` 是**按当前项目**列的，所以左栏今天只会有一个
工作区（上游那张截图有 18 个，因为它全局登记）。要真做到那样，得让引擎**跨工作区**列会话
（`WorkspaceStore` 已经存在，是接线问题不是新机制），那属于协议/引擎改动，没在这次里顺手做。

**✅ 已做（活动行 —— "本轮在干什么"）**：上游的槽位是 **活动行在输入簇之上**（`Chat.tsx:5954`）、
**底栏在输入簇之下**（`:6154`）。我们此前只有底栏：**引擎屏把活动这条信息整个丢了**。

*根因*：经典 REPL 那句 `\r◈ 思考中 3s` 带 `\r`，被 `_LineSink` 按"带 `\r` 的重绘不是定稿"
整条丢掉（那条规矩本身没错：写进 scrollback 只会变成残影），于是工作期间屏幕上只剩底栏里
一个 `⠋ 3s`，**看不出在思考、在等首字节、还是在调工具**。

*改法*：`ace_engine_repl._activity_line()` + `run_session(activity=...)`（新槽位，在输入区**之上**），
底部区顺序变成 `[活动行] → [输入区] → [底栏]`。内容复用现成件：`ace_spinner.frame_at(phase,…)`
（阶段字形）+ `_Spinner.phase/_label`（阶段文案）+ `ToolBoard.headline()`（工具摘要）；
**单个工具在跑时用 `calling_tool_named` 说具名**（"正在调用 file_write"）——这个键本来就在，一直没人用。
空闲时活动行返回空（它就是"此刻在干什么"，干完了就该消失）。

*前端*：`Spinner` 新增 `tool`，`App` 传"最后一条还在 running 的工具"，工具阶段显示
「正在调用 {tool}」而不是笼统的「准备中」。

**✅ 已做（转轮换成噪声填充 —— 替掉"月亮"）**：上游的**工作活动指示器默认预设是 `moon8`**
（`dsh-working-activity/src/frames.ts:110`，注释写着「kimi-code MoonLoader 同款：8 帧 emoji 月相」），
我们这边的 `reasoning` 帧 `◐◓◑◒` 就是同文件的 `moon` 预设（`:48`）。现在换成
**`circle-noise-fill.html` 那套算法的 5 格缩微版**：

- **缩小**：源片 646² 像素 → 终端 **5 格**（`NOISE_CELLS`）。`CELL`/`FREQ`/`OCT` 这些
  按像素调的旋钮不照抄（§4.7 已经写明：字符格只有几行，照抄会变成"整行一起亮"）。
- **圆不抄**：源片那句 `if (Math.hypot(x,y) > R) continue` 是**范围**不是绘制；这里 5 格就是范围。
- **出生顺序照抄**：每格一个阈值，阈值由**一维值噪声**排名归一化（`(rank+1)/(n+1)`）——
  源片用 `rank/(len-1)`，几万像素看不出差别，5 格时首帧会先亮一格（像"已经填了一半"），
  所以两头都收干净。缓动只作用在进度上（smoothstep）。
- **倒放**（用户要求）：源片 `LOOP=false` 是一次性填充，做成指示器得往回走 ——
  帧序列 = 正向填满 + 镜像倒放（11 帧 × 0.18s ≈ 2s 一轮，中间在"满"停一拍）。
- 速度语义不变：`reasoning` 仍是最慢那一档（0.18 > `tool_running` 0.16）。
- 无动效（`ACE_REDUCE_MOTION=1`）时给**填满**那一帧而不是空格子 —— 静态时空格子像没在干活。

*两处会被这个改动连带打红的地方，都已跟上*：① 前端一致性测试按 `_GLYPHS` 的**字面量**解析，
帧表得写字面量、再用 `noise_frames() == list(_GLYPHS["reasoning"][0])` 把生成器钉住；
② `demo/record_demo.py` 的转轮归一是按"一个字形 + 空格"匹配的，多格帧匹配不上 ⇒
加了 `_NOISE_FRAMES` 表并整段归一到 `█████`，四个演示图已重录（`--check` exit 0）。

**✅ 已修（每轮都报 `FORMAT_ERROR`）**：模型（实测 deepseek-v4-flash）问「你好」时回**纯文本**
（不带 `<INTERNAL>/<EXTERNAL>`），而 `_model_turn` 在没有原生工具时把它**原样**交给执行层，
`_stage_parse` 只认标签 ⇒ 每轮 `FORMAT_ERROR: 缺少 <EXTERNAL> 标签`，4 张错误卡、白烧 4 轮
（12 秒）才把那段话当回答打出来。修法：`_as_final_reply()` —— **一个标签都没有**才当成
最终回答包装；只写了一半（有 `<INTERNAL>` 没 `<EXTERNAL>`）仍如实报错，那才是真错。

**✅ 已做（开屏：噪声圆盘 —— 这才是参考件那个效果）**：先把 `circle-noise-fill.html` **跑起来看**
（原算法搬到 Python + Pillow 导帧）：它是**一个圆盘**在 3.5 秒里被 5 层 fBm 噪声**成团点满**
（t=1.4 是团块、t=2.8 只剩几个洞、t=3.5 满盘银白）。所以第一版把它做成"一行 5 格"是**漫画**，
不是这个效果 —— 那是个**二维图形**。

| 源件 | 终端版（`ui/ace_noise_circle.py`） |
| --- | --- |
| 646² 画布、2px 格子 | **27 列 × 13 行**字符格（终端格 2:1，所以列数是行的两倍才"看着圆"） |
| `hypot(x,y) > R → continue`（只圈范围，一行绘制都没有） | 单元格中心映射到 [-1,1]²，圆外永远是空格 |
| `birth = rank/(len-1)`（排名归一 ⇒ 阈值 == 已填比例） | 同一口径 |
| 5 层 fBm 决定出生顺序 ⇒ 成团生长 | 同三个函数（`hash`/`vnoise`/`fbm`），频率按格子尺度重调（照抄 `.05` 会"整块一起亮"） |
| `smooth(p)` 只作用在阈值上 | 同 |
| `SH = .90 + .10*x` 斜向高光（银白金属感） | 字形 ramp ` ▒▓█`（**只取上段**：铺满整条 ramp 会变成渐变色块，源件只是一块银盘） |

接进 `_play_banner_animation`（原来那套是"标题逐字浮现 + 下划线生长"的**文字**动效）：
正向填满 → **倒放**回空，约 1.1s，多行块用 ANSI 光标上移重画（`\r` 只回本行开头，不够用）。
非 TTY / `ACE_NO_ANIM=1` / `animate:false` / `ACE_REDUCE_MOTION=1` 一律不播 —— 录制演示图
走的正是管道，所以 `demo/*.svg` 完全不受影响（已 `--check` 验过）。

*这和上游的差距*：dsh-TUI 的首屏是**彩色像素图**（`Whale.tsx` + `whaleFrames.ts` 32KB + 分层/挂件），
我们这一步只是"单色 ramp 圆盘"。逐格真彩要改渲染后端 —— `render_terminal` 目前只让 `swatch`
角色吃 `rgb`（`:170-174`），其余角色走主题调色板。

### 3.3 不许抄的

- **不照搬它的渲染器**（自研 Ink fork、Yoga 布局、脏矩形 blit）。我们有 `ui/ace_canvas.py` 的帧缓冲与
  `ui/ace_render.py` 的差分，够用；抄一套布局引擎是纯负债。
- **不抄它的 73 个 token**。ace 的语义面没那么宽；token 加了就要有人维护映射。
- **不抄手绘美术**（像素鲸鱼 40×13、小精灵 30×30 原始 RGB 数组）。

---

## 四、验证

```sh
# Python 侧：色板 / 翻译层 / --color / 自定义主题
python test_all.py --only 33

# 前端侧：token 镜像（直接读 ui/ace_theme.py 比对）
cd frontend && npm test -- test/theme.test.ts

# 手动看：色卡工具（自带主题自检）
python -m ui.ace_swatches --theme mist-dark
```

**已知环境限制（不是代码问题）**：受限 Windows 环境（本机 DSH 沙箱）下，
`G:\AI_Project\ace\.test_tmp` 只给了"建文件"没有"建子目录"的权限（目录意义上
`Write` 是 `FILE_ADD_FILE`，建子目录要 `AppendData`），且 `tempfile.mkdtemp()`
建出的目录是私有 DACL（连它自己都写不进去）。`test_all.py` 现在会探测并退到系统 TEMP，
且全文不再有 `tempfile.mkdtemp()`（见 `test_all.py:44-63` 与 `:12037`）。

**同一片土壤上的第二个坑（值得单独记）**：`mktemp()` 建在 `.test_tmp` 下 —— 那是
**仓库里**。有一批用例的前提恰恰是"这片目录不在 git 仓库里"（`[83]` 的"非 git 仓库建
worktree → 如实声明"、以及"worktree 根在项目根之外"）。把它们塞进仓库内之后，
`git rev-parse` 沿父目录命中了本仓库，用例静默变成"在真仓库里建 worktree"：
实测 `/workspace new T2 --worktree wt` 真的建出了 `G:\AI_Project\ace\wt`。
更阴的是它**一度是绿的** —— 当时沙箱建不出子目录、`TEST_TMP` 退到了系统临时区，
前提"碰巧"成立；沙箱一放开就红了。修法是给它一个语义正确的助手 `mktemp_outside()`
（系统临时区 + 普通 `mkdir`，同样登记清理），而不是回退成 `mkdtemp()`。
