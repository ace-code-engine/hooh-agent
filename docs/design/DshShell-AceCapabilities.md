# 整壳换 DSH TUI 后，ace 六项本体的露出设计卡

> 编号：`CAP-01` ~ `CAP-07`。
> 上级：`docs/design/UI-OVERHAUL.md`（界面重做立项书）· `docs/design/TUI-PRIOR-ART.md`（同行研读）。
> 前置侦察：`.recon/F-adapter.md` §⑤「反向缺口：ace 有、SRC 没有」。
> 状态：**设计卡，未实施**。第一波的四项（`CAP-01/02/03/06` + `CAP-07a`）还没接线。
> 缘起：前端整体换成 `@deepseek-harness-tui/dsh-tui`（v0.12.0，MIT，落点 `third_party/dsh-tui/`）之后，
> 若照搬它的应用模型，ace 的**快照/撤销、沙箱/联网、规则/审计、`@` 体系、字形降级、MCP 与执行策略**
> 在界面上会整体消失。**这些是 ace 的本体，不是装饰**——本卡只回答一件事："在新壳里怎么把它们重新露出来"。

---

## 0. 口径与范围（先说清楚，免得后面每条都要重述）

| # | 口径 | 依据 |
|---|---|---|
| **口径 1** | **引擎是唯一真源。** 每条能力的"唯一生产者"是既有 Python 实现（下面每张表都给出 `file:line`）；新壳只做**投影**，不重算、不重解析 | `THREE-LAYERS.md` §9.1 的"唯一判定处"纪律；`ai_code.py:5530` `home_state()` 的 docstring（"各算各的必然会漂"） |
| **口径 2** | **能复用的一律复用。** 既有事件/命令覆盖得到的，**不新开协议面**；表里标 `复用`，并写明字段名 | 本卡 §3 只列 5 个新方法 + 2 个新字段 |
| **口径 3** | **没有数据源就如实标不可用，不许造空实现。** 降级必须声明 | `THREE-LAYERS.md` §3.4 规则②（HL-03：降级必声明，不许静默回退） |

### 范围决定（用户已定，本卡其余各条都按它改口径）

| 项 | 决定 | 理由 |
|---|---|---|
| 新壳的定位 | **主界面**（真终端下默认） | 整壳替换瞄准的是主路径，不是实验分支（`ui/ace_engine_repl.py` 的"真终端下默认"同一口径） |
| ace 的 Python `ui/`（33 文件 / **9,267 行**，实测） | **保留为降级 / headless 路径，不删** | ① 保住部署故事：**安全核心零依赖、没有 Node 也能跑**（模型调用才需要 `requests`）；② `ace --json` / `ace --mcp` / 无 Node 的机器 / 新壳崩了要能退回 —— 都需要一个不含 JS 的界面 |
| 两套界面的关系 | **共享同一引擎与协议**（`ai_code.py` + `core/ace_serve.py`），只有画法不同 | ⇒ **漂移面在协议层，不在 UI 层**：新壳不许自己重算/重解析（口径 1）；反过来，`ui/` 侧新加的能力**必须同批发协议字段**，否则第二套界面当场漂 |

> **两条推论（贯穿全卡）**：
> ① 判断"某能力在新壳里有没有"，**不看上游有没有对应组件，只看协议里有没有字段**（§3）。
> ② `ui/` 活着 = 任何"只在新壳里做一遍"的实现都是**第二份实现**，必须能指回引擎单源，否则就是给"两套界面各说各话"埋雷。

**范围外**：本卡**不解决** `@deepseek-harness-tui` 侧的适配层（那是 SRC 的 `src/ace-adapter/` 的活，见 `.recon/F-adapter.md` §4.1），
也**不解决**子代理看板 / 多会话停放这类"ace 本来就没有数据源"的缺口（`.recon/F-adapter.md` §4.4）——
**会话三件套（浏览器 / 树 / 设置）的数据源缺口改由 §3.7 收口**（K3 实测：文件内分支的数据源其实**在**，缺的是"没接出去"；设置侧缺的是写通道）。
**约束**：不在 ace 里写 TS。

---

## 1. 逐能力

### CAP-01 快照 / `/undo` / `/rollback`（可逆性）

| 子项 | ace 现在长什么样 | 引擎侧命令 / 事件 | 在新壳里落在哪 | 协议 |
|---|---|---|---|---|
| 快照数 | 主页「特色」区 `home_rewind`，文案带 `{n}` | `home_state()["snapshots"]`（`ai_code.py:5534-5549`）→ `ui/ace_home.py:147-150` | 命令面板条目 + 主页/首屏的"回溯"条目 | **复用** `config.request` 的 `snapshots` 字段（`ai_code.py:8795`）；`home.request` 的 `sections[].items[].fmt.n`（`ai_code.py:8752`） |
| 快照清单 | 三列文本：`id / created_iso / tag (N 文件)`（`ai_code.py:2587-2593`） | `/snapshots` → `COMMAND_HANDLERS`（`ai_code.py:1870`）→ `_cmd_snapshots`（`:2587`）→ `guardian.list_snapshots()`（`core/guardian.py:591`） | 新壳的**快照面板**（列表 + 选中即回滚） | **新**：`snapshots.request`（§3.1）。理由：三列文本是给人排版的，解析它等于把 i18n 与列宽焊进新壳 |
| 一键撤销 | `Ctrl+_` / 回车触发 `/undo`，打印 `undo_done`（id + 时间 + 文件数 + git 侧说明） | `/undo`（`ai_code.py:1871`）→ `_undo_last`（`:7909-7946`），串 auto-commit（`:7932`） | **键位**（新壳的 ctrl+z 类绑定）+ 命令面板条目 | **复用** `command.exec{line:"/undo"}`（`ai_code.py:8706-8719`）；结果走 `notice`（`ace_events.py:21`） |
| 精确回滚 | `/rollback <id>`，`_ask_text` 二次确认（`ai_code.py:2595-2618`） | `/rollback`（`:1872`）→ `_cmd_rollback`（`:2595`）→ `guardian.rollback`（`core/guardian.py:486`） | **原生确认对话框**（新壳的 confirm），确认后发 `command.exec` | **复用** `choice_request{kind:"confirm"}` / `choice.answer{accepted}`（`ace_events.py:20`；服务端侧 `core/ace_serve.py:536-539`、`:557-563`） |
| **"看起来成功其实没回滚"** | 只有 `rollback_partial` 一行红字（`ai_code.py:2613`、`:7944`） | `guardian.rollback` 返回 `bool`；`core/guardian.py:496` 自述 `code_execute/subagent` 给不出精确目标 | 快照面板上每条的**精确性标记**（精确 / 仅尽力） | **新**：`snapshots.request` 的 `precise` 字段（§3.1）。理由：这是 `.recon/F-adapter.md` §⑤ 点名的"不可见风险"，必须变成可见字段 |

**唯一真源**：`core/guardian.py:591` `list_snapshots()`（字段 `id` / `tag` / `created_iso` / `file_count`，`:600-602`）。

### CAP-02 sandbox / net（安全边界）

| 子项 | ace 现在长什么样 | 引擎侧命令 / 事件 | 在新壳里落在哪 | 协议 |
|---|---|---|---|---|
| 当前档位 | 状态行 `沙箱:{off\|job\|docker}` 段与 `联网:{开\|关}` 段（`ai_code.py:3121-3126`） | `status` 事件的 `segments[]`（`ace_events.py:25`；发射 `ai_code.py:3200-3238`） | **状态行扩展段**（两个具名段） | **复用** `status.segments[name=sandbox]` / `[name=net]`（`name` + `level` + `priority` 已在发，`ai_code.py:3148-3198`） |
| 起步值 | 首屏标题行 `沙箱 job` 以 warn 色标出（`ui/ace_home.py:189-190`） | `initialize.sandbox` / `.permission`（`ai_code.py:8657-8658`）；`config.request` = `home_state()`（`:8795`，字段 `sandbox`/`net`/`permission`） | 首屏标题行 | **复用** `initialize.sandbox` + `config.request.sandbox/net/permission` |
| 改档位 | `F2` → `/sandbox`、`F3` → `/net`（`ui/ace_engine_repl.py:178`、`ui/ace_fullscreen.py:348`）；`alt+w` = `net_toggle`（`ui/ace_keys.py:261`） | `/sandbox`（`ai_code.py:1886`）→ `_handle_sandbox`（`:3040`）；`/net`（`:1884`）→ `_toggle_net`（`:2861`） | **键位**（沿用 F2/F3）+ 命令面板 + 设置分区行 | **复用** `command.exec{line:"/sandbox job"}` 等 |
| **可选档位闭集** | 参数菜单在输入空格后弹出（`ui/ace_menu.py:47-50`：`off/job/docker`、`on/off`、`readonly/write/full/rules`） | 同一张表 `ui/ace_menu.ARGUMENT_HINTS`（`ui/ace_menu.py:45-75`），菜单侧经 `_menu_state`（`ai_code.py:4731`）消费 | 状态行段上的**点击/快捷键循环**（不必开菜单就能切档） | **新**：`config.request` 增只读字段 `option_sets`（§3.2）。理由：闭集今天只活在 Python 的菜单表里，新壳读不到；这是"用户不知道自己有没有边界"的根因 |

**唯一真源**：`ui/ace_menu.ARGUMENT_HINTS`（不要在新壳里手抄一份闭集——那就是第二个会漂的地方）。

### CAP-03 rules / audit / 拒绝分类（安全边界 + 合规）

| 子项 | ace 现在长什么样 | 引擎侧命令 / 事件 | 在新壳里落在哪 | 协议 |
|---|---|---|---|---|
| 持久规则 | `/rules` 列表 + 三 scope（`local/project/user`）+ shadow 警告 | `/rules`（`ai_code.py:1925`）→ `_cmd_rules`（`:5206`）→ `core/ace_rules.py:268 load_rules` / `:318 describe_rule` | **规则面板**（列表 + scope 分组 + 冲突标记） | **新**：`rules.request`（§3.3） |
| 待签字提议 | `/rules` 默认带"待确认提议"区；`/rules accept <n>` 才落地（`ai_code.py:5224-5265`） | `refusal_ledger.proposals`（`ai_code.py:5219-5220`）→ `accept_proposal(confirmed_by=os_user)`（`:5252`） | **规则面板的"待你签字"区** + 一条通知 | **新**：`rules.request.pending`；签字动作**复用** `command.exec{line:"/rules accept <n>"}`（人签字=人敲命令这条纪律不许绕过） |
| 审计流 | `/audit` 最近 N 条事件、可按 kind 过滤（`ai_code.py:3343-3380`） | `/audit`（`:1883`）→ `_show_audit`（`:3343`）→ `session_log.events()` | **审计屏**（虚拟列表 + kind 过滤） | **新**：`audit.request`（§3.3） |
| 日志体检 | `/audit stats`：事件构成 / 工具成败 / 体积账 / `seq` 重复与缺口 | `ace_engine.session_meta(path)`（`ai_code.py:3393-3416`） | 审计屏顶部的**体检条** | **新**：`audit.request.stats`（与 `/audit stats` 同源，不另算） |
| 边界视图 | `/audit boundary`（`ai_code.py:3353`、`:3461`） | `_show_audit_boundary`（`:3461`） | 安全面板的一个分区 | **新**：`audit.request.boundary` |
| **拒绝 vs 失败** | 工具卡片只有 `status` + 中文 `message`；`outcome` 已在外发事件里（`ai_code.py:7809-7814`） | `tool_result` 事件字段 `tool,status,outcome,elapsed,exit_code,message,data`（`ace_events.py:18`、`ai_code.py:7809-7814`） | **工具卡片上的徽标**（拒绝 = 换路径 / 失败 = 该升级） | **复用** `tool_result.outcome`（RL-01 已落地）；**新**加 `refusal_class` + `retryable` 两个字段（§3.4） |
| 执行策略（`ace_execpolicy`） | 无独立入口；表现为审批弹框与拒绝结果 | `core/ace_execpolicy.py:391 evaluate_command` / `:515 should_execute` → `permission_request` / `tool_result{outcome:denied}` | 审批通知 + 拒绝徽标 + 规则面板 | **复用** `permission_request{tool,reason}`（`ace_events.py:19`）+ `tool_result.outcome` |

**唯一真源**：规则 = `core/ace_rules.py`（`Rule`/`SCOPES`/`load_rules`）；账本 = `core/ace_ledgers.py`（拒绝账本 + 失败账本）；
拒绝分类 = `tools/status.py`（RL-02 的 `classify_refusal` 是**唯一判定处**，`THREE-LAYERS.md` §9.5）。

### CAP-04 `@` 体系（`@lang` / `@file` / `@folder` / `@session` / `@skill` / `@image`）

| 子项 | ace 现在长什么样 | 引擎侧命令 / 事件 | 在新壳里落在哪 | 协议 |
|---|---|---|---|---|
| 提及补全 | 打 `@` 弹提及菜单，五类固定顺序（`ui/ace_menu.py:37-41`） | `_menu_state`（`ai_code.py:4731`）→ `ui/ace_menu.mention_items`；`@session` 候选**复用** `_sessions_brief`（`ai_code.py:8802-8820`） | **输入框补全**（新壳的 mention 补全槽位） | **新**：`mentions.request`（§3.5）。`@session` 候选**复用** `sessions.request` 的 `path/when/turns/label` 四字段（`ai_code.py:8816-8819`） |
| 执行 `@...` | 整行进 `_handle_at_command`（`ai_code.py:8393-8396` → `:1459-1482`） | `_process_line`（`:8365`）的分支；落到 `context_refs` / 配置 | 输入框回车后由新壳**按前缀路由** | **复用** `command.exec{line:"@file README.md"}`。⚠ 见下方"路由缺口" |
| 已引用了什么 | `@refs` / `@clear`（`ai_code.py:1475-1480`）；`ace_prefix.FIELD_SYSTEM` 的前缀台账（`:1557`、`:1649`、`:1672`） | `@refs` 只打印文本 | **输入框上方的"附加上下文"芯片行**（上游本来就有 chip 概念） | **新**：`mentions.request` 增 `refs` 子形状（§3.5） |
| 截断声明 | `@file` ≤4000 字符（`ai_code.py:533`）、`@session` ≤6000（`:475`）、`@folder` ≤30 项、技能正文 ≤8000（`:479`）——超了会**说明** | `_at_file` / `_at_session`（`:1531-1650`）打印 | 通知区一条"已截断" + 芯片上的比例 | **复用** `notice{text}`（`ace_events.py:21`） |
| 图片 | `@image <路径>` 挂进 `_pending_images`，状态行 `images` 段报数（`ai_code.py:3166-3169`） | `@image`（`ai_code.py:1473`）→ `_at_image`（`:1677`） | 输入框的附件区 + 状态行 `images` 段 | **复用** `status.segments[name=images]`；挂图动作**复用** `command.exec{line:"@image <path>"}` |

**路由缺口（本卡点名的真问题）**：`user.message` 走 `cli.converse`（`ai_code.py:8688-8704` → `:7383`），
**不经过 `_process_line`**，所以 `converse` 里**没有** `@` 分支 —— 今天把 `@file x` 发成 `user.message`，
它会被当成一句聊天送给模型。两个选项：

- **推荐（零引擎改动）**：新壳把以 `@` 开头的行**改走 `command.exec`**。契约写进新壳的输入路由表。
- 更彻底（跨包，晚点）：`_h_user_message` 里对 `@` 前缀改走 `_process_line` —— 一处改动，
  但会改掉"聊天与命令分两个请求"的既有分工（见 `ai_code.py:8695` 的注释）。

### CAP-05 字形降级表（可读性）

| 子项 | ace 现在长什么样 | 引擎侧命令 / 事件 | 在新壳里落在哪 | 协议 |
|---|---|---|---|---|
| 降级表下发 | 引擎把"这台控制台画不出"的字连同替身一起发给外壳 | `FRONTEND_GLYPHS`（`ai_code.py:462-466`）→ `initialize.glyphs`（`:8667-8670`）；生产者 `core/ace_io.glyph`（`:141`）/ `display_encoding`（`:116`） | **整壳渲染层**（不是某个面板） | **复用** `initialize.glyphs`（`{原字: 替身}`，表为空=全都画得出）。**零新增** |
| 引擎侧的替身表 | 工具卡片符号表 `TOOL_GLYPH` / `GLYPH_FALLBACK`（`ui/ace_cards.py:167`、`:191`、`:331`）；任务树 `_TREE_GLYPH`（`ui/ace_layout.py:268`）；装饰字 `_io.glyph(...)`（`ui/ace_home.py:240,243`、`ui/ace_menu.py:368`） | 同一套 `ace_io.glyph` | 新壳自己的符号表要**同样过一遍** `glyphs[c] ?? c` | **复用** `initialize.glyphs`；新壳必须把它套到**自己的**边框/主题字符上（上游没有这个概念） |
| 语言切换 | `/lang`（`ai_code.py:1801`/`1889` → `_cmd_lang` `:5429`）→ `language` 事件 | `language{lang}`（`ace_events.py:67`、`:90`）；`initialize.lang`（`:8664`） | 新壳换自己的字典 | **复用** `language.lang` + `initialize.lang` |

**风险提示**：`initialize.commands` 发的是 **i18n 键不是译文**（`ai_code.py:8673-8685`，理由见 `:8673-8675`），
所以新壳必须自带 ace 的键表；这才是 `CAP-05` 的大头，字形表只是其中一项。

### CAP-06 MCP / 执行策略（安全边界）

| 子项 | ace 现在长什么样 | 引擎侧命令 / 事件 | 在新壳里落在哪 | 协议 |
|---|---|---|---|---|
| MCP server 状态 | `/mcp`：`✓/◌/✗` + 名称 + 状态 + 工具数 + 启动命令 + 错误的原因（`ai_code.py:2396-2437`） | `/mcp`（`:1893`）→ `_cmd_mcp`（`:2396`）→ `el.mcp.status()`（`:2411`，行字段 `name/status/tools/command/error/tool_names`） | **MCP 面板**（替换上游 `mcpStatus` 那格） | **新**：`mcp.request`（§3.6）。理由：上游 `mcpStatus` 指向的是 DSH 自己的 MCP 世界，与 ace 不通 ⇒ 直接显示会**显示"未配置"而 ace 明明配了**（撒谎比空着更坏） |
| 工具清单 | 每个 server 列前 20 个工具名（`ai_code.py:2427-2435`） | 同一份 `status()` 的 `tool_names` | MCP 面板的展开区 | **新**：同上（`servers[].tools`） |
| MCP 工具在卡片上的身份 | `mcp__` 前缀的工具按名字里有没有 read/search/… 判"只读"（`ui/ace_cards.py:49-63`） | `result["tool"]` 的名字前缀 | 工具卡片的折叠规则 | **复用** `tool_result.tool`（名字前缀）；不新增字段 |
| 执行策略的可见面 | 审批弹框 + 拒绝结果（无独立屏） | `permission_request{tool,reason}`（`ace_events.py:19`）+ `tool_result.outcome`（`:18`） | 审批通知 + 拒绝徽标 | **复用**（同 `CAP-03`） |
| MCP server 模式 | `ace --mcp`（外部 host 借执行层） | `core/ace_mcp_server.py` | 与本次换壳无关（不接界面） | **不适用** |

---

### CAP-07 同批要露出的两项

| 子项 | ace 现在长什么样 | 引擎侧命令 / 事件 | 在新壳里落在哪 | 协议 |
|---|---|---|---|---|
| **CAP-07a 权限三档 + agent 预设**（安全边界） | 状态行 `权限:{readonly\|write\|full}` 段（`ai_code.py:3119-3120`）+ `agent:{name}` 段（`:3131-3134`）；用户级 `_note_prefix_change` 通知 | `/permission`（`:1874` → `_handle_permission`）；`agent_preset` 事件四维 `name/permission/previous/changed/warnings`（`ace_events.py:26`、`:88`） | 状态行段 + 设置分区 + **通知**（"比全局严在哪"） | **复用** `status.segments[name=permission\|agent]` + `agent_preset`。`changed`/`warnings` 必须变成**至少一条通知**，不许静默吞 |
| **CAP-07b 队列 / 暂存**（便利性） | 状态行 `queue{N}` / `stash{N}` 段（`ai_code.py:3158-3164`）；`/queue clear`、`/stash pop`（`:1833-1834`） | `status` 事件的段 | 状态行段 + 命令面板 | **复用** `status.segments[name=queue\|stash]`；动作复用 `command.exec` |

---

## 2. 优先级

**判据（按序）**：**安全边界相关 > 可逆性相关 > 便利性。** 三项都占的排最前。

| 波 | 项 | 为什么在这一波 |
|---|---|---|
| **零（前置）** | **引擎先行项**：`sessions.request` 扩字段 + `sessiontree.request` + `settings.request`（§3.7） | **不是界面活，是引擎活（Python 侧）**。会话浏览器 / 会话树 / 设置面板三块屏在引擎侧**没有数据源**，前端先做就是空壳（K3 结论："前端写多漂亮都是空壳"）。它们不占"安全边界"判据，但**卡住波三的大屏**，所以单独立项、先于那三块屏 |
| **一（先有）** | `CAP-02` sandbox / net（含 `option_sets`） | 安全边界。档位不可读不可改 = 用户不知道自己有没有边界，而 F2/F3 今天是**一等入口**（`ui/ace_engine_repl.py:178`） |
| **一** | `CAP-03` rules / audit + `tool_result.refusal_class` | 安全边界 + 合规取证。审计数据今天只能以 `notice` 文本滚过（`.recon/F-adapter.md` §⑤），合规场景直接失效 |
| **一** | `CAP-06` MCP 状态 | 安全边界 + **不许撒谎**。工具面来源不明等于"我不知道我在跑什么" |
| **一** | `CAP-01` 快照 / `/undo` | 可逆性。且"看起来成功其实没回滚"的风险今天对用户**不可见** |
| **一** | `CAP-07a` 权限三档 + 预设 | 安全边界（"比全局严在哪"的变化通知会被吞） |
| **二（可晚）** | `CAP-04` `@` 体系 | `@file/@folder/@session` 是上下文注入面，错了会误导模型；但它是**可用性**问题不是**边界**问题（用户还能手打路径） |
| **二** | `CAP-05` 字形降级 | 便利性（可读性）。**但零协议成本**（`initialize.glyphs` 已在发），换壳时顺手接，别拖成"弱终端上界面坏了" |
| **三（最后）** | `CAP-07b` 队列 / 暂存 | 纯便利性。信息已在 `status` 段里，接一下就有 |

> **一句话**：波一全部是"不接就等于把关掉的安全边界/回滚能力藏起来"，波二波三是"不接只是难用"。

---

## 3. 新协议面汇总（最小形状）

**总计：5 个新方法 + 2 个新字段。** 全部只读；**所有动作复用 `command.exec`**（不新增写方法 —— 少一条路就少一条会漂的路）。
**§3.7 的引擎先行项另计**：`sessions.request` 扩字段（不新增方法）+ 2 个新方法（`sessiontree.request` / `settings.request`），
同为只读、同复用 `command.exec`。
新方法一律沿用既有帧格式（`core/ace_serve.py:23-35`）与 `_requires_init` 门槛，并登记进 `SERVE_METHODS`（`ai_code.py:8580-8591`）
—— 注册表与承诺清单会在启动时当场比对（`:8836-8840`），漏登记会直接炸，不会静默不工作。

### 3.1 `snapshots.request`（CAP-01）

```
req  {"limit": 20}
resp {"snapshots":[{"id":"1730000000_tag","tag":"...","created_iso":"2026-10-04 19:00:00",
                    "file_count":12,"precise":true}],
      "total":3,"limit":20,"enabled":true}
```
- 唯一生产者：`guardian.list_snapshots()`（`core/guardian.py:591-602`）。
- `precise` = 这次快照有没有"精确的目标集"（`core/guardian.py:486-496`）；
  不精确时新壳必须显示"仅尽力"，**不许**显示成成功。
- `enabled=false`（guardian 关掉，`ai_code.py:7917-7918`）时新壳显示"快照未启用"，不是空列表。

### 3.2 `config.request` 增 `option_sets`（CAP-02）

```
resp {..., "option_sets": {"sandbox":[["off","arg_sandbox_off"],["job","arg_sandbox_job"],
                                       ["docker","arg_sandbox_docker"]],
                           "net":[["on","arg_net_on"],["off","arg_net_off"]],
                           "permission":[[...]], "effort":[[...]]}}
```
- 唯一生产者：`ui/ace_menu.ARGUMENT_HINTS`（`ui/ace_menu.py:45-75`）。发 `(值, i18n键)` 对，
  **不发译文**——与 `initialize.commands` 同一口径（`ai_code.py:8673-8675`）。

### 3.3 `rules.request` + `audit.request`（CAP-03）

```
req  {"method":"rules.request","params":{"scopes":["local","project","user"]}}
resp {"rules":[{"scope":"project","tool":"file_write","pattern":"src/**","action":"allow",
                "source":"<规则文件>","shadowed_by":null}],
      "pending":[{"index":1,"action":"deny","tool":"terminal_exec","fingerprint":"a3f2",
                  "refusal_class":"POLICY","evidence":"..."}],
      "warnings":["..."]}

req  {"method":"audit.request","params":{"section":"stats","n":20,"kind":""}}
resp {"section":"stats","stats":{"events":912,"kinds":[{"kind":"tool/result","count":210}],
       "tools":[{"tool":"file_read","calls":40,"errors":1}],
       "bytes":{"total":135168,"unique":6758},
       "seq":{"duplicates":[],"gaps":[]},"bad_json":0,"missing_fields":0,"source":"ace-engine"}}
```
- 唯一生产者：`core/ace_rules.py:268 load_rules` / `:318 describe_rule` / `core/ledgers` 的 `proposals`；
  `audit` 的 `stats` **复用** `ace_engine.session_meta(path)`（`ai_code.py:3393-3408`，`source` 如实标 `ace-engine`/`python`）。
- `section: "boundary"` 时返回 `boundary` 而不是 `stats`（对应 `_show_audit_boundary`，`:3461`）。
- 签字动作**不新增方法**：复用 `command.exec{line:"/rules accept 1"}`（人签字必须是人敲命令，`ai_code.py:5250-5253`）。

### 3.4 `tool_result` 增 `refusal_class` + `retryable`（CAP-03）

```
{"type":"tool_result","tool":"file_write","status":"error","outcome":"denied",
 "refusal_class":"BOUNDARY","retryable":false, ...}
```
- 唯一生产者：`tools/status.py` 的 `classify_refusal` / `retryable_for`（RL-02，`THREE-LAYERS.md` §9.5）
  —— **零新逻辑**，`ai_code.py:7811` 已经有同形状的推导调用（今天只算 `outcome`，不把类发出去）。
- 理由：没有 `refusal_class`，新壳只能把 denied 一律画成"失败"，退回 `THREE-LAYERS.md` §0.2 那个病根。
- 字段名用 `refusal_class` 不用 `class`（Python 关键字，见 `THREE-LAYERS.md` §9.2 决定 2）。

### 3.5 `mentions.request`（CAP-04）

```
req  {"kind":"file|folder|session|skill|lang","query":"REA","limit":20}
resp {"kind":"file","items":[{"label":"README.md","insert":"@file README.md",
                             "desc":"","kind":"file","disabled_reason":""}],
      "refs":[{"kind":"file","target":"README.md","chars":4000,"truncated":true}],
      "limits":{"file":4000,"session":6000,"folder_items":30,"skill_chars":8000,
                "images":{"staged":1,"max":4}}}
```
- 唯一生产者：`_menu_state`（`ai_code.py:4731`）→ `ui/ace_menu.mention_items`；`@session` 候选**复用**
  `_sessions_brief`（`:8802-8820`，四字段 `path/when/turns/label`）；`@file/@folder` 的路径取值交给新壳自己的
  文件系统补全（文件系统的事不该塞进引擎 —— `ai_code.py:4760` 的原话）。
- `refs` 是"已引用上下文"芯片行的数据源（对应 `@refs`，`:1475`）；`truncated` 让"被截断了"看得见。
- `limits` 的数字全部来自既有常量（`ai_code.py:471-482`），**不发**手抄副本。

### 3.6 `mcp.request`（CAP-06）

```
req  {"tools": true}
resp {"servers":[{"name":"filesystem","status":"就绪","tools":12,"command":"npx ...",
                  "error":"","tool_names":["mcp__filesystem__read_file", ...]}],
      "configured":true}
```
- 唯一生产者：`el.mcp.status()`（`ai_code.py:2411`）。`configured=false` 时 `servers` 为空 ——
  新壳必须显示"未配置 MCP"（`ai_code.py:2404-2409` 的 `mcp_none` 语义），
  **不许**沿用上游 `mcpStatus` 的空态文案（那会撒谎）。

### 3.7 引擎先行项：会话三件套的数据源（K3 实测）

> ⚠️ **这三条是引擎活（Python 侧），不是前端自研。** 前端把屏写多漂亮都不会有数据。
> 形状下全给"字段名 + 类型 + 谁发"，验收一律落在 `test_all [69]`（§4 末尾三行）。

**现状（K3 实测）**：`sessions.request` 只回 `{path, when, turns, label}` **四字段**（`ai_code.py:8816-8819`）
—— **没有会话树、没有设置写通道** ⇒ 会话浏览器 / 会话树 / 设置面板在引擎侧没有数据源。

#### 3.7a 会话浏览器：`sessions.request` 扩字段（**不新增方法**）

```
resp {"sessions":[{"id":"20261004-1930",                          # str  ← 新
                   "path":"...\\.ace_sessions\\20261004-1930.jsonl", # str  ← 保留
                   "when":"昨天 19:30","turns":12,                 # 既有四字段，保留
                   "label":"帮我改一下 X",                          # str  ← 保留
                   "project":"ace","root":"G:\\AI_Project\\ace",   # str  ← 新（_sessions_brief 已算、今天不发）
                   "bytes":481203,"mtime_iso":"2026-10-03T19:30:04", # int / str ← 新（同一个 stat() 顺手拿）
                   "tools":88,"compactions":1,"security_denied":0, # int  ← 新（summarize() 已算、今天不发）
                   "first_user":"...","has_prompt":true}],         # str / bool ← 新
       "total":37,"limit":20}
```

- **谁发**：`_h_sessions`（`ai_code.py:8802`）→ `cli._sessions_brief()`（`:5496`）→ `cli.ace_sessions.summarize()`
  （`cli/ace_sessions.py:129-139`）+ `path.stat()`（`:5521` 今天已经在调）。
- **零新逻辑**：`project/root/tools/compactions/security_denied/first_user` 六个字段**今天就算出来了**，
  只是 `_h_sessions` 往外发时只挑了四个；`bytes/mtime_iso` 与 `when` 共用同一次 `stat()`。
- **`id`**：取会话文件名（`path.stem`），单源 = `_session_files()`（`ai_code.py:5840`）。
  今天只有 `path`，而 `path` 随项目根变（`:5467-5473`），当不了稳定身份。
- **不发**：SRC `SessionSummary` 的 `kind/createdAt/agentPreset/branch/childCount` 等 —— **无生产者**，
  按口径 3 如实标不可用，**不许塞 `undefined` 假装有**（`.recon/F-adapter.md` §4.4 第 2 条）。
- **怎么算做完**：`test_all [69]` 一条断言：每个 item 的键集合 == 上表声明集合；且
  `turns/tools/compactions/security_denied` 与**同进程直调** `ace_sessions.summarize(events)` 逐项相等
  （单源对拍，防协议层/前端各算一份）；`id` 在两次请求间稳定。

#### 3.7b 会话树：`sessiontree.request`（**新方法，只读**）

```
req  {"path":"", "preview":false}                 # path 空 = 当前会话
resp {"session_id":"20261004-1930",
      "nodes":[{"seq":41,"kind":"user/message","parent":38,"tip":true,
                "turn":6,"preview":"继续改 A 的那段…","active":true}],
      "active_head":41,"tips":[41,57],"single":false,
      "parent_session":""}                        # 跨文件父子：**无生产者**，恒 ""（如实标不可用）
```

- **谁发**：`cli/ace_sessionlog.py` **已有**的 WP-5 entry 树 —— `message_chain()`（`:146`，`parent` 指针）、
  `branch_tips()`（`:192`）、`active_head()`（`:167`）、`assemble_branch()`（`:204`）；
  轮次用 `ace_sessions.turn_count()` / `iter_user_turns()`（`cli/ace_sessions.py:36-47`）。
- **好消息**：树的数据源**不是没有，是没接出去** —— `/tree`（`ai_code.py:6426-6492`）今天就在用这几个函数
  渲染文本，`branch_tips()` 已经给出"多 tip + 活跃头"。K3/F 的"无数据源"对**跨文件 fork/clone 的父子关系**成立
  （只在内存 `_resumed_from`，`:4391`，没落日志），对**文件内分支**不成立 ⇒ 树能画，父子关系如实标不可用。
- **动作不新增方法**：切分支复用 `command.exec{line:"/tree <编号>"}` / `"/tree @<轮次>"`
  （`:6455`、`:6486`），与 NG4 一致；回报走 `notice` + 重取 `sessiontree.request`。
- **怎么算做完**：`test_all [69]`：`tips` 序列 == 同进程直调 `branch_tips()` 的 `seq` 序列；
  `active_head` == `active_head()` 直调值；`/tree <i>` 之后重取，`active_head` 变成 `tips[i-1]`
  （**有回报，不是盲发命令** —— F §4.4 第 1 条点名的就是这个）。

#### 3.7c 设置面板：`settings.request`（**新方法，只读**）+ 写通道口径

```
req  {"section": ""}
resp {"sections":[{"id":"security","label_key":"set_sec","items":[
        {"key":"permission","type":"enum","current":"readonly","default":"readonly",
         "enum":[["readonly","perm_readonly"],["write","perm_write"],["full","perm_full"]],
         "scope":"global","label_key":"set_permission","write_cmd":"/permission {value}",
         "secret":false,"hot":true},
        {"key":"api_key","type":"str","set":true,"default":"",
         "write_cmd":"/config","secret":true,"hot":false}]}]}      # secret 项：**不发 current**，只发 set
```

- **谁发**：`current` 取 `home_state()`（`ai_code.py:5530`）；`enum` **复用** `ui/ace_menu.ARGUMENT_HINTS`
  （与 §3.2 `option_sets` 同一单源，不许手抄第二份）；**键表本身要新建一处 Python 声明**
  （`key/type/scope/label_key/write_cmd/hot`）—— 今天这套信息散在 `self.cfg.get(...)`（实测 195 处）
  与 `_config_steps()`（`:3875`）里，**这是本项的主要工作量**。
- **写通道 = 不新增写方法**（NG4）：每个 item 带 `write_cmd` 模板，面板把人点的值填进去发
  `command.exec{line:...}`。**已知上限**：不是每个键都有对应斜杠命令（如 `keybindings`）——
  没命令的项标 `write_cmd:""` + `hot:false`，界面显示"此项需在 `/config` 向导里改"，**不许静默吞掉点击**。
  （日后若确需 typed write，那是一次**显式的口径变更**：新方法 + 审批往返，不在本卡。）
- **凭据**：`secret:true` 的项**不回传明文** —— 只回 `set: bool`，**没有** `current` 字段
  （H-33 / `CREDENTIAL-HANDLING.md` 的回显边界）。
- **怎么算做完**：`test_all [69]`：① 每个 item 的 `write_cmd` 首词 ∈ 命令表（`COMMAND_HANDLERS`，`ai_code.py:1861`）
  或为空串；② `secret:true` 的项**不含** `current` 键、且 `set` 是 `bool` —— 防凭据从只读通道漏出去；
  ③ `enum` 与 `ARGUMENT_HINTS` 对拍（与 §3.2 共用同一条断言）。

---

## 4. 验证判据（"怎么算做完了"）

**通则**：每条判据都要有一条断言**同时盯着协议字段的产出**与**新壳里的落点**。
协议侧断言落在 `test_all [69]`（双向协议 —— `ace --serve`）；字形相关的落点在 `[67]`；
回滚相关在 `[82]` / `[3]`；规则在 `[56]`。**只接 UI 不接断言 = 没做完**（`THREE-LAYERS.md` §9.3 的教训：
"纯规则一致 ≠ 接上了"）。

| 项 | 算做完了 | 怎么测 |
|---|---|---|
| `CAP-01` | ① `/undo` 在新壳里可触发（键位或命令面板）；② 触发后 `config.request.snapshots` 减一；③ 快照面板列出与 `guardian.list_snapshots()` **同一份 id 集合** | `test_all [69]` 加断言：`snapshots.request` 的 `id` 序列 == 同进程直调 `guardian.list_snapshots()` 的 id 序列（含 `precise` 字段存在性）；`[82]` 加一条"`/undo` 后 `snapshots` 数减一" |
| `CAP-02` | ① 状态行有 `sandbox`/`net` 两个具名段；② `option_sets.sandbox` 与 `ui/ace_menu.ARGUMENT_HINTS["/sandbox"]` **逐字相等**；③ 新壳能从段上直接切档 | `test_all [69]` 加断言：`config.request` 同时含 `sandbox`/`net`/`permission` 与 `option_sets`，且 `option_sets` 与 `ARGUMENT_HINTS` 对拍（防手抄第二份） |
| `CAP-03` | ① `rules.request.pending` 条数 == `refusal_ledger.proposals` 长度；② `/rules accept 1` 后 pending 减一；③ 审计屏显示 `stats.source`；④ 工具卡片上"拒绝/失败"由 `refusal_class` 决定，不由文案决定 | `test_all [69]`：`tool_result` 事件的 `refusal_class` == `classify_refusal(status, error_code)`、`retryable` == `retryable_for(...)`（与 `[36]` 的唯一判定处对拍）；`[69]` 再加 `rules.request`/`audit.request` 的形状断言 |
| `CAP-04` | ① 输入 `@` 有补全；② `@session` 候选与 `sessions.request` **同一份**；③ 以 `@` 开头的行在新壳走 `command.exec`；④ 截断发生时通知区有一条 | `test_all [69]`：`mentions.request{kind:"session"}` 的 `label` 序列 == `sessions.request` 的 `label` 序列（唯一来源对拍）；协议级断言：`@file x` 走 `command.exec` 时 `context_refs` 真的变了（`user.message` 路径不变） |
| `CAP-05` | ① 新壳把 `initialize.glyphs` 套到自己的边框/符号表上；② 弱终端下不出现原字 | `test_all [67]` 加断言：`initialize.glyphs` 的键 ⊆ `FRONTEND_GLYPHS` 且每个值 != 键（生产者已存在，这里钉的是"确实下发了"）；新壳侧一个纯函数 `applyGlyphs` 的单测 |
| `CAP-06` | ① MCP 面板列出与 `el.mcp.status()` 逐字段一致的行；② 未配置时显示"未配置"而不是空/上游空态 | `test_all [69]`：`mcp.request.servers` 与 `el.mcp.status()` 逐字段对拍；`configured=false` 时 `servers == []` |
| `CAP-07a` | `agent_preset` 的 `changed`/`warnings` 非空时，新壳至少产生一条通知 | `test_all [69]`：构造非空 `warnings` 的预设切换 → 断言事件里字段在（生产端已有，见 `[86]`）；新壳侧断言渲染出通知条数 ≥1 |
| `CAP-07b` | 状态行出现 `queue`/`stash` 段且数字随排队变化 | 复用既有 `status` 段断言（`ai_code.py:3158-3164`）；`[69]` 加一条 `segments[].name` 含 `queue` |
| **引擎先行 a** 会话浏览器 | `sessions.request` 每项字段到齐、无 `undefined`；`id` 稳定；数字与 `summarize()` 同源 | `test_all [69]`：① 键集合 == §3.7a 声明集合；② `turns/tools/compactions/security_denied` == 同进程直调 `ace_sessions.summarize(events)`；③ 两次请求 `id` 相同 |
| **引擎先行 b** 会话树 | `sessiontree.request` 列出各分支 tip 与活跃头；`/tree <i>` 切完**有回报** | `test_all [69]`：① `tips` / `active_head` == 直调 `branch_tips()` / `active_head()`；② `/tree <i>` 后重取，`active_head == tips[i-1]`；③ `parent_session` 字段存在且为 `""`（无源就如实空，不许造） |
| **引擎先行 c** 设置面板 | 每个设置项都能指回一条真命令；凭据不回显 | `test_all [69]`：① `write_cmd` 首词 ∈ `COMMAND_HANDLERS` 或为空串；② `secret:true` 项**不含** `current` 键且 `set` 是 bool；③ `enum` 与 `ARGUMENT_HINTS` 对拍 |

---

## 5. 风险：会与上游组件冲突的点

| # | 风险 | 冲突在哪 | 缓解 |
|---|---|---|---|
| **CAP-R1** | **上游状态行有自己的数值模型**（`tokens/mainCost/contextWindow/tps/...`），而 ace 的 `status` 发的是**已格式化文本段**（`ace_events.py:25`、`ai_code.py:3122`） | 硬塞 = 同屏两套状态行；让上游覆盖 = 那十几项数值全空 | ace 的段走**扩展段槽位**，不动上游的数值行；缺的数值如实显示"未知"。**明确拒绝**重解析中文文本造数字（`.recon/F-adapter.md` §4.4 第 4 条已判此为不可接受） |
| **CAP-R2** | 上游 `ui-policy` 自带 permission/preset 选择器与它自己的 preset 概念 | ace 的 `agent_preset` 是**四维**（`read/edit/webfetch/bash`，`ace_events.py:26`），上游是单档 preset ⇒ 只能映射一部分 | 映射不了的（`changed`/`warnings` = "比全局严在哪"）**走通知**，不塞进上游选择器 |
| **CAP-R3** | **两套 i18n**：上游 `src/i18n.ts` vs ace 的 `ui/i18n.py` + `language` 事件；且 `initialize.commands` 发的是 **i18n 键不是译文**（`ai_code.py:8673-8685`） | 新壳没有 ace 的键表 ⇒ 命令菜单与主页**显示空/显示键名** | 新壳必须随壳带一份 ace 的键表（或订阅 `language` 事件后向引擎取）；这条不改、换完壳当场可见 |
| **CAP-R4** | **上游没有 glyph 替换概念**：Ink 主题/边框字符是写死的 | 弱终端（WSL/tmux/SSH）上框线错位、豆腐块 | `initialize.glyphs` 已在发（`ai_code.py:8667-8670`），新壳的渲染层必须真的用 `glyphs[c] ?? c` 过一遍**自己的**符号表 |
| **CAP-R5** | 上游 `mcpStatus` 指向 DSH 自己的 MCP 世界 | 直接显示 = **撒谎**（显示未配置，而 ace 明明配了） | 用 `mcp.request` 覆盖那一格；没有真源时如实标不可用 |
| **CAP-R6** | 上游的插件/场景/面板/扩展宿主（`scenes`/`panels`/`extensions`）有**自己的生命周期**（`.recon/F-adapter.md` §②） | 把 ace 的能力挂上去 = 引入上游生命周期与 dispose 语义，能力会随宿主状态漂 | **不挂**。ace 的面板只用新壳的"屏/面板槽位"，不注册成上游插件 |
| **CAP-R7** | `session.interrupt` 在**轮次进行中读不到**（`core/ace_serve.py:413` 单线程 + `:498` 唯一嵌套读） | 新壳的取消键在轮次结束前**不生效**；若 UI 显示"已停止"就是又一次"看起来成功" | UI 如实显示"停止请求已记录，等本轮收尾"；真正的修法（读线程/带外信号）是 ace 侧单点改动，**不在本卡**（`.recon/F-adapter.md` §③ 取消行） |
| **CAP-R8** | 上游的会话 picker / 会话树 / 子代理看板要 13 字段与会话树数据模型 | ace 没有 ⇒ 塞 `undefined` 或整块砍 | 会话浏览器 / 会话树**改由 §3.7a/§3.7b 补数据源**（引擎先行项）；**子代理看板仍不解决**。无源字段按口径 3 显示"此项不适用于 ace"，不许显示空 picker（`.recon/F-adapter.md` §4.4 第 1/2/7 条） |

---

## 6. 前置门与落点勘误（K1/K3 实测，实施前必读）

### 6.1 门 G1：动输入区之前，先确认真机上的 IME 候选框定位

**为什么是门**：把终端物理光标"停在输入框插入点"的能力叫 `useDeclaredCursor`
（vendored 内核自述：*"Terminal emulators render IME preedit text at the physical cursor position …
makes CJK input appear inline"*，`frontend/vendor/dsh-ink/lib/types/ink/hooks/use-declared-cursor.js:1-26`）。
而**公开渲染面 `ui.js` 没有导出它**，`exports` 又把 `./ink` 深路径封死（§6.4）——
缺它的后果不是"少个功能"，是**中文输入法候选框不跟着光标走**（贴到窗口边缘/上一行），
而**中文用户是 ace 的主要用户群**。

| 项 | 内容 |
|---|---|
| **门** | **输入区（`PromptInput` 那一路 / W3）开工之前**，必须先有一份真机结论；没有结论不许动输入区 |
| **谁验** | 用中文输入法的**真机用户**（最低集：Windows Terminal + 微软拼音；tmux / WSL / SSH 各算一档）。**不接受只有 CI / 金样测试的结论** —— 金样测不出候选框落在哪 |
| **怎么验** | 新壳输入区跑起来 → 敲中文 → 看候选框是否**贴在插入点**；再敲 `@` 补全菜单、多行/粘贴、`/` 命令菜单各一次（菜单抢焦点是第二高发点，上游 `useDeclaredCursor` 也用在 `ListItem` 上）。结论（含终端与输入法版本）写进 `.recon/`，别只在聊天里说 |
| **验不过的替代（按优先级）** | **① 直接用 vendored 私有 hook**：`frontend/vendor/dsh-ink/lib/types/ink/hooks/use-declared-cursor.js` 与渲染器的 `cursorDeclaration` 管线（`ink.js:197-207`）**成对存在**，同一份 vendored 内核认这个声明 ⇒ 从 vendored 路径 import 即可，不需要上游改包。**这条路仍要真机验**（验的是终端行为，不是 import 成功）。<br>**② 输入行不换**：保留 Python `ui/ace_prompt.py` 的原生输入（降级/headless 路径本来就在，§0 范围决定），新壳只读它的回显 —— 代价是输入区两套键位。<br>**③ 请上游在 `ui.js` 加导出**（跨包，需 SRC / 上游配合，最慢） |
| **兜底纪律** | 门没过就不许合并输入区。**不许**"先合并、等用户投诉再说" —— 那等于把主要用户群的输入体验当可选项 |

### 6.2 落点勘误：v0.12.0 已把 `SurfaceEdges.tsx` 并入 `PageMargin`

**按旧文件名找会落空**：`B-design.md` / `INTEGRATION.md` 里的 `components/SurfaceEdges.tsx`
（`SurfaceEdges.tsx:13-24`、`:26`）在 **v0.12.0 已经不存在** —— 它并进了 `PageMargin`
（出血额度 / `PageInsetContext` / `usePageInset()` 现在从 `LIB/components/PageMargin.js:4,8,16` 出）。
所以几何层的落点是**一个**文件（新 `frontend/src/tui/page-margin.tsx`），不是两个；
照 `SurfaceEdges` 去找会白跑一趟（K3 §2 第 2 行与 §③ 第 2 条）。

### 6.3 唯一可复用的公开渲染面是上游 `ui.js`；`index.js` **永不碰**

| 入口 | 是什么 | 处置 |
|---|---|---|
| `LIB/ui.js` | 头部自述 **"Public rendering surface, themed for dsh-tui"**；导出 `render/renderSync/createRoot`、`ThemeProvider/useTheme`、themed `Box/Text`、`Spacer/Newline/NoSelect/Image`、`AlternateScreen/ScrollBox`、`useInput/useStdin/useApp/useAnimationFrame/useTerminalSize/useTerminalImages/useCopyOnSelect/useBlink`、`Ansi` | **唯一可搬的入口**：新壳的组件只从这里进 |
| `LIB/index.js` | `force-production-react` + `dsh-adapter/**` 的 re-export shim；自述 **"the only module tree allowed to import official @deepseek-ai/\* packages"**，是同进程 **Cordis 宿主插件**（`dsh-adapter` 42,649 行 / 182 文件，110 个 import 指向 `@deepseek-ai/*`） | **永不碰**：碰它 = 把 ace 挂进别人的宿主生命周期（见 CAP-R6），且 `@deepseek-ai/*` 的依赖与许可都不在 ace 的边界内 |

### 6.4 接入方式（这条决定怎么做，不是细节）：`exports` 封死 `./ink` / `./ui` ⇒ 内核是 **vendor 进来**用的

```powershell
node --input-type=module -e "import('@deepseek-harness-tui/dsh-tui/ui').catch(e=>console.log(e.code))"
# → ERR_PACKAGE_PATH_NOT_EXPORTED   （'./ink' 与 './lib/types/ink/components/Box.js' 同样）
```

- 上游 `exports` 只有 `.` `./working-activity` `./oauth` `./workspaces` `./command-trees` `./settings-sections`
  `./scenes` `./extensions` `./plugin-host` `./api` `./jsx-runtime` `./invariant` + 3 个静态文件（K2 B1）——
  **没有 `./ink`，也没有 `./ui`**；`lib/types/ui.d.ts` 那个公共 barrel 不可达。
- ⇒ 接入方式：**不是**"npm 装上游包再 import 子路径"（那条路被封死），而是**逐字 vendor 内核**：
  落点 **`frontend/vendor/dsh-ink/`，135 文件 / 27,890 行**（全部编译后 `.js` / ESM），
  SHA256 与上游 **135 compared / 0 differing**；依赖用 `setup-deps.mjs` 建 21 个 junction 指向公开包；
  **React 19 契约不可降级**（内核认 `react@19.3.0` + `react-reconciler@0.34.0`，与 ace 前端现有 `18.3.1` 是**一次原子切换**）。
- 独立渲染已验：`node frontend/vendor/dsh-ink/probe.mjs` → **5/5 PASS**（含 `\x1b[?2026h` / `?2026l` 同步帧，无宿主、无 TTY）。
- **顺带**：vendored 这一层正是 §6.1 替代方案 ① 能成立的前提（私有 hook 在 vendored 树里，不在包导出面里）。

---

## 7. 非目标

| ID | 不做 | 理由 |
|---|---|---|
| **CAP-NG1** | 在新壳里重解析 ace 的中文/英文文本段来造数字（token/cost/tps/上下文窗口） | 那正是 `THREE-LAYERS.md` §2.1 记的病根（"驱动层要知情必须解析自然语言"）；结构必须走协议 |
| **CAP-NG2** | 给没有数据源的能力造空实现顶类型 | 违反口径 3 与 HL-03②（降级必声明）；空实现 = 撒谎 |
| **CAP-NG3** | 把 ace 的能力注册成上游插件/场景/扩展 | 引入上游生命周期，能力随宿主漂（CAP-R6） |
| **CAP-NG4** | 为写动作新增协议方法 | 全部复用 `command.exec` —— 少一条路就少一条会漂的路（`ai_code.py:8622-8624` 的原话） |
| **CAP-NG5** | 在 ace 里写 TS 适配层 | `.recon/F-adapter.md` §4.1：适配层属于 SRC 侧 `src/ace-adapter/` |
| **CAP-NG6** | 绕过"人签字"环节做规则落地 | DL-04 / `THREE-LAYERS.md` §1.5：放宽只能是人的动作；唯一入口是人敲 `/rules accept`（`ai_code.py:5250-5253`） |

---

## 8. 与既有卡片的关系

| 本卡 | 关系 |
|---|---|
| `UI-OVERHAUL.md` | 上级：整壳替换是那条路线里的一个选项；本卡是"换完之后能力不能丢"的收口 |
| `TUI-PRIOR-ART.md` | 上游研读：`pi`（自研框架）与 Claude Code（改 Ink）两家都**没有**换掉应用模型 —— 本卡的六项正是"换模型会丢的东西" |
| `THREE-LAYERS.md` §2.2 / §3.4 | `CAP-03` 的 `refusal_class` 直接复用 RL-01/RL-02 的信封与六分类；`CAP-02` 的降级声明复用 HL-03② |
| `WP-6-AGENT-PRESETS.md` | `CAP-07a` 的 `agent_preset` 四维与"只许更严"（S-1）同源 |
| `WP-9-SANDBOX-BACKEND.md` | `CAP-02` 的沙箱档位语义（`off/job/docker`） |
| `ACC-GATES.md` | `CAP-03` 的审计体检条与 ACC-02 指标语义契约同源（"数字不许无口径地摆出来"） |
| `.recon/F-adapter.md` §⑤ | 本卡逐条回应那个"反向缺口"清单 |
