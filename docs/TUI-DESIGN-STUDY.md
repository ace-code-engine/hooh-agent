# 开源终端 Agent 的 TUI 设计研究

> 样本：`G:\agents\repos` 下 29 个仓库里 **15 个真的终端界面**（其余是 IDE 扩展、Web 平台或纯 print CLI，
> 不在样本内）。阅读方式：4 组并行只读，逐文件读源码，断言带 `路径:行号`。
> 标注 ✅ 的引用是**逐字复核过**的；其余来自逐文件阅读，行号可能有个别偏移（已修正两处子代理写的简写路径）。
> 本文只讲**为什么这样排**，不列功能清单。

---

## 一、唯一的强共识：两车道（不可变历史 + 可变尾部）

15 家里 **13 家**的架构是同一个：已定稿的内容一次性推出渲染循环，只有"还在变的那一小块"留在可变区重绘。
这不是风格差异，是同一个物理约束逼出来的（终端 scrollback 一旦写入就不能改）。

| 项目 | 定稿内容去哪 | 未定稿内容在哪 | 机制 |
| --- | --- | --- | --- |
| codex | 推入 scrollback，不再重绘 | 底部可变视口 | `Standard/Zellij/FullScreen` 三策略，因 `CSI S` 会吞行 |
| gemini-cli | `<Static>` 画已完成历史 | 独立 `pendingItems` | Ink Static |
| qwen-code | 同上 | 同上 + 合流窗口 | 60ms 流事件合并 |
| opencode | 不可变 scrollback | 可变 footer | 源码文档写明 split-footer 两车道 |
| kilocode | 同 opencode | 同上 | fork 就地标 `kilocode_change` |
| DeepSeek-Reasonix | 提交进 scrollback | live 区原位重绘 | 提交必须停在"第一个还在变的行" |
| crush | 完成态冻结进列表缓存 | glamour stable-prefix | 边界偏保守，可疑就整段重渲 |
| oh-my-pi | history batch（带 id + ack 握手） | viewport | **finality 是应用的决定** |
| pi | main-screen 差分重画 | 尾部 | 只重画 first..last changed 行 + CSI 2026 |
| aider | 稳定行 `print` 进 console | rich `Live` 只看尾部 | 作者原话见下 |
| goose | 只吐"安全的 markdown 前缀" | 未闭合结构不渲染 | 代码块/粗体/链接未闭合即扣住 |

两句被写进源码的原话，可以直接当规则：

- aider `aider/mdstream.py:163-164` ✅ —— *"Markdown going to the console works better in terminal scrollback buffers. The live window doesn't play nice with terminal scrollback."*
- oh-my-pi `docs/tui-core-renderer.md:42-43` ✅ —— *"Finality is therefore an application decision, never an inference from a row crossing the top of the terminal."*
  同文件 `:45-49` ✅ 还给出实现：history batch 单调 id，写一次、ack 一次，provider 未 ack 不重发不重排。

**推论**：判断一个 TUI 架构好不好，第一个问题就是"哪一行已经定稿、谁说了算"。
答不上来的（每帧从头渲染所有消息）都在长会话下必然劣化 —— 见第八节。

---

## 二、状态行：行数不重要，**降级顺序**才是设计

- **一行**是主流：codex（默认 `model-with-reasoning · current-dir · thread-name`）、crush、opencode、
  opencode-go、pi、gemini-cli。
- **多行**是少数派但有理：Reasonix 的 footer 按宽自动折行（遥测行组：cache/context/压缩阈值/余额/花费）；
  Codewhale 固定两行（posture bar + metrics line），并且 `tui.metrics_line=hidden` 时**把那一行还给转录区**。
- **关键差别不在几行**，在于有没有写死"宽了先丢谁"：

| 做法 | 出处 | 可预期性 |
| --- | --- | --- |
| 显式 shed order + 地板 | Codewhale `crates/tui/src/tui/infoline.rs:29-32` ✅ | 最好：`cache→输出计数→计费档→help hint→rate/TTFT→cost`；**model 与 `ctx NN%` 永不 shed**，到地板才右裁 |
| 显式丢弃顺序 | oh-my-pi `status-line/component.ts:2666-2745` | 好：先截 session name → 再缩 path → 最后才丢段 |
| 换布局模式 | crush `internal/ui/model/ui.go:71-72` | 好：`width<120 \|\| height<30` 直接进 compact，藏侧栏改画 header |
| 逐项截断加省略号 | pi `components/footer.ts:242` | 差：用户不知道丢的是什么 |
| 只截消息不加规则 | opencode-go `components/core/status.go:146` | 差 |

派生规则：**状态行里的每一项都必须是"这一轮开始前要确认的事实"**，否则它属于 `/status` 而不是底栏
（ace 的 `docs/HOME-DESIGN.md` 已经写过同一条：主页不该是仪表盘）。

---

## 三、工具输出：把"藏多少行"写成常量，并且永远告诉用户出口

- 预览行数是个**写死的常量**：codex `PREVIEW_LINES = 3` ✅、cline 5、Codewhale 6、crush 10、
  opencode shell 10 / execute 4、Reasonix shell 10（展开 200）、diff 24。
- codex 的模块注释 ✅（`codex-rs/tui/src/tool_output.rs:1-2`）把原则说全了：
  *"Keep three screen rows and report hidden logical lines below them; ... Full output belongs in the transcript."*
- **隐藏了多少 + 怎么展开**必须同屏：crush `… (N lines hidden) [click or space to expand]`；
  codex `+N lines (ctrl+t to view transcript)`；pi `... (N more lines, <key> to expand)`。
- 三个容易漏的细节规则，都有出处：
  1. **只藏 1 行就不折叠**（crush `chat/tools.go:27-41`）——折叠本身也是噪音；
  2. **展开体惰性构造**（oh-my-pi `components/disclosure.ts:34-41`）——折叠态不付渲染代价；
  3. **折叠态高度固定，展开不抖布局**（opencode reasoning 折叠成一行，注释写 *"so the layout never shifts"*）。
- diff 的两条自适应：宽度决定 split/unified（opencode `width>120`、crush 需 ≥140 列、审批框 <77×20 强制全屏）；
  Codewhale 只在**词级相似度 ≥0.5** 时做行内高亮，连续配对 64 行后放弃 —— 否则整行发光，等于没高亮。

---

## 四、审批：安全默认 + 说清"为什么" + 讲明有效期

1. **默认选项分两派，但都不是 "always"**：
   - 默认 Deny：Codewhale ✅（`approval/view.rs:132-134`：*"Deny stays the default so a fresh card never turns a reflexive Enter into authorization"*，另有超时 fail-closed 到 deny）。
   - 默认 "允许一次"：gemini-cli / crush / opencode-go / ace。
   - 两派的共同点：**"本会话/以后都允许"永远是一个显式选项，不是默认**；ace 甚至把它标成 `danger`（`ui/ace_turn.py:59-63`）——
     这条判断比多数家更准："本会话允许"是一次真实的权力扩张，不该长得像"就这一次"。
2. **Esc = 拒绝是硬契约**，且不许被用户 keymap 覆盖（codex `approval_overlay.rs:1069-1075`：对 MCP elicitation
   永远映射 Cancel，防止"关掉＝继续"）。
3. **讲明有效期**：opencode 的 `Allow always` 只活到进程重启，文案老实写了 *"until OpenCode is restarted"*；
   kilocode 直接把它改成永久并在回复上打 `interactive: true` 标"人来答的"。
   两种都行，**不说清不行**。
4. **可解释性**（kilocode 补的、上游没有）：在工具标题里内联一行"为什么被自动批准/拒绝"。
   这是"没弹窗"和"被悄悄放行"的区别。
5. **问题里要带具体内容**，不是工具名：edit→diff、bash→`$ cmd`、webfetch→URL（opencode `permission.tsx:199-330`）。
6. **被拒也要留痕**：Reasonix `render.go:51-57` 留下 `✗ declined <tool> <subject>` 一行。
7. **标题别用 emoji**：Reasonix `prompts.go:170-173` 注释说终端会把 emoji 画成两格造成压字；
   ace 的 `ui/ace_cards.py` 同样是 ASCII 字形 + `TOOL_EMOJI` 备选 —— 这条两家独立踩到同一个坑。
8. **审批请求排队到本轮流结束再弹**（codex `chatwidget/interrupts.rs:1-2`），避免盖住用户正在打的字。

---

## 五、流式与帧预算：把数字写成源码常量

| 手段 | 出处 | 数值 |
| --- | --- | --- |
| 帧率硬上限 | codex `tui/frame_rate_limiter.rs:1-13` | 120 FPS（注释：widget 请求得比人感知更频繁是纯浪费） |
| 渲染节流 + 输入抢占 | pi `packages/tui/src/tui.ts:507,1116-1118` | `MIN_RENDER_INTERVAL_MS=16`，键盘输入抢在节流前 |
| 自适应背压 | oh-my-pi `packages/tui/src/tui.ts:2181-2191` | 目标 ~50% 渲染占空比，积压超阈值整帧推迟 |
| 流事件合并 | qwen-code `model/stream-aggregation.ts:23-24`、`opentui/text-batcher.ts:7-14` | 60ms；原因：每 delta 重折历史 + 重解析整段 markdown 是闪烁主因 |
| 输入突发合并 | qwen-code `use-frame-coalesced-flush.ts:9-24` | 16ms；原因：每事件同步 reflow + 写终端 = 滚动卡顿 |
| 更新防抖 | plandex `stream_tui/model.go:208` | 8ms |
| 同步输出包帧 | pi `tui-main-screen.ts:280,302`、qwen `utils/synchronizedOutput.ts:81-128` | DEC 2026 |
| 防撕裂 | Reasonix `internal/frontend/tui/view.go:58-72` | live 区先 `ansi.Truncate(width-1)`，否则渲染器不知道多出来的一行 |

pi 的那条"为什么"值得单独记：输入必须抢占被节流的帧，因为 **Windows 上 `setTimeout(0)` 可能吃满 16ms tick**。

---

## 六、中断与并发

- **Esc 中断 + 二次确认窗口**：opencode 5s 内两下、Reasonix `quitArmWindow=1s`、aider 2s。
  第一次按只改提示文案（"again to interrupt"），不在视觉上假装已经停了。
- **Ctrl+C 是优先级链**，不是单义键：Codewhale `mouse_ui.rs:2058-2084` 有单测锁定
  "有选区→复制 / 有活跃轮→中断 / 否则 arm-exit"。ace 的 `KEYMAP-CLAUDE-PARITY.md` 已有等价设计。
- **中断不丢已流出的文本**：Codewhale 把它标成 `[interrupted]` 保留（`app.rs:6057-6074`），不是清掉。
- **面板打开时谁还能停**：Reasonix 明确"面板顶替 composer，但只有 ctrl+c 仍能停本轮"（`input.go:190-210`）——
  这是审批框里最容易被忽略的逃生门。
- **子 agent 要有一处投影**：opencode `SubagentFooter`、qwen `LiveAgentPanel`（注释说对齐 Claude Code 的位置）、
  oh-my-pi `AgentsHub` overlay；goose 简单到只是行前缀 `[subagent:<id>]`。ace 的 `#board`（`tui/app.py:672`，`max-height: 6`）属于简版。

---

## 七、三件容易漏、但会致命的事

1. **宽度按终端实测 cell 算，不按字符数**：
   Reasonix `glyph_fit.go:12-19` 把控制台实测更宽的字符换成窄等价字符（逐 rune 缓存）；
   crush 的 `internal/ui/AGENTS.md:12-18` 直接规定"所有 ANSI 字符串必须走 `x/ansi`，禁止按字节操作"。
   ace 在这条上是**领先的**：`ui/ace_text.display_width` + `ui/ace_cards.TOOL_GLYPH`（GBK 控制台字形回退）已经做了。
2. **容量上限必须有出处**：cline 500 行环形缓冲、qwen 内存监控触发 `compactOldItems`、codex transcript
   布局 LRU 64 条 / 8MB、gemini 单条行数上限。**没有上限的那条路一定最先烂**。
3. **非 TTY 降级**：pi 的 print 模式 text/JSON、plandex 每个命令都有 `--plain`、aider 遇 dumb terminal
   同时关花式输入与着色、Reasonix 由 colorprofile 统一处理 `NO_COLOR/CLICOLOR_FORCE/TERM=dumb/isatty`。
   ace 已有（`ai_code.py:8738` 起：没装 textual / 非真终端 / `--json` 时如实回退）。

---

## 八、别抄清单（都有出处，不是口味）

1. **整段重渲染**：opencode-go 每次变化 `renderView()` 从头渲染所有消息，只有 `msg.ID+width` 命中缓存才跳过
   （`internal/tui/components/chat/list.go:187-240`）。长会话必然卡。
2. **每个流事件同步 reflow + 写终端**：qwen 自己在 `use-frame-coalesced-flush.ts:17-19` 写明这是卡顿来源。
3. **负 margin 偏移整份 transcript、不虚拟化也不用 Static**：Roo-Code `components/ScrollArea.tsx:355`
   （其 `src/ui` 全仓无 `<Static>`）。
4. **写死高度、无窄屏规则**：trae-agent `rich_console.tcss:21-27`，且每步无条件 write 整块带边框 Panel。
5. **默认 alt-screen 关住长转录**：trae-agent 把日志关进 RichLog，牺牲 scrollback 与复制粘贴；
   反例是 pi —— **默认 main-screen，只有 `--fullscreen` 才进 alt**（`modes/interactive/tui-renderer.ts:18-47` ✅）。
6. **`Allow always` 只活到重启却不说**：opencode，kilocode 正在修。
7. **巨型单文件 keymap**：codex `keymap.rs` 4000+ 行（含 chord 冲突校验、别名等价、兼容分支）；
   crush 同一件事是 331 行 `keys.go` + `help.KeyMap`。要抄的是"binding 可配置"，不是那个文件。
8. **用整帧字符串缓存掩盖渲染成本**：crush `model/framecache.go:9-21`（3s TTL / 32 条 / LRU / GC / 五处失效判断）——
   它自己的 `AGENTS.md:223-236` 已给出更省的做法（列表级懒渲染 + item 内缓存 + `Prewarm`）。先修成本，再考虑 memo。

---

## 九、对照 HooH：三条真差距 + 两条小差距

先说结论：**ace 在"规则"层面相当超前**（语义主题 `ui/ace_theme.py`、三语 i18n `locales/{en,zh,ja}.json`、
GBK 字形回退、状态段优先级 `ui/ace_layout.fit_status_line`、拒绝时带备注回传给模型、两段式 rewind）。
问题不在缺规则，而在**规则没有落在同一条路上**。

### 差距 1（最要命）：两套渲染器，能力已经漂移

| | `ui/`（prompt_toolkit） | `tui/`（Textual） |
| --- | --- | --- |
| 转录上限 | `ui/ace_chatscroll.py:16` `MAX_LINES = 2000` | 无上限（`tui/app.py:914`） |
| 状态行 | `ui/ace_layout.py:101` `fit_status_line` 有分段+优先级+按宽丢车保帅 | `tui/app.py:821` `_status_text()` 字符串拼接，没有丢弃规则 |
| 屏幕 | 主屏逐行流式（历史留在 scrollback） | Textual 默认 alt-screen（`tui/app.py:1970` `.run()` 未传 `inline`） |
| 主题/i18n | 语义 token + 三语 | 同一套（这部分共享） |

样本里 **15 家全部只有一个渲染器**。ace 有两个，于是每加一个功能都要改两处 —— 现在已经在漂移
（状态行就是两份实现，一份有优先级一份没有）。

### 差距 2：`tui/` 的转录是"一行一个控件"

`tui/app.py:908-916`：每行 `body.mount(Static(...))`，无上限、无虚拟化、无行缓存、无批量化。
样本里躲开这个坑的手段分别是：gemini `<Static>`、cline 500 行环形缓冲、codex transcript 布局 LRU 64 条/8MB、
Reasonix 只把定稿部分一次性推进 scrollback。**这是第二节那 13 家共识的反面。**

### 差距 3：alt-screen 与"滚动上去就是历史"

`tui/app.py:1955-1971` 的 `.run()` 没有 `inline=True`，Textual 会进 alt-screen：滚上去没有历史，
终端自带的复制/搜索也用不上。而 `ui/` 那条路恰恰是主屏流式的 —— 同一份对话，两条路的"可回溯性"完全不同。
若要保留 Textual，得先确认 inline 模式下 dock 底栏还成不成立（未验证）；不成立的话，就承认 alt-screen，
但必须把 `/export`、`Ctrl+O`、会话内 find 当成替代品补齐。

### 小差距 4：输入是单行

`ChordInput` 继承 `Input`（`tui/app.py:184`），换行靠 `\`+Enter / `Ctrl+X Enter`。
样本里几乎所有家都是**多行编辑器**（opencode TextareaRenderable、codex textarea、crush textarea、
Reasonix textarea `composerMaxRow=8`、cline 原生 `<textarea>`）。多行是长 prompt 的默认形态。

### 已经对齐、不用动

- `Ctrl+O` 展开最近一次折叠的输出（`tui/app.py:1772`）—— pi / Reasonix 都是 `Ctrl+O`。
- `Esc` 在权限框里 = 拒绝（`tui/app.py:572`），且带备注回传（`:575`）。
- `Shift+Tab` 权限环，进 `full` 二次确认（`ui/ace_turn.py:65-69`）—— 与样本的不变量一致：危险的档位不能一键进入。

---

## 十、下一步（按性价比排序；建议一次只做前两条）

1. **定一个渲染器。** 要么把 `ui/` 的规则（上限、状态段优先级、主屏流式）搬进 `tui/`，要么承认 `tui/` 是实验品、
   把它的独有能力回填到 `ui/`。不定这个，后面每条都是双份工作。
2. **给转录区加"定稿批量写入 + 行数上限"。** 最小改动：攒够 N 行或空闲 X ms 才 mount（甚至一次 mount 一个多行 Static），
   并把 `MAX_LINES=2000` 的规则搬过来。这是唯一能同时解决长会话劣化与 alt-screen 观感的改动。
3. **状态行统一走 `ace_layout.fit_status_line`**（带 priority），删掉 `tui/app.py:_status_text()` 的字符串拼接分支。
4. **工具卡片：预览行数常量化 + 恒定显示"还藏了 N 行 / 按什么展开"。** 现在 `ui/ace_cards.py` 已有折叠与提示，
   只需把行数提成显式常量，并补上"只藏 1 行不折叠"。
5. **审批里内联一句"为什么被自动放行"**（kilocode 那条），做完这条，"没弹窗"才不再是黑箱。

---

### 附：样本清单与已知缺口

- 真正读了 TUI 的：codex、crush、Codewhale、opencode、kilocode、opencode-go、Reasonix、plandex、gemini-cli、
  qwen-code、cline、Roo-Code、pi、oh-my-pi、aider、goose、trae-agent（+ SWE-agent/mini-swe-agent 作为"没有 TUI"的对照）。
- 前提更正：`opencode/packages/tui` 是 **TypeScript + SolidJS + OpenTUI**，不是 Go（Go 版是 `opencode-go`）；
  `plandex/app/cli/ui` 只有 67 行（OAuth 开浏览器），真 TUI 在 `app/cli/stream_tui/`。
- 未覆盖：orca / vibe-kanban（桌面编排，非终端界面）、continue / cline-VSCode / Roo-VSCode / kilocode-VSCode
  （IDE webview）、OpenHands / dyad / void / CubeSandbox（Web 或沙箱底座）。需要时再单独取样。
