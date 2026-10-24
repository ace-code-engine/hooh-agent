# 配置（Configuration）

> 本文档由 README「配置」一节拆分而来（docs/design/README-RESTRUCTURE.md，v3.7），内容与当时 README 保持一致。
> 配置优先级见 [SECURITY-MODEL.md](security/SECURITY-MODEL.md) 顶部（命令行参数 > `~/.ai_code.json` > `~/.claude/settings.json` > 环境变量）。
> **下面的键写进 `~/.ai_code.json` 即生效**（CLI 会原样透传给执行层）；`python ai_code.py --save-config` 可把当前命令行参数落盘。
> v3.8 修正：`signing_key` / `max_snapshots` / `confine_files` / `email_smtp` / `egress_allowlist` / `session_id` 此前**只在程序化构造 `ExecutionLayer` 时生效**，写进配置文件会被静静忽略——配置写了不生效比没这个键更坏（用户以为闸门开着），现已修复并有 test_all 断言盯着。

```python
config = {
    "flywheel_path": ".../violations.jsonl",   # L5 飞轮落盘路径
    "sandbox_base": "...",                     # code_execute 沙箱临时目录（默认系统临时区）
    "sandbox": {"mode": "off",                 # 执行位置：off / job / docker（--sandbox 同义）
                "code_execute_host": False},   # H-30：没有真边界时是否允许 code_execute 退回宿主（默认 false）
    "confine_files": True,                     # 文件工具限制在项目目录内（含跨盘符检查）
    "signing_key": "你的签名密钥",              # Guardian 快照 HMAC 签名（生产建议；不配则自动生成一把）
    "mandate": {"mandateId": "md_...", ...},    # 授权令（RG-05）：一次任务一张，收拢逐次弹窗；不配 = 行为与以前相同
    "max_snapshots": 20,                       # 快照硬上限，自动清理最旧
    "snapshot_verify": "create",               # 快照完整性校验的时机：create（默认）/ rollback
    "session_id": "会话标识",                   # archive 记忆按会话隔离
    "bait": {"enabled": True, "frequency": 0}, # 诱饵验证（0 = 每任务一次）
    "guard": {"rules": {"no_hardcoded_secrets": False}},  # 关闭某条守门规则
    "email_smtp": {"host": "smtp.qq.com", "port": 587,
                   "user": "you@qq.com", "password": "授权码",
                   "use_tls": True},           # notify_send email 渠道（缺省时返回 501）
    "egress_allowlist": ["api.github.com", ".openai.com"],  # 出站目的地白名单（缺省 = 闸门关闭）
    "approval_policy": "on_request",       # 审批策略：on_request（默认）/ on_failure / never / untrusted
    "sandbox_policy": "workspace_write",   # 判定用沙箱策略：read_only / workspace_write / danger_full_access
    "steering_mode": "queue",              # 繁忙时「纠偏」消息策略：queue（默认）/ interrupt（先触发第一段中断再入队）
    "followup_mode": "queue",              # 繁忙时「追加」消息策略：queue（默认）/ drop（如实拒绝，不排队）
    "auto_commit": False,                  # WP-2：aider 式自动提交（成功写操作后自动 git commit；默认关 = 行为与现在逐字一致）
    "mcp_servers": {                        # MCP server（外部进程工具，v3.17.0 起）
        "fs": {"command": "npx",
               "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
               "enabled": True,             # 可选：false = 只登记不启动
               "timeout": 20,               # 可选：握手/列工具超时（秒）
               "call_timeout": 120},        # 可选：单次工具调用超时（秒）
    },
    "prefix_cache": True,                   # WP-3：每请求前校验不可变前缀的 SHA-256 指纹（默认开）
    "tool_surface_budget": 0,               # WP-3：工具常驻上限；0 = 全量常驻（与改动前逐字相同）
    "color": "auto",                        # 配色（同 --color）：色板名 / "auto" / "accent=#RRGGBB,..."（见下）
}
```

### 配色（`color`，同 `--color`）

```json
"color": "mist-dark"                        // 选色板
"color": "auto"                             // 跟随终端背景 → mist-light / mist-dark
"color": "accent=#FF9EC7,warn=#E0C08A"      // 在当前色板上局部覆盖
"color": "sakura"                           // ~/.ace/themes/sakura.json（自定义主题）
```

- 内置色板：`dark` / `light`（**默认**，值未变）/ `mist-dark` / `mist-light` / `mist-ansi`
  （后三个是移植自 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 的「雾蓝」家族）。
- 优先级：`--color` > `color` > 环境变量 `ACE_THEME` > `COLORFGBG` 推断 > `dark`。
  **缺省不换色** —— 不写这个键就还是原来的 dark/light。
- 自定义主题放 `~/.ace/themes/<name>.json`：`{"base": "mist-dark", "colors": {"accent": "#FF9EC7"}}`。
  未知键与坏值逐键跳过，坏 JSON 只废掉那一个文件，不挡启动。
- `--color` 的值会同时转交 Ink 前端与 Python 引擎（`ace.cmd` 把参数同时给两边），
  保证一屏之内只有一套色。完整语义见 [`docs/design/DSH-TUI-PORT.md`](design/DSH-TUI-PORT.md)。

### 快照校验时机（`snapshot_verify`）

```json
"snapshot_verify": "create"   // create（默认，建完即校验）/ rollback（只在 /undo 恢复时校验）
```

写前快照的完整性校验（逐文件读回比对 sha256）是**单次快照成本的 92%**，而它**不是 CPU**。
实测（347 文件 / 11.7 MB 夹具，对齐真实仓库）：`create` 中位 **1958 ms**，换 `rollback` 中位
**162 ms**（12×）。拆开看，贵的是**刚复制出来的那些文件的首次读取**：

- 单线程冷读校准：**24.4 ms/文件**（8458 ms）；紧接着对**同一份快照**再验一遍只要
  **0.07 ms/文件**（24 ms）—— **348×** 落差，字节完全相同，差的只是"第一次读盘"。
- 哈希本身几乎不要钱：347 文件 / 11.7 MB 全部**热读**算 sha256 只要 **34 ms**，比那条冷读
  便宜约 50×；单个 12 MB 大文件 SHA256 有 788 MB/s。所以这不是"哈希慢"。
- 并行读回：1 / 2 / 4 / 8 线程 → **8646 / 4850 / 2646 / 1929 ms**；但 12 / 16 / 24 / 32 / 48
  线程是 **2215 / 2392 / 2604 / 2635 / 2504 ms，全都比 8 线程慢**。默认 `min(8, CPU)` 就是
  实测最优点，`ACE_HASH_WORKERS` 只用于对照与排障，**不要再往上调**。（以上全部在本机
  Windows 上测得；"首次读盘"这一项的代价与最优线程数在 Linux/macOS 上**未测**，别把它当成
  跨平台结论 —— 真要调，先在自己平台上按同一夹具重跑一遍。）

- `create`（**默认**）：坏的快照被挡在**写操作之前**（H-02/H-05 的早失败保证）。
- `rollback`：同一遍校验挪到 `/undo` 那一刻。**校验一步都没少**，只是从"每次写"变成
  "每次恢复"；坏快照仍然**永远不会被静默恢复** —— `rollback()` 第一步就是完整性预检，
  失败即抛 `SnapshotError`。代价是暴露更晚：你会在想撤销时才发现那个快照用不了。
- 未知取值退回 `create`（并打印告警），不会静默变成 `rollback`。
- **默认保持 `create`**（产品决定与全部实测见 `docs/BACKLOG.md` 的 Q-16）：快照是**每个写工具
  调用**都建一次，所以这个默认就是"每次写多花约 1.8 s（347 文件规模）换坏快照早暴露"。
  上面那组数字表明这 1.8 s **降不下来**（读回不可省、哈希不要钱、并发已到顶），所以它是个
  明码标价的取舍，而不是一个待修的慢点；不接受就显式改这一行。

### aider 式自动提交与 `/undo` 的统一（`auto_commit`，WP-2）

```json
"auto_commit": false   // 默认关：行为与现在逐字一致
```

`auto_commit: true` 时，每次**成功的写操作**（`file_write` / `str_replace` / `terminal_exec` 等，
**不含** git 写类工具 `git_commit_plan` / `git_fetch` / `git_merge_tree` —— 它们自己管 git）之后，
自动执行一次 `git add -A && git commit`，提交信息形如 `ace: auto-commit file_write tools/registry.py`。
这是 aider 式的**增量提交**：每次提交只含那次写操作造成的变更。

**不是第二套回滚**（ROADMAP §8 R-2 的"两套回滚"是灾难，这里刻意绕开）：`/undo` 依旧走既有的
快照回滚路（`guardian.rollback`，**文件内容由快照还原，这是唯一来源**），只额外做一件 git 侧
记账 —— 若最近那次快照对应的写入已被 auto-commit，把分支指针 `git reset --mixed` 回写前提交：

| 侧 | 由谁还原 |
|---|---|
| 文件内容 | guardian 快照回滚（既有路径，唯一来源，`/undo` 从来都走它） |
| git 分支指针 | 伴随 `git reset --mixed`（只在确实有 auto-commit 时，且不改工作区） |

边界（**如实声明，不静默降级**，HL-03②）：

- 当前目录不是 git 仓库 / 找不到 git：`auto_commit` 开启时**会话内声明一次**，之后不再刷屏；
  写操作仍受快照保护，`/undo` 照常可用。
- 工作区没有变更：如实不提交（无事可做，不是降级，也不打印）。
- `HEAD` 已不是那条 auto-commit（中间有用户自己的提交）：`/undo` 只回滚快照，
  git 侧不动并如实说明。
- 快照→提交的配对台账只在**会话内**：`/undo` 只撤销**本次会话**的 auto-commit；
  `/rollback <id>` 与跨会话回滚**不碰 git**。
- git 提交失败（如 `user.name`/`email` 未配置）：如实打印 git 的报错，写操作仍受快照保护。

### 签名锚：密钥存在哪（RG-01）

快照的 HMAC 密钥是这套回滚安全网的**信任锚**，它存在**工作区之外**：

- Windows：`%LOCALAPPDATA%\ace-agent\state\<项目绝对路径的哈希>\signing_key`；
  POSIX：`$XDG_STATE_HOME/ace-agent/state/<哈希>/signing_key`（缺省回落到 `~/.local/state`）。
- 根目录可用构造参数 `anchor_dir` 或环境变量 **`ACE_ANCHOR_DIR`** 换掉（测试、冻结包、
  受限环境都靠它注入 —— 取不到可写位置时 **`snapshot()` 直接拒绝**，写操作会被拒，
  不会悄悄退回"未签名快照"）。
- **升级迁移**：老项目里那份 `<项目>/.guardian/signing_key` 会在第一次启动时**搬**到锚里
  （先写锚、读回校验，再把项目内那份删掉），旧快照因为密钥值没变照旧验得过。只拷不删是错的 ——
  同一把密钥留在 agent 够得着的地方，锚就白搬了。
- **为什么必须出去**（实测）：密钥在项目内时，拿到项目目录读写权限的一方可以读出密钥、
  改快照副本、修 `meta.json` 里的摘要、用同一把密钥重算 HMAC，`verify_snapshot()` 照样返回
  `True` —— 安全网可被伪造。放到工作区外之后同样的操作拿不到密钥。细节与验收见
  `docs/design/RGTC-LANDING.md` 的 RG-01。
- 配置 `signing_key` 仍然可以显式指定一把（它优先于锚）；**显式配空字符串**会在启动时告警 ——
  那是"关掉签名"，此时篡改只能靠摘要比对发现。
- **体检**：`python -m cli.ace_doctor` 会报锚路径、已有哪些密钥、锚根来源（默认还是
  `ACE_ANCHOR_DIR`）、锚是否误落在工作区内、项目内是否还残留旧密钥副本、以及 POSIX 下密钥
  文件权限。锚是硬依赖：不可写时写操作 fail-close，所以出问题先看这一行。
- **会话台账另有一把**（`<锚>/sessionlog_key`，与快照密钥域分离）：每条事件带
  `mac = HMAC(台账密钥, 上一条的 mac ‖ 该条正文)`，`/audit stats` 会打一行整链校验。
  三态必须分清：`ok`（链完整）/ `broken`（改过、删过、插过、或某条的 mac 被剥掉）/
  `unverifiable`（老日志没有 mac，或拿不到密钥）。**台账密钥不可用时不 fail-close**：
  照样记录、打一次告警、校验如实报"不可核验" —— 台账是记录不是闸门，因为写不了签名就让
  整轮对话挂掉换不来任何安全收益（细节与实测见 `docs/design/RGTC-LANDING.md` RG-02）。

### 授权令（`mandate`，RG-05）

```bash
python -m cli.ace_mandate issue --intents file_write,file_delete --roots . \
    --floor snapshot --quota 1 --allow-irreversible terminal_exec --ttl 3600 --out mandate.json
python -m cli.ace_mandate show --file mandate.json      # 检查签名/有效期/额度
```

把 `issue` 打出来的那个对象贴进配置的 `"mandate"` 键即生效。**不配这个键 = 行为与以前逐字相同。**

- **它换来什么**：一次任务签一张令，之后"项目外已存在对象的确认"与 `edit_file` / `terminal_exec`
  的逐次确认**不再逐次弹窗**（弹窗从 O(危险步数) 变成 O(任务数)）。
- **它管不了什么**（刻意）：硬拒绝（持久规则 deny / 未注册 MCP / 敏感目标）依旧拒；
  **外发确认**（egress）是"目的地"轴，令管的是"对象"，不覆盖；**权限等级**也不提权
  （与 `/rules` 的 allow 同一先例）。
- **痕迹不可枚举的工具**（`terminal_exec` / `code_execute`）必须写进 `--allow-irreversible` 点名，
  且每用一次消耗一个 `--quota` 额度 —— "说不清动了什么"不等于"安全"。
- **令坏了怎么办**：签名不符 / 过期 / 被改过 → **不说放行**，回落成照旧逐次确认，并告警一次。
- 签名密钥从**信任锚**派生（与快照签名、台账签名域分离）；`ace doctor` 会报锚的状态。

### 界面与成本（`vim_mode` / `keybindings` / `pricing`）


```json
"vim_mode": false,                          // vi 编辑模式（也可 /vim on|off 热切换）
"keybindings": {"c-e": "/expand", "f5": "/todo"},   // 键 → 斜杠命令；保留键(enter/esc/Ctrl+C)不许覆盖
"pricing": {"deepseek-v4-flash": {"in": 0.28, "out": 0.42}}  // 美元/百万 token，覆盖内置快照
```

- `keybindings` 的值必须是斜杠命令（自定键位是为了少打字走常用命令，不是开一个新的脚本执行面 —— 那是 hooks 的活）。
- `pricing` 的键按**子串**匹配、最长优先；`in`/`out` 单位是**美元每百万 token**。
- **成本是估算，不是账单**：token 数按字符估（中文按字），价格表是本地快照（`core/ace_cost.PRICING_SNAPSHOT`）。查不到价格时 `/status` 显示"价格未知"，**不编数字**。
- `/status` 另有一行**跨会话累计**（最近 10 段 + 本次）：轮次 · 工具（失败数）· token 入/出 · 成本估算。数据来自会话事件日志里新增的 `model/usage` 事件（每轮 token **增量**）与 `tool/result` 的 `elapsed_ms`——这两样此前只活在内存里，所以"我在这台机器上花了多少"根本答不出来。老日志没有这两个字段，那两栏会如实显示 0。
- **Rust 元处理引擎是可选加速器，不是开关**：`core/ace_engine` 按 `ACE_ENGINE`（显式路径）→ 源码树 `engine/target/release|debug` → `PATH` 的顺序找 `ace-engine`，找不到就用纯 Python 同口径实现（字段集逐字段对齐，输出一致、只是部分命令略慢；跨会话聚合在**多个小日志**上纯 Python 反而更快）。没有配置项可以开或关它，**冻结版一律不带**——理由与实测见 `docs/PACKAGING-EXE.md`。

### 事件钩子（`hooks`）

```json
"hooks": {
  "pre_tool": ["python .ace/hooks/no_migrations.py"],
  "post_tool": [{"command": "python .ace/hooks/audit.py", "timeout": 5, "on_error": "warn"}],
  "user_prompt": ["python .ace/hooks/add_context.py"]
}
```

- 四个事件：`session_start` / `user_prompt` / `pre_tool` / `post_tool` / `session_end`
- 钩子从 **stdin** 读 JSON、从 **stdout** 回 `{"decision":"allow|block","reason":"…","additional_context":"…"}`；**退出码 2 = 拦截**
- 项目内 `.ace/hooks.json` 与插件 `hooks.json` **追加**生效（同名不覆盖）
- **`on_error` 默认 `block`（fail-close）**：钩子崩了/超时了不算"检查通过"；要宽松显式写 `warn`
- 命令的 `cwd` 是项目根；`/hooks` 看装了哪些、上次结果如何
- 完整协议与边界见 [EXTENDING.md](EXTENDING.md)

### MCP server（`mcp_servers`）

- **协议**：stdio 上的 JSON-RPC 2.0（一行一个消息），实现 `initialize` 握手、`tools/list`、`tools/call`。HTTP/SSE 传输**没有实现**。
- **工具怎么进来**：每个外部工具注册成 `mcp__<server>__<工具名>`，schema 原样透传；模型看到的工具列表里就能直接调用它们。
- **权限怎么算**：对面声明 `annotations.readOnlyHint: true` 才算只读，**其余一律按写**（readonly 会话下需要授权）。默认从严：对面说只读是它自己声明的，说错话的代价不该由用户承担。
- **项目级配置**：项目根下 `.ace/mcp.json`（`{"mcpServers": {...}}` 或直接 `{名字: {...}}`），同名时**项目级覆盖用户级**。
- **起不来怎么办**：单个 server 启动失败不影响会话，状态与失败原因在 `/mcp` 里如实展示；调用它的工具会得到 `503` + "未注册" 说明（**不会**变成"要不要临时授权"——那会让人以为点一下就能用）。

### 审批策略与沙箱策略（两个正交维度）

`approval_policy` 回答"要不要问人"，`sandbox_policy` 回答"允许它碰什么"；两者与权限档（`permission`）正交，共三个维度。CLI 入口是 `--approval-policy`（`ai_code.py` 与 `agent_runner.py` 都有），写进 `~/.ai_code.json` 同样生效（v3.8.1 起透传，此前只在程序化构造 `ExecutionLayer` 时被读取）。

| 档位 | 语义 |
|---|---|
| `on_request`（默认） | 判定为"需审批"时问人 |
| `on_failure` | **有真实边界**（`--sandbox job/docker`）时"先试后问"：交给边界执行，沙箱拦下才升级给人；**没有边界时退回 `on_request`**（仍要人点头，不会因为写了 on_failure 就免问） |
| `never` | 从不问人：判定为需审批的一律**拒绝**（不是放行）。**必须配真边界**：`never` + `sandbox=off`（或 `sandbox_policy=danger_full_access`）会**拒绝启动**（退出码 2 / 库调用方抛 `PolicyRefused`）——它挡不住不需要审批的工具，所以"没人 + 没边界"没有可辩护的用途 |
| `untrusted` | 除白名单外一律问 |

无人值守（CI / 管道 / 无 tty）请**显式**组合 `--sandbox job|docker` + `approval_policy: on_failure`。默认档下需要审批的动作在非交互里会被直接拒绝（`terminal_exec` 在 CI 里不可用），而无需审批的写工具照跑——见 [`SECURITY-MODEL.md`](security/SECURITY-MODEL.md) 的「无人值守 / 自动化部署」；启动时也会对"非交互 + `off` 档 + 非只读"这个组合主动打提示。
**`code_execute` 例外（H-30）**：它不再属于"无需审批就照跑"的那一类 —— 见下一节。

### 无边界时的 `code_execute`（`sandbox.code_execute_host`，H-30）

`code_execute` 有三条可能落到宿主进程内执行的路，改动前后各一条：

| 边界来源 | 有没有边界 | 行为 |
|---|---|---|
| `--sandbox docker` 且 daemon 可用 | 有 | 一次性容器里跑（内核约束） |
| Go 执行器（`ace --install-executor` 或 `executor/` 下自编译） | 有 | Job Object 里跑（Tier-1） |
| 两者都没有 | **没有** | H-30 起：**503 拒绝**，不再静默退回宿主 |

为什么默认拒：宿主执行时唯一的闸门是 `tools/code_tools.py` 里的 AST 黑名单，而那份名单
自己写着"**枚举不可能闭合**"（实测 `io.open(...)` 的读写都放行，而同价的 `open` / `os` /
`pathlib` 被拦）；`code_execute` 又是 `PERM_WRITE` 且**不在** `CONFIRM_TOOLS`（不逐次问人）。
两者相乘就是"没有边界、也没有人"的任意 Python —— 与 job 档拿不到执行器就 503、冻结发行
（PyInstaller）直接 501 是同一条立场。

要显式接受无边界（例如本机就是不想装 docker / Go）：

```json
"sandbox": {"code_execute_host": true}
```

配了它之后行为与改动前逐字相同（宿主 `subprocess.run` + 最小环境变量 + 30 s 超时）。
`terminal_exec` 不受这条影响：它一直是"黑名单拦不住 ⇒ 人就是边界"，每次都问。

### 出站白名单（`egress_allowlist`）

内网判定（`ace_net`）管的是"别打到内网去"，白名单管的是"能把数据带到哪个公网站点去"。后者只有宿主知道哪些站点算正当，所以**默认关闭**：不配这个键，`api_get` / `api_post` / `browser_open` / `web_search` 的行为和以前完全一样。

但"默认关闭"不等于"默认没人管"：**没配清单时，外发工具只要目的地不在内置端点里，就会逐次弹确认**（v3.8 起，见 [SECURITY-MODEL.md](security/SECURITY-MODEL.md) 的「外发闸门」）。清单是给"别再问我了"用的——写好之后清单内直接放行，清单外一律 403。

配上之后：

- **是并集，不是覆盖**：配置的条目会自动并上内置端点（搜索引擎等）。否则配置白名单的第一个可见后果就是搜索坏掉，而用户会把这读成"功能有 bug"，删掉清单——闸门也就没了。
- **逐跳复检**：清单内主机完全可以 `302` 到 `evil.tld`，而第一跳的判定是对的。所以每一跳都重新过清单，中途跳出清单直接掐断连接。
- **403 而不是 400/500**：这是授权问题。同一个地址重试不会变，只有人能把域名加进清单。返回消息里就这么写给模型看，免得它反复重试或改写 URL 试探。
- `browser_open` 也过清单。连接交给系统浏览器之后就不经过本进程（拦不住浏览器自己跟的重定向），但"要不要把这个域名交出去"这个决定本进程还能做。
- 条目写法宽松：`api.github.com`、`.github.com`（含子域）、`https://api.github.com/x`（只取主机）都认。匹配按标签边界，`evil-github.com` 不会命中 `github.com`。
- **`notify_send` 的 SMTP 也归它管**：那条路直连 `smtplib`，主机来自宿主配置而非模型参数（所以不是 SSRF 面），但正文和收件人是模型给的 —— 是实打实的外发通道，所以走同一份清单。

### 前缀稳定性与工具面伸缩（`prefix_cache` / `tool_surface_budget`，WP-3）

系统提示词此前**每轮重新拼串**，而 49 个暴露工具的描述**全部常驻**在每次请求里：前者让
上游前缀缓存（按前缀命中）随时可能白建，后者按工具数线性啃前缀。这两件事的代码面在
`core/ace_prefix.py`（纯逻辑，可单测），配置面就是下面两个键。

```json
"prefix_cache": true,          // 默认 true：每请求前校验不可变前缀的 SHA-256 指纹
"tool_surface_budget": 0       // 默认 0 = 不折叠（与改动前逐字相同）；>0 = 常驻上限
```

**不可变前缀 = system + 工具 schema + scope**，指纹是这三者的 SHA-256。三个刻意的口径：

- **比解析后的 `parameters`，不比工具容器**。工具 schema 里的 `parameters` 可能是活体
  getter（property / 无参函数 / 每次算一份新 schema 的对象）：容器身份一直没变，内容却
  每轮都不同。按容器比会得到一个"永远稳定"的假指纹，而上游收到的是另一份 schema。
- **scope 也是指纹的一部分**（`model|base_url|permission|tools_ok|tool_surface_budget`）。
  前缀缓存按模型分桶：同样一份字节换个模型就是另一个缓存条目，`/model` 必须换桶。
- **drift 不更新基线**。没人声明的变化只**如实上报**（stderr 一次 + 台账一条），原 pin
  保留 —— 顺手采纳等于把漂移洗成基线，下一次就再也查不出是哪一步漂的。

**变化强制归因**：`/model`、`/provider`、api-key、`/permission`（模式轴）、`/effort`、
关键词逃生门、`/lang`、`/net`、技能切换、`@file`/`@folder`/`@session`、goal 的
resume/pause/complete、MCP 重 pin、`tool_search` 激活，都会先声明理由；空理由在
`ace_prefix` 里当场被拒（`ValueError`）。归因落两条：

| 事件 | 内容 |
|---|---|
| `model/switch` | 模型 / 端点 / 密钥切换：`model`、`base_url`、`reason`、`detail`（值不回显） |
| `guard/verdict`（`rule=prefix_stability`）| 全部前缀事件：`action` ∈ `pin`/`repin`/`attribution`/`drift`/`declare_noop`，`detail` 带 `field=`/`reason=`/`changed=` |

**恒等快路径**：指纹不变时**跳过 snapshot + stringify** —— 具体就是不再往台账重写一遍
system 原文（`system/snapshot` 每次请求几十 KB），并复用上一次那份快照。台账里的
`request/snapshot` 照记（省的是前缀快照，不是审计）。效果可直接数事件：
同一轮内重复构建前缀 → 2 条 `request/snapshot`、1 条 `system/snapshot`。

**工具面伸缩**（`tool_surface_budget > 0` 时生效）：

- 常驻数**不超过**预算，`tool_search` 自己占一个名额（它不被看见，折叠的工具就永远找不回来）；
- 超出的工具进**延迟目录**；模型用常驻的 `tool_search` 按关键词检索，命中项**下一轮**成为
  常驻（sticky：已经要过一次的工具不再折回去）；
- **只有真的折了东西才注入 `tool_search`** —— 预算装得下就全量常驻，不摆一个空目录；
- `budget <= 0` = 与改动前逐字相同（全量常驻、不注入 `tool_search`）。

边界（如实写在这里，免得当成已实现）：

- **`tool_search` 没有进 `tools/registry.py`**，它是工具面自己的一等工具，调用在执行层**分发
  之前**被截住（`ai_code.converse`）—— 所以它不会以"未知工具 400"的形式落到模型面前。
  它也不出现在提示词的工具清单里（清单与注册表的一致性由 test_all 守着）。
- **`retrieve_tool_result` 只落了接口**（`ace_prefix.ResultStash` + schema），**没有接线**：
  跨轮留存被折叠的工具结果需要一条上限与过期策略，并与现有 `/expand` 折叠路径统一，
  那是另一件事。在接线之前把它塞进清单，等于承诺一个调用就 400 的工具。
- **goal 不进不可变前缀**：目标正文进的是**用户消息**（目标续跑那一段），所以 `/goal` 的
  变化被记为 `attribution` + 下一次 `declare_noop`（声明了、但前缀确实没变）——这是诚实的
  结果，不是漏记。
- **MCP / 插件工具现在真的进请求清单了**：工具面改为**现算**（`registry.openai_tools()`），
  不再用 `agent_runner.TOOLS` 的导入期快照 —— 后者让运行时注册的工具永远进不了清单，
  与本文档 MCP 一节的承诺不符。
- `prefix_cache: false` 只关掉指纹校验与归因（排障用），**不改**请求里的 system/工具清单。

### 检索工具的边界（`grep` / `glob`）

两者属于 `READ_TOOLS`，`readonly` 会话就能调，所以约束不能只管起点：

- `glob` 的 `pattern` 里出现 `..` 直接 **403**，不是"复检后静静丢掉"。丢掉的话模型看到的是"没匹配"，它会换个写法再试。
- 每条命中都在**解析软链接之后**重新确认落点。项目里一个指向 `~/.ssh/id_rsa` 的软链接，`os.walk` 会当普通文件产出。
- 命中还要过 `sensitive_target`：项目内也可能躺着误提交的 `.pem`。
- 遍历文件数撞上限（5000）时回报 `scan_incomplete: true`，与"结果太多"分开报。否则模型会把"没扫完"读成"这个符号不存在"。
- 模型给的正则只在行首 4000 字符上跑。Python 的 `re` 没有超时，灾难性回溯会挂死整个工具调用；限住输入长度不能消除回溯，但能把上界从"行有多长"压到常数。

### `str_replace` 不做有损重编码

读-改-写路径用严格解码（UTF-8 → 系统编码，都失败就 **400 拒绝改写**），并按读进来的那个编码写回。此前是 `errors="ignore"` 解码 + 硬写 UTF-8：一个 GBK 源文件会被静默转码，解码时丢掉的字节永久消失，而模型只看到"替换成功"。

### `db_query` 的只读靠连接，不靠正则

`db_query` 用 `?mode=ro` 的 URI 连接，写入由 SQLite 自己拒绝。SQL 是完整语言，`CREATE TRIGGER`、`INSERT ... SELECT`、CTE 包一层写入、`pragma_table_list` 这类表值函数（`\bpragma\b` 对 `pragma_` 不成立）—— 前缀匹配挡不住的写法列不完。

`db_write` 天生要写，拿不到连接级保护，所以那边仍是黑名单，并且**不闭合**：`DELETE FROM t`（无 WHERE）、`REPLACE INTO`、`CREATE TABLE x AS SELECT` 都在放行范围内。真正的边界是权限档位与 Guardian 快照。两条路都拒绝多语句（分号），因为驱动拒绝多语句时抛的是 `sqlite3.Warning`，它**不是** `sqlite3.Error` 的子类，会一路冒成 500。
