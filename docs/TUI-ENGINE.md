# TUI 引擎决定（v1）

> 结论先写：**语言 = Python；渲染层 = 一个渲染目标（Segment/Canvas）+ 三个后端；
> 屏幕 = 主屏优先，alt-screen 只作显式的"全屏浏览"入口；Textual 停止扩展并最终删除。**
> 下面每条都给了理由和"什么时候该推翻它"。

---

## 一、语言：Python（不换 Rust / Go）

| 理由 | 说明 |
| --- | --- |
| **引擎在同一个进程里** | 工具执行、权限门、快照回滚都在 Python 线程模型里。TUI 要**同步阻塞**在 `ask_permission` 上（`ai_code.py:4564`）。换语言 = 每次工具调用/每次授权都要 IPC + 序列化，且"拿不到答案就拒绝"这条安全口径会多一个可能断掉的环节。 |
| **零依赖是卖点，不是口号** | 安全核心是纯 stdlib（`README` 原文）。多一个运行时 = 多一种分发形态；Claude Code 为了单文件往里塞了个 **230MB 的 Bun**（见 `docs/CLAUDE-CODE-TUI-AND-SWATCH-PLAN.md` §1）。 |
| **帧预算早就够用** | 我们的规范把动画封顶在 5Hz，且只在数据变化时重排（`docs/TUI-SWISS-SPEC.md` 第一条）。120×40 = 4800 格，全量重排在这个量级上 Python 完全承受得住；慢的是"每帧重排 + 每行一个控件"，不是语言。 |
| **已经有了最难的部分** | `ui/ace_prompt.py` 是**零依赖输入层**（msvcrt/termios），而且**按键来源可注入**——管道里能跑真实交互链路。换语言等于扔掉它，再去 conhost 上把同样的坑踩一遍。 |
| **宽度这件事已经解决** | `ui/ace_text.py` 用 `east_asian_width` 处理 CJK 双宽、ANSI 感知；Go/Rust 侧我们看到的实战是 Reasonix 用 `WriteConsoleW` + 光标回读才测出 `● ■ ◆ ·` 在老 conhost 上是 2 格。这些是**本地知识**，不是代码量。 |

**什么时候该推翻这条**（写下来，免得以后拍脑袋）：

1. 需要 30fps 以上的连续动画或粒子；或
2. 要在终端里渲染位图（kitty / sixel）；或
3. 单帧重排已经削无可削，实测仍 > 16ms。

三条现在都不成立。真到那天，换的是**渲染进程**，不是整个 UI——`Screen`（见下）就是那个边界。

---

## 二、渲染层：一个渲染目标，三个后端

现在的问题是**没有"渲染目标"这个东西**：每个前端各自决定怎么把数据变成字符。于是同一个"状态行"有两份实现（`ui/ace_layout.fit_status_line` 有优先级、`tui/app.py:821` 是字符串拼接），转录上限只有一边有（`ui/ace_chatscroll.py:16` 有 2000 行，Textual 侧没有）。

引擎的核心就是这个中间层：

```python
# ui/ace_cell.py —— 唯一的渲染目标（纯数据，无 ANSI、无 IO）
Segment(text, role, rgb=None, inv=False)   # role: dim|text|strong|accent|swatch|ok|warn|err
Line    = list[Segment]
Screen  = list[Line]

# ui/ace_canvas.py —— 帧缓冲 + 脏矩形（游戏引擎那部分）
Cell(ch, sgr)                     # 一个格子自带"写什么"和"什么样式"
Canvas = list[list[Cell]]         # 宽字符占两格（第二格是续格）→ 行格数 == 显示列数
diff(prev, cur) -> [Patch]        # 只回报变了的格子，相邻同风格合并
encode(patches) -> str            # 最小写入；没变化就是 ""

# ui/ace_render.py —— 后端（纯函数，同一份 Screen 进，多种字符出）
render_terminal(screen, profile, theme) -> list[str]   # 整行重画（golden / 简单场景）
render_canvas(screen, profile, theme)   -> Canvas      # 进帧缓冲
render_frame(prev, cur)                 -> str         # 两帧之间真正要写出去的字节
render_plain(screen)                    -> list[str]   # 测试：无 ANSI
render_svg(screen, profile, theme)      -> str         # 预览：人看的图
```

**实测帧预算**（120 列风格词典，`--check` 会打印）：整帧 2906 字节 → 只移动选中项
**270 字节（9.3%）** → 空转一帧 **0 字节**。这就是"history 只写一次、可变区只画脏格子"。

为什么这样切：

- **瑞士规范只能对着 `Screen` 断言**。"每行宽度 == 终端宽""色块恰好 2 格""一屏只有 1 个强调色"——这些是数据性质，不是样式。Textual 的 DOM/CSS 模型把它们挡在了断言之外，这就是它做不成规范载体的原因。
- **`--svg` 不是额外功能，是第二个后端**。以后所有预览图都由真渲染器生成，手画的稿子和代码不会再对不上。
- **测试不需要终端**。`render_plain` + golden，60/80/120 各一张，跟已有的 `test_all.py` 风格一致。

---

## 三、屏幕模式：主屏优先，alt-screen 降级为显式入口

现在的三条路里有两条进 alt-screen（`ui/ace_fullscreen.py`、`tui/app.py`）。研究结论是一致的：

- pi **默认 main-screen**，只有 `--fullscreen` 才进 alt；
- aider 作者原话：*"The live window doesn't play nice with terminal scrollback."*；
- Claude Code 的 alt-screen **只给 transcript 视图**，主视图靠终端原生 scrollback。

主屏优先还有一笔白送的简化：**`ui/ace_chatscroll` 的视口/滚动数学会变成历史包袱**——终端自己会滚、自己会复制、自带搜索。省下来的维护成本是实打实的。代价要说明白：**程序内"查找并高亮"做不到**（除非把 scrollback 读回来，不值得）。

所以：主屏 = 转录直接 print 进真 scrollback + 底部保留区（状态行 + 输入行）；
`alt-screen` 保留为显式的"全屏浏览/转录模式"（`Ctrl+O` 那一类入口），不再是默认。

---

## 四、Textual：冻结，然后删

| 事项 | 决定 |
| --- | --- |
| 新增功能 | 一律不落在 `tui/` |
| 现存能力清点 | 逐条决定"回填 ui/ 还是明确砍掉"（`Ctrl+O` 展开、board、find、鼠标滚动） |
| 兼容 | `--tui` 保留一段时间，行为不再变化 |
| 删除 | ui/ 路径补齐后整目录删除；同期删掉 `setup_env.py` 里的 textual 依赖 |

删它的理由只有一句：**它带来的是第二份实现，而不是第二个能力。**

---

## 五、迁移步骤（每步都能独立验收）

> 进度：**第 1–3 步已完成**，帧缓冲（`ui/ace_canvas.py`）也已落地；下一步是第 4 步主屏循环。

1. ✅ **抽 `ui/ace_cell.py`**：`Segment` / `Line` / `Screen` + 网格常量 + `problems()`（共享验收）。
2. ✅ **`ui/ace_render.py`**：三个后端 + `render_canvas` / `render_frame`，色深四档在一个文件里。
3. ✅ **`ace_swatches` 改成返回 `Screen`**，上色全交给后端。
3.5 ✅ **`ui/ace_canvas.py`**：帧缓冲 + 脏矩形 + 最小写入（`diff` / `apply_patches` / `encode`）。
3.6 ✅ **`ui/ace_screen.py`**：主屏两车道（转录只写一次 + 底部区走脏矩形）+ **引擎主循环**
`run_session()`（排空输出 → 画底部区 → 带超时读一个键 → 提交/退出），带**终端模拟器**验收。
3.7 ✅ **`ui/ace_prompt.py` 抽出 `LineEditor.step(key)`**：按键分派从阻塞循环里独立出来，
浮层路径与引擎路径**共用同一份**；顺手修掉"注入了 stream 却被 msvcrt 抢走"的死锁。
3.8 ✅ **异步 + 动画**：`run_session` 支持 `pump`（跨线程问答）与 `on_key`（忙时 Esc=中断）；
worker 线程跑轮次、输出走线程安全队列、状态行带 8 帧 braille spinner、忙时回车=排队。
3.9 ✅ **跨会话输入历史**：`~/.ace_history`（`ACE_NO_HISTORY=1` 可关，历史里可能有密钥）。
3.10 ✅ **golden + 帧预算**：60/80/120 三个宽度的版式摘要 + 四档色深一致性；
实测整屏重排 **2.3ms**、空转帧 **0.14ms**（预算 8ms / 1ms）。
4. ✅ **接进 `ai_code.py`**：引擎界面在**真终端下已是默认**，`--no-engine` 回退普通 REPL。
5. ⚠️ **`tui/` 只剩删除动作**：代码侧已无任何引用（`ai_code.py` 不再 import tui / run_tui，
   `setup_env.py` 不再依赖 textual/rich，`test_all.py` 第 60 段已改测引擎路径并全绿）。
   但**沙箱刻意禁止删除工作区里的文件**（工作区根上有一条 Everyone 的
   "删除子目录与文件"拒绝项，属于 DSH 的保护设计，不该移除），所以目录本身要人来删：

   ```
   git rm -r tui
   ```

### 接下来要补的（写在明面上，别当成忘了）

- **`ui/ace_fullscreen.py`（pt 备用屏）**：现在还可以 `--fullscreen` 进，但主屏才是默认；
  等确认没人再用，同一批删掉（它和 `ace_chatscroll` 的视口数学在主屏模式下是历史包袱）。

## 六、验收

- 同一份 `Screen`，`render_terminal` / `render_plain` / `render_svg` 三者的**显示宽度完全一致**；
- 60 / 80 / 120 / 无色 四类 golden；
- 一屏一个强调色（断言）；
- 单帧重排实测 ≤ 8ms（超了就先削，不到 16ms 不许谈换语言）；
- 人工只确认一次：主屏模式下滚轮回看、复制、`Ctrl+C` 是否仍由终端负责且符合直觉。
