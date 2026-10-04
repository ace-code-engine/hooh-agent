# 命令参考（Command Reference）

> 本文档由 README「命令参考」一节拆分而来（docs/design/README-RESTRUCTURE.md，v3.7），内容与当时 README 保持一致。
> README 入口见「常用命令」（只列最常用的）；完整清单在这里。

**首页**：↑/↓ 选择 · 数字直选 · Enter 确认 · Esc/q 退出。聊天内 `exit` 回首页，首页 `7`/`Esc`/`q` 才真正退出。

首页由三块构成：**「当前会话」面板**（模型 / 边界四轴 / 目录 / 历史 —— 包括"恢复了哪一次会话"）、**「最近会话」面板**（最近 3 次，时间 / 轮数 / 首句；没有历史时整块不画）、**分组菜单**（会话 / 模型 / 其他）。面板宽度跟着终端列数走（48–96 列之间），中文按两列算，所以换终端不会错位。

**斜杠命令**（聊天里输入 `/` 实时弹菜单，需 `prompt_toolkit`，未装自动降级）：

| 分类 | 命令 |
|---|---|
| 会话 | `/help` `/keys` `/stash` `/queue` `/clear` `/status` `/statusline` `/tasks` `/fullscreen` `/stats` `/audit` `/history` `/sessions` `/resume` `/fork` `/rewind` `/todo` `/expand` `/mcp` `/exit` |
| 扩展 | `/hooks`（事件钩子与上次结果） `/plugins`（插件与它们贡献的命令/钩子） `/vim`（vi 模式与自定义键位） `/keys`（键位表与冲突警告） `/term`（终端能力与自检） `/rules`（持久授权规则） |
| 安全 | `/permission [level]` `/snapshots` `/undo` `/rollback <id>` `/sandbox [档]` `/net [on\|off]` `/replay` |
| 模型 | `/provider [名称\|编号] [key]` `/model <名称>` `/window [tokens\|auto]` `/config` `/mock` `/thinking [on\|off]` `/style [id]` |
| 工具 | `/open <路径>` `/edit <路径>` `/review` `/diff [序号]` `/search <关键词>` `/memory` `/report` `/goal [动作]` |

```bash
/provider                   # 列出 9 家厂商 · 10 入口（当前标 ✓）
/provider zhipu             # 一键切智谱（自动换到 glm-4.7-flash）
/provider 3 sk-你的key      # 编号 + 密钥一把梭
```

工具输出超过 8 行时卡片折叠，末行写着「已折叠 N 行 (用 /expand 看完整)」——`/expand` 重印上一次被折叠的完整输出（单次最多保留 4000 字符，被截断时会在标题里说明；没有折叠过就如实回答没有）。

**卡片上看什么**：标题是 `符号 工具名 状态 [状态码] · 耗时 · exit 退出码 · +N -M`。

- **`· exit N`**：命令类工具的退出码。**"跑完了"和"成功"是两件事**，非 0 时标题不再用绿色 —— 由你自己判断这次算不算成功
- **`· +N -M`**：写入类工具改了几行；正文逐行 `+`（绿，新增）/ `-`（红，删除）/ `@@`（青，区块位置），文件头按暗色（它不是增删行）
- 一轮里调用 ≥2 次工具时，收尾会有一行 `N 次工具调用 · 耗时 · 工具名 状态…` 汇总；只调一次不打这行。**连续同名调用会合并**成 `file_read ×2 ✓`（只合并连续的 —— `读·写·读` 合成一段会把顺序讲错），合并段按最后一次调用定性
- 新文件不显示 diff（全是 `+` 行没有信息量）；`.env` / `*.pem` / `id_rsa` 这类凭据文件**不读旧内容**，所以也不显示 diff

**底栏**（常驻，直接显示状态而不是等出事才说）：`模型 | 权限 | 沙箱 | 联网 | 目标 | 轮数/工具数 | 上下文占比`。
- 上下文占比是**估算**（口径见 `cli/ace_context.py`：中文按字计，宁可高估），颜色即语义：灰=有余量 · 黄=用掉压缩触发点的 80% · 红=已达触发点（下一轮会把中段折成摘要）
- 窗口未知时不显示这一项——不拿 0 当分母造一个假百分比
- 逼近阈值时会在请求发出前提醒一次（按触发点的 10% 一档节流，不会每轮刷屏）；`/status` 里有 tokens/窗口/触发点的明细
- 用 `--no-compact` 关掉压缩后，`/status` 会额外说明"超出窗口直接硬截断"，免得以为还有压缩兜底

**输入行（模式与快捷键）**：

- **`! <命令>`** — 直接执行本机命令并把输出贴进上下文（不走模型，但**走执行层**：权限/审批/沙箱/审计一个不少）。提示符会变成黄色的 `! `
- **单独一个 `?` 加回车** — 弹出快捷键表（真实终端里"按 ? 弹菜单"不可靠，做成回车时判定）
- **大段粘贴自动折叠** — 超过 6 行或 800 字符折叠成 `[粘贴 #1 +30 行]`，**提交时自动展开**（输入行与屏幕不再被自己的粘贴刷掉）
- **`Ctrl+S` 暂存 / `/stash pop` 取回** — 一句话写一半想问别的；底栏显示 `暂存1`
- **`/queue <文本>`** — 排到当前这轮之后自动执行（一次交代几件事时省一次等待）；底栏显示 `队列1`
- **长输入回显截断** — 提交后回显最多 12 行，并**说明实际发出多少行/字符**（不静默截断）
- `/keys` 列出内置快捷键与自定义键位；改键位写配置 `keybindings`

**对话框（统一的提问长相）**：单选/多选、分组标题、进度条、页签、脚注按键提示都由 `ui/ace_dialog.py` 渲染，**每行宽度严格对齐**（中文按两列算）。多选复用同一个模糊搜索浮层：输入即过滤 · `Space` 勾选 · `Enter` 确认 · `Esc` 取消。非交互会话（脚本/管道）不弹框、不阻塞，也不会假装有人选过。

**会话级授权（`/permission rules`）**：勾选 = 本次会话不再逐次确认，**取消勾选 = 立刻收回**。

- 候选只列当前档位下**仍要请示**的工具（已免费放行的不列）
- 结果分三类报出：真的进会话级规则 / **按设计拒绝**会话级授权的（`terminal_exec` 与外发工具 → 明说"只能单次"）/ 收回的
- 非交互会话只列出规则，什么都不改

**配置向导（`/config`）**：三步（提供商 → 密钥 → 模型）。输错**当场重问**，`b` 退回上一步，模型步的可选值跟着上一步选的提供商走。**答案先攒着、跑完才落库** —— 中途取消就是真的逐字段未变（旧实现边问边改内存配置，嘴说"没保存"，实际早改了）。

**底栏（`/statusline`）**：底栏是"分段 + 优先级"，不是一段写死的字符串。

```
❯ /statusline
  底栏分段（当前顺序）: model · permission · sandbox · net · goal · turns · todos · queue · stash · images · context · cost
  可用分段: model, permission, sandbox, net, goal, turns, todos, queue, stash, images, context, cost
  /statusline model,context,-turns 改顺序；-名字 = 去掉该段（窄终端会自动按优先级丢装饰）
```

- 终端窄了先丢装饰（轮数/工具数），**先保住上下文占用与目标进度**；丢完还会回填，20 列时是"模型 + 上下文"而不是只剩模型
- 写错分段名如实报错，不当成设置成功；设置会写进配置

**任务树（`/tasks`）**：目标 + 逐项待办 + 此刻在跑的工具画成一棵多行树（三者都空时如实说没有）。状态符号与 `todo` 清单同一套口径：`✓` 完成 / `▶` 进行中 / `·` 待办 / `✗` 阻塞。

**全屏会话（`--fullscreen` 或 `/fullscreen [on|off]`）**：备用屏幕里固定四块 —— 头部 / **会话滚动区** / 状态行 / 输入行。

- `PageUp` / `↑` 回看（提示行给出 `↑12-24/96`）、`End` 回底、`PageDown` 翻页；退出全屏后终端画面原样恢复
- `F5` 退出全屏回到普通 REPL；`Ctrl+O` 展开最近一次折叠；`F1`–`F4` 与普通 REPL 同义
- 输出进滚动区靠替换 `sys.stdout`：CLI 照常 `print`，带 `\r` 的重绘（等待动画/进度）整条丢掉，不会变成一屏残影
- 终端小于 8 行或缺 `prompt_toolkit` 时**直接回退普通 REPL**；全屏里不弹嵌套浮层选择框（要弹框按 F5 退出全屏）

**补全菜单（两条路径共用同一份候选）**：

- 输入 `/` 立刻弹命令菜单（按分组、带说明，模糊匹配）；`/permission ` 会弹**参数菜单**（`readonly/write/full/rules`），`/sandbox d` 也能命中 `docker`；`@` 弹提及（`lang/skill/file/folder`，`@lang ` 弹取值，`@file`/`@folder` 走路径补全）
- **回车语义**：候选会改变输入 → 先补全（不发送）；候选与已输入一致（命令已打全）→ **直接发送**。所以"打全就发"和"打一半补齐"两个直觉都成立，不必记两条规则
- `Tab` 补全当前候选（空输入按 Tab 直接起一个 `/`）；`Esc` 先关菜单、再清输入
- **没装 `prompt_toolkit` 也有菜单**：内置输入行是标准库实现（菜单/历史/行编辑/`Ctrl+R`/`Ctrl+L`/`Ctrl+O`/`F1–F4`），只是不画浮层；想换成浮层菜单就按提示装一下，或运行 `ace --install-ui`

**只读工具折叠**：连续的读文件/检索/列目录/看输出类调用**成功时不打卡片**，收尾汇总成一句话（`读取 3 项 · 检索 1 次`）；失败照打（出错的读必须看得见），写/执行类永远单独显示 —— `写 → 读 → 写` 只折叠连续的段，顺序不会被讲错。

**授权对话框（危险那一步的规矩）**：编号三态 —— `1` 本次允许 / `2` 本会话允许 / `3` 拒绝；`y`/`a`/`n` 老手感照旧；**空输入 = 拒绝**（回车在危险对话框里不等于放行）。拒绝可带一句给模型的话：`n 别动那个文件` → 理由随拒绝回传（`【用户拒绝的理由】…`），拒绝变成一次可执行的纠偏。理由长度夹 400 字符。

**Esc 的分层语义**：菜单开着 → 关菜单（输入保留）；有输入 → 清空；**空输入双击**（0.8 秒内两下）→ 打开历史选择器（↑↓ 挑、回车**填入**不发送、Esc 关闭）；历史为空则什么都不做。

**状态行防抖**：文案变化有 0.3 秒最小间隔 —— 第一次立即生效，窗口内第二次等窗口过去（被挡下的文案进 pending，不丢），避免模型连切工具时状态行抖动。

**热键补充**：`Ctrl+T` = `/tasks`（任务树）；`Ctrl+E` = 全部展开；`Ctrl+O` = 展开最近一次折叠。


**持久授权规则（`/rules`）**：写文件的规则，跨会话生效（`/permission rules` 只管本次会话）。

```
/rules add file_write docs/ project      # 允许免问（路径在 docs/ 下），写进随仓库的 .ace/permissions.json
/rules add terminal_exec '!rm:*' local   # 前缀 ! = 直接拒绝，写进不进 git 的 .ace/permissions.local.json
/rules                                   # 列出：序号 / 动作 / 说明 / 作用域 / 来源文件
/rules remove 2
/rules check                             # 规则体检：deny/allow 命中 + 仍需人确认的未覆盖风险面
```

- 作用域三档（优先级 local > project > user）：`local` = `.ace/permissions.local.json`（不进 git）、`project` = `.ace/permissions.json`（随仓库）、`user` = `~/.ace/permissions.json`（全局）
- 模式：命令类是前缀（`pytest:*`；不写 `:*` 要求完全相同）、文件类是路径前缀、留空 = 该工具任意用法
- 三条安全纪律：**deny 永远赢**；**外发工具只能 deny**（授权目的地用 `egress_allowlist`）；**规则不提权**（readonly 下写/执行照样要授权）
- 命中 deny → 直接拒绝并说明规则出处；命中 allow（且当前等级本来就允许、规则带明确模式）→ 不再逐次问
- **授权时就能顺手记**：选「2) 本会话允许」后会多问一句（回车=不记 · `y`=按建议记 · `y <模式> <作用域>` · `! <模式>`=记成拒绝）。建议模式默认取最小范围（命令取第一个词 + `:*`、文件取所在目录），外发工具不提供这一问




**键位（`/keys`）**：内置键位 + 自定义键位 + **被拒键位的理由**。

- 保命键（Enter / Esc / Ctrl+C …）与已接真功能的键（Ctrl+S / Ctrl+O / Ctrl+L / F1–F4）**不许覆盖** —— 覆盖它们不是改键位，是"两件事各做一半"
- 键名写法不对、值不是斜杠命令、条数超 20，都会在表下列出；此前这些是静默忽略（按下没反应，只以为软件坏了）
- 自定键位只能绑斜杠命令（想跑脚本用 hooks，那件事有它自己的边界说明）

**vim 子集**：`/vim on` 打开后，**全屏会话的输入行**支持 `dw`/`d2w`/`de`/`d$`/`cw`/`dd`/`cc`/`yy`/`x`/`D`/`C`/`p`、计数（`3x`）、motion（`h l w b e 0 $ gg G`）与文本对象（`iw aw i" a" i( a( ip`）。做不成时**不动文本**只留说明（`di"` 停在引号外就是这种）。撤销栈/寄存器/宏/`.` 重复/可视模式/`/` 搜索**不做**。

**输出风格（`/style [id]`）**：一份预设同时管两件事 —— 追加给模型的风格段 + 界面显示多少。

| 预设 | 提示词 | 界面 |
|---|---|---|
| `default` | 不加额外指令 | 各开关自己决定 |
| `concise` | 少铺垫、去客套、代码优先 | 不显示推理过程 · diff 只留 40 行 · 卡片只留摘要 |
| `explanatory` | 动手前说一句为什么，讲清取舍与坑 | 展开推理与完整卡片 |
| `strict` | 只报验证过的事实 | 不显示推理过程 |

显式按过 F4（`/thinking`）时**以用户为准**，预设让位。

**终端能力（`/term [check]`）**：能自动判的自动判 —— `COLORTERM=truecolor|24bit` 才算真彩（`TERM` 里的 256color 不算）、`NO_COLOR` 优先级最高、管道里一律 no、Windows 旧 conhost 一律 unknown（本项目在这里踩过方框字的坑）；结论分 `full`/`partial`/`limited`。

`/term check` 用**向导**问那三项自动探测答不了的（颜色对不对 / 方块字有没有 / 滚轮管不管用），答案覆盖探测结果并写进配置 —— 猜错的代价是花屏，比"功能少一点"糟得多。

**输入行**：

- **多行输入**：`Alt+Enter` 或 `Ctrl+J` 在光标处换行，`Enter` 发送。`Shift+Enter` 也接，但它要终端支持扩展键协议（Windows Terminal / Kitty 支持；旧 conhost 会把 `Shift+Enter` 当成 `Enter` 送上来）——所以主推前两个键。续行用 `… ` 对齐。
- **历史**：`↑`/`↓` 翻当前会话输入；`Ctrl+R` 反向逐条搜索（跨会话，历史写在 `~/.ace_history`）；`/history 关键词` 按**子序列**模糊检索（`dsk` 能命中 `deepseek` 那条），命中字符高亮，交互终端里选中后会填进下一次输入行——**不自动发送**。
- **`/` 菜单**：命令按「会话 / 安全 / 模型 / 工具」分组排序，说明前标组名；`/help` 按同一分组分节。

**@ 快捷方式**（输入 `@` 弹菜单）：

| 命令 | 作用 | 示例 |
|---|---|---|
| `@lang` | 切换回复语言 + 界面语言（zh/en/ja） | `@lang en` |
| `@skill` | 切换技能，描述与推荐工具注入提示词 | `@skill coding` |
| `@file` | 把文件内容加入上下文（≤4000 字符自动截断） | `@file README.md` |
| `@folder` | 把文件夹列表加入上下文（≤30 项） | `@folder tools` |
| `@refs` / `@clear` | 查看 / 清空当前引用（最多保留 3 项） | `@refs` |

可选技能：`coding`（默认推荐 `code_execute` `file_write` `terminal_exec`）· `writing` · `analysis` · `fiction` · `general`。

**扩展**：钩子、自定义命令、插件与 MCP 都写在 [`docs/EXTENDING.md`](EXTENDING.md)。
- `.ace/commands/*.md` → 斜杠命令（`$ARGUMENTS` / `$1` 代入参数；内置命令优先，不会被顶掉）
- `.ace/plugins/<名>/` → 插件：`commands/*.md` + `hooks.json`（命令带插件名前缀 `/名:cmd`）
- `hooks`（`~/.ai_code.json` 或 `.ace/hooks.json`）→ 四个事件的用户检查；**默认出错即拦截**（fail-close），要宽松显式写 `on_error: warn`
- `/hooks` 看装了哪些钩子与上次结果，`/plugins` 看插件加载情况

**改动的审阅（`/review`）**：把上一处改动写成补丁 → 在 `$ACE_EDITOR`/`$VISUAL`/`$EDITOR` 里打开 → **读回**并应用。回填走的是**同一道执行层闸门**（快照/权限/审计都在），不是绕过工具直接写盘；补丁留在 `.ace_review/*.diff` 可复查。上下文对不上就**整体不应用**并指出第几行不匹配。

**改动了什么（`/diff [序号]`）**：两级视图。不带参数只回答"动过哪些文件"——

```
◈   改动记录（3 处，最新在前）：
  [1] file_write  ace/ui/ace_markdown.py  +142 -3  (4 块)
  [2] file_write  ace/ai_code.py  +38 -12  (3 块)
```

带序号才铺该处的逐行 diff（`/diff 2`）。一次改 5 个文件时，几百行 diff 全铺出来连"改了哪些文件"都读不出来，所以分两级。记录取自带 diff 的工具返回，保留最近 20 处；`/review` 只看最新一处，`/diff` 回答"这一轮到底动过什么"。

**回答正文按 Markdown 渲染**：标题、列表、引用、分隔线、围栏代码块（画边框+语言标注，块内不做行内解析）、按显示列宽对齐的表格、行内粗斜体/代码/链接。**认不出的语法原样保留**（宁可少渲染也不猜），代码块里的 `**` 就是两个星号。渲染按**完整行**进行，所以流式输出与整篇渲染逐行一致。

**图片输入（`@image <路径>`）**：挂进下一轮请求（png/jpg/jpeg/webp/gif，单张 ≤4MB，最多 3 张）。底栏会显示 `图1` 直到发出去。**注意：图片会原样发给模型提供商**（base64 进请求体）。

**会话管理**（事实源是 `.ace_sessions/*.jsonl` 事件日志）：

- `/sessions [编号]` — 列最近会话（时间 / 轮数 / 首句 / 是否被压过），交互终端里可选中续聊；带编号直接续聊
- `/resume <编号|文件名>` — 续聊一个已有会话：消息历史按它重建，**之后的事件也写进那份日志**（不是复制）
- `/fork [编号]` — 以某会话为起点开**一段新会话**（新文件 + 带上最近 10 轮消息）
- `/rewind [轮次]` — 把**对话**退回到第 n 轮之后（默认退掉最后一轮）。**只动对话**：文件要靠 `/rollback`（快照），提示里会写明这一点

**审计与边界自证**（数据源都是 `.ace_sessions/*.jsonl` 那份 HMAC 链式台账 + `.ace/denied_cases.jsonl`）：

- `/audit boundary`（别名 receipt/evidence）— **执行边界证据链**：整链可核验状态 + 权限/安全/守卫/快照命中统计 + 实际拦截明细（"这次会话我被哪些机制约束了"）
- `/replay` — 重放被边界拦下的调用，重跑 `sensitive_target` 证明边界还在（路径类不再命中 = 边界回归；命令类如实标不可重放）

**逐项待办**（与 `todo_write` 工具共用同一份清单，人和模型看到的是同一个）：

- `/todo` 列出 · `/todo add <内容>` · `/todo start|done|remove <编号>` · `/todo clear [all]`
- 模型侧用 `todo_write`（`action` = add/start/done/remove/clear）。多步任务先列清单再动手
- 清单非空时**底栏显示 `待办 1/3`**；全部完成时变绿
- 清单存进会话事件日志（`todo/*`），`/resume` 或重启后按日志重放 —— 不会因为换会话丢

**MCP（外部进程工具）**：在 `~/.ai_code.json` 写 `mcp_servers`（或项目内 `.ace/mcp.json`），启动时按 stdio JSON-RPC 2.0 握手并把对面的工具注册成 `mcp__<server>__<工具名>`——模型可以直接调用它们，权限/审批/审计照旧。`/mcp` 看 server 状态与工具清单（`/mcp notools` 只看状态）。**MCP server 不在 HooH 的沙箱里**：它是你配置的子进程，只写你信得过的。

**在对话里打开文件**——默认只给可点击链接，不抢焦点、不弹窗：

```
（自己动手）  ❯ /open 报告.docx        # 系统默认程序打开
              ❯ /edit main.py          # 优先 VS Code
（叫 Agent）  ❯ 帮我打开桌面的报告.docx
              🔗 点击打开文件: C:\Users\...\报告.docx   ← 点一下才展开
```

## 启动参数（CLI flags，非聊天斜杠命令）

完整清单以 `python ai_code.py --help` 为准；常用：

- `--preview [--preview-width N]` — 只画一遍首屏（面板 + 分组菜单 + 状态栏示例）然后退出。不开交互终端也能看界面长什么样，`demo/record_demo.py --session landing` 就是用它出的图
- `--json` — **机器可读事件流**：stdout 一行一个 JSON 对象（`session_start` / `user_message` / `model_request` / `tool_call` / `tool_result` / `permission_request` / `notice` / `final` / `session_end`），无 ANSI、无进度条；人看的输出会变成 `notice` 事件。契约见 [INTERFACES.md](INTERFACES.md#91-headless-事件流契约ace---json)。例：`ace --json --input "现在几点" | jq -c 'select(.type=="final")'`

- `--tools` — 原生工具调用（OpenAI 兼容 function calling，不支持时自动降级到文本协议）
- `--max-history N` — 只保留最近 N 轮，防本地小模型上下文溢出
- `--context-window N` — 告诉 HooH 模型窗口有多大（默认 32768），压缩阈值按它算
- `--no-compact` — 关掉上下文压缩，退回纯硬截断（会丢早期对话）
- `--install-ui` / `--setup` — 准备运行环境：装 `requests`（模型调用必需）+ `prompt_toolkit`（普通 REPL 的输入行），多镜像自动回退
- `--engine` / `--no-engine` — 引擎界面（主屏两车道：转录进终端原生 scrollback，状态行/输入行走帧缓冲增量重画、问答内联）。**真终端下默认就是它**；`--no-engine` 回退普通 REPL。见 [`docs/TUI-ENGINE.md`](TUI-ENGINE.md)
- `/tools [关键词]` — **列出全部工具**（按只读/可写/高危分档，标出当前权限看不看得见、哪些被折叠）。工具面会按权限档裁剪，这条命令是唯一能一眼看全的地方
- `/key` — **一步改 API 密钥**（输入不回显、不进转录区）。`/config` 是"提供商→密钥→模型"三步向导，`/provider <n>` 只换端点不问密钥——想单独换
- `/window` — **看/改上下文窗口**。**每个模型的窗口都不一样，而"不知道"是常态**：引擎表里只放**核过出处**的条目（DeepSeek 1M / GLM-4.6 200K），表外的模型一律按兜底 **32768** 算并**明确提示**（"不知道"不等于"窗口小"，猜大了会直接发超被接口拒）。所以给你一条命令：`/window 1m` 设成 1M（支持 `200k` 这种写法）、`/window auto` 交还自动判断、裸 `/window` 显示当前值与**来源**（你设的 / 已知表 / 未知兜底）。设完写进 `~/.ai_code.json` 的 `context_window`。**额度看得见才有意义**：底栏那个百分比就是拿这个当分母的。密钥就用这条
- **裸敲就弹选择器**：`/lang` `/effort` `/style` `/sandbox` `/todo`（另有 `/permission` `/net` `/provider` `/model` `/preset`）——打命令本身就把取值摆成选择框，与选服务商同一套交互，不必自己打参数。裸形态是**动作**的命令（`/vim` `/mock` `/thinking` `/stash` 裸敲是翻转/存一次）不在此列，否则动作会被做两遍
- `--install-executor` — 下载官方预编译执行器（无需本机 Go；`--sandbox job` 前置）
- `--sandbox job` — Windows Job Object：进程树/内存上限 + 受限令牌（拿不到边界一律 503，不静默回退）
- `--sandbox docker` — 一次性容器：--network none + --read-only + cap-drop ALL + --init + 只挂工作目录。镜像**缺失时自动拉官方预编译镜像**（`ghcr.io/ace-code-engine/hooh-sandbox`，公开可匿名拉，无需 `docker login`；本地已有的镜像永远优先）；不想自动拉就 `ACE_SANDBOX_PULL=0` 并自己 `docker build -t ace-sandbox:latest -f docker/Dockerfile.sandbox .`，`--sandbox-image <ref>@sha256:<digest>` 可固定摘要
- `--approval-policy <档>` — 审批策略（与沙箱正交）：`on_request`（默认，需审批时问人）/ `on_failure`（有 job/docker 边界时先试后问；无边界时退回 on_request）/ `never`（从不问人，需审批的一律拒绝）/ `untrusted`（除白名单外都问）。**无人值守请组合 `--sandbox job|docker` + `on_failure`**
- `--kb <目录>` — 外挂知识库（不指定则用项目 `.ace_kb/`）
- `--input "<话>"` — 单次对话，跑完即退

本地 Ollama（Qwen 支持原生工具调用）：

```bash
python agent_runner.py --base-url http://localhost:11434/v1 --api-key ollama \
       --model qwen2.5-coder:7b --tools
```

容器编排：根目录 `docker compose up`（HooH + Ollama）；`docker/` 下另有 lite / standard / full 三档镜像与模型下载脚本，见 [../docker/README-Docker.md](../docker/README-Docker.md)。

