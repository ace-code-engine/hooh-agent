# 待办事项(BACKLOG)

> 由 2026-09-05 四视角体检(安全复核 / 架构 / 测试与 CI / 文档产品化)+ 实测复现整理。
> 约定:编号 `SEC-`(安全)、`Q-`(快速赢项/质量)、`R-`(结构重构)、`REL-`(发布)。
> 已完成项进 `CHANGELOG.md`;领取后在此勾选。工作量:S/M/L;来源列 = 审查视角。

## P0 — 安全(全部经真实复现验证,建议最先做)

| ID | 事项 | 证据/说明 | 建议 | 工作量 |
|---|---|---|---|---|
| ✅ SEC-01 | **code_execute 沙箱可绕过 → RCE/任意写** | `code_tools.py:80-91` 只拦 Call.func 精确名;实测 `f=open;f(..)('a','w')`、`(lambda:open)()(...)` 成功落盘、`(lambda:exec)()('print(1)')` 成功执行 | Name/引用级白名单或去 builtins;叠 Go 执行器/job 边界;补 6 条回归测试 | M |
| ✅ SEC-02 | **parse_document 只读越界读** | `parse_tools.py:22-29` 不过 confine/sensitive;readonly 下读项目外 README/execution_layer.py 实测 SUCCESS(file_read 同路径 403) | 与 file_read 同口径路径判定+敏感目标+回归测试 | S |
| ✅ SEC-03 | **默认权限矛盾 + 外发零确认** | 已闭合(v3.8)：前半——`agent_runner.py:668` / `execution_layer.py:1344` / `ai_code.py:656` 三入口默认均为 `readonly`；后半——注册表新增 `ToolSpec.egress`（`api_get`/`api_post`/`browser_open`/`browser_navigate`/`notify_send`），执行层在目的地不在内置清单也不在用户 `egress_allowlist` 时**逐次弹确认**，并拒绝会话级授权（授权按工具名给 = 出口全开，要免问请用白名单指定域名）；`notify_send` 按渠道判（console/file/toast 不问，email 每次问）。测试覆盖 8 条（未配清单要问 / 内置端点不问 / 白名单内不问 / 白名单外仍问 / 已批准不重复问 / 会话级降级 / email 要问 / console 不问） | S-M |
| ✅ SEC-04 | 快照 HMAC 默认关 + 敏感文件明文入 `.guardian` | `core/guardian.py:142/60`;signing_key 不配即无签名;.env/.pem 无排除 | 默认生成项目外密钥;敏感文件只记哈希;补测试 | M |
| ✅ SEC-05 | `browser_screenshot` 属只读且无确认 | `registry.py:117-119` | 归 WRITE + 逐次确认 | S |
| ✅ SEC-06 | execpolicy allow 档小洞 | `core/ace_execpolicy.py:314` 跳过 `-` 开头 token 可越区;`git config` 被当只读可 `--global` 写 | 选项值含路径不跳过;config 限 `--get/--list` | S |

## P1 — 快速赢项(低风险,按序做)

| ID | 事项 | 说明 | 工作量 |
|---|---|---|---|
| ✅ Q-01 | ruff 扩选 F401/F841/E711/F811 | 实测 F401=42 死导入全可 autofix(execution_layer.py:27-31 os/ast/html) | S |
| ✅ Q-02 | bench 功能 check 失败应 exit≠0;`benchmarks/results/` 入 .gitignore | 现在退出码恒 0、结果入库致本机跑即脏树 | S |
| ✅ Q-03 | test_all 环境敏感自识别(SKIPPED 通道 + `--strict`) | Go Job Object 附加失败/缺 requests/禁联网/系统 temp 只读应跳过并如实标注,不许假绿/整脚本 traceback;9 处裸 mkdtemp 统一走 `.test_tmp` | M |
| ✅ Q-04 | 文档/CI 手抄数字单一来源 | 已完成(v3.8)：README 里的提供商家数（原写 10 家）改为"9 家厂商 · 10 入口"；CHANGELOG 头部去掉写死的断言总数（改为"以 test_all 输出为准"）；`test_all.py` 新增 `[39]` 节自动校验——文档中"家厂商 · 入口"/"家提供商"/"个工具"三类口径必须与 `PROVIDERS` / `TOOL_SPECS` 实测一致，且 README/CONTRIBUTING/CHANGELOG 头部不得出现硬编码的用例/断言总数 | S |
| ✅ Q-05 | `ace.cmd` 硬编码 `C:\aider_env\...` | 第 10 行,换机器必炸;改 PATH 探测 python/py | S |
| ✅ Q-06 | CI 结构一致性校验 | 已完成(v3.8)：权威树迁至 `docs/ARCHITECTURE.md` 并补齐 13 条缺口(根级 9 + `.github` 2 + `tools` 2)；`test_all.py` 新增 `[38]` 节自动校验"树↔文件"(R1 存在性/R2 根级/R3 已展开目录/R4 compileall)，随 CI 三档 Python 顺带执行，无需新增 job。立项卡 `docs/design/ARCH-TREE-CHECK.md` | S |
| ✅ Q-07 | prompts 工具清单 ↔ registry 差集 | 已完成(v3.8)：实测差集——`agent_system_prompt_tools.md` 漏 11 个、`agent_system_prompt_v7.md` 漏 13 个（kb_/skill_/goal_/subagent/search_read/browser_navigate/plan_propose/request_permission 等族全部缺席），`v8` 已齐；已按 registry 的真实权限分组重写 tools 版的【可用工具】并给 v7 补 22-34 条（参数照抄 `ToolSpec.example`，不臆造）。同时修掉两处**可用性谎言**：v7/tools 都写着"browser_click / browser_type 尚未实现(501)"，实际早已实现；v7 的"email 暂未接入(501)"实际是"未配 SMTP 才 501"。CI 守卫：test_all 的提示词断言从"只查 v8"扩到三个运行时提示词全覆盖 | S-M |
| ✅ Q-08 | e2e smoke 抗抖动 | 已落地：`e2e/real_model_smoke.py` 最多 3 次尝试、每次 150s 超时，第 1 次带工具调用、后两次换浅提问，任一成功即通过；次数可用 `ACE_E2E_ATTEMPTS` 调。v3.8 订正了 docstring 里"单次 240s"的旧描述 | S |
| ✅ Q-09 | 死代码清理（BehaviorConstraint 已移除） | `core/work.py:326 BehaviorConstraint` 仅测试引用、AST 规则无人用;执行层死 import | S |
| ✅ Q-10 | 错误语义与文案解耦 | 靠 message 中文子串判 403;`error_code` 自由字符串散落 ~30 处;状态码无集中常量 | error_code/status 枚举化,文案走 i18n | M |
| ✅ Q-11 | CONTRIBUTING 更新 + demo --check 入 CI + Docker run 示例补 `--project-root` | 已完成(v3.8)：CONTRIBUTING 已改为"总数随平台浮动、不写死数字"；`demo/record_demo.py --check` 进入 CI 的 test job（Py 3.12 单跑）；Docker run 示例补 `--project-root /app/project`。过程中发现演示脚本早就腐化：提示符仍认旧字形 `❯`（v3.6 已改 `▊`）导致用户输入行消失，且录制会吸入录制者的 `.ace_sessions/`（"已恢复上次会话"）、`.ace_kb` 绝对路径与快照数——已改为"临时工作目录 + 临时 HOME"的封闭录制、路径折叠成 `…/`，并重录 `demo/demo.svg`（29 行完整会话，结尾不再被 MAX_LINES 截断） | S |
| ✅ Q-12 | 版本单源 `__version__` + 里程碑 tag/Release | 已落地：`core/version.py` 是唯一来源，登录/聊天横幅由 `{ver}` 占位符注入（zh/en/ja），`python ai_code.py --version` 可查，`ace_doctor` 报版本，发布流水线用 `-ldflags -X main.serverVersion=…` 把同一版本号注入 Go 执行器；远端已有 `v3.3`~`v3.7` 里程碑 tag（v3.7.0 随 GitHub Release 发布 5 平台执行器产物） | S-M |
| ✅ Q-15 | 模块 docstring 检索词/命名说明 | 已落地（与 R-06 同一批）：`docs/INTERFACES.md §11` 有"历史命名 ↔ 真实职责 ↔ 检索词"索引（`archive`=记忆 / `nuwa`=报告 / `work`=诱饵+AST / `guardian`=快照回滚），且每个旧模块 docstring 首行已写清职责；约定"新模块一律 `ace_` 前缀" | S |

## P2 — 结构级(择机)

| ID | 事项 | 说明 | 工作量 |
|---|---|---|---|
| ✅ R-01 | `process_agent_output` 拆状态机 | 已完成：`process_agent_output` **288 → 17 行**（解析 → RoundCtx → `_run_round` → finally 回收），单轮逻辑落在 `_run_round`(52) 与 14 个 `_stage_*`；断言覆盖「阶段可脱离整轮单测 / 顺序守卫 / 轮末回收」。剩余：`_stage_permission` 103 行可再拆（外发闸门 / 项目外确认 / 逐次确认）。见 `docs/design/STRUCT-REFACTOR.md` | L |
| ✅ R-02 | FileTools 拆 FileOps/TerminalView/TerminalExec | 已完成(v3.9)：拆成 `file_common`(共享常量) + `file_ops` + `terminal_view` + `terminal_exec`，`file_tools.py` 只留 25 行兼容层；**25 个方法体经脚本逐字节校验未改**，`registry` 的 handler 名与 `FileTools` 组合一个没动。过程中被测试抓到「脚本只切方法、漏了 3 个类属性」 | M-L |
| ✅ R-03 | 双前端对话引擎合并 | **合并完成并已并入 `main`**：`core/ace_client.py` 是唯一一份模型 HTTP 客户端（唯一 `ace_http` 出网点、唯一拼 `/chat/completions` 的地方），CLI 走 `chat_stream`、无头走 `chat_once`，降级判据由前端注入而循环只此一份；`core/ace_model.py` 继续管共用纯逻辑（`trim_history` / `error_hint`）。**两侧验收都有证据**：① 无凭证——`e2e/r03_contract_smoke.py` 用真监听 socket + 两种线格式驱动两个前端（**7/7**）；② 厂商——`e2e/real_model_smoke.py` + `ACE_E2E_*`，**2026-09-25 在 DeepSeek 真实端点跑通**（exit 0，命中 `🤖 Agent:` 单行契约）。合并时 6 个文件冲突（`git merge-tree` 预演却报 0，预演不能当验收），决议与理由写在合并提交里；合并后第一次全量 1977/1980，暴露 3 条 R-03 之前的接入点守卫从未与新代码一起跑过，已按新架构改写 | M |
| ✅ R-04 | ai_code.py slash 表驱动 + 会话状态对象 | 已完成(v3.9)：`COMMAND_HANDLERS` 与 `COMMANDS` 分离，`run_command` **125 → 25 行**（前缀补全抽成 `_resolve_command`）；`converse` **234 → 175 行**（`_model_turn` 46 + `_note_round_progress` 25）；3 条表一致性断言 + 2 条语义顺序断言。「会话状态对象」仍未抽（并入 R-03 的推进顺序） | M |
| ✅ R-05 | test_all.py 拆 [N] 段 + runner(`--only/--skip`) | 已完成(v3.9)：35 段各自包进 `if _want(N)`（脚本整体缩进 + 行数守恒校验），新增 `--only/--skip/--upto/--list` 与显式依赖表；`--only 40` **14s → 0.3s**；`[41]` 运行器自检 + 段注册表覆盖断言。**没做的**：把段搬进 `tests/` 模块（依赖声明已够用） | M |
| ✅ R-06 | 命名/检索索引(INTERFACES §11)+ 新模块 ace_ 前缀约定;深层改名不强制 | | 新模块统一 ace_ 前缀;旧模块补导流 docstring | S |
| ✅ R-07 | 根目录瘦身：20 个根级模块下沉 `ui/` `cli/` `core/` | 已完成(v3.10.0)：根级 `.py` **24 → 4**（`ai_code.py` / `agent_runner.py` / `execution_layer.py` / `test_all.py`）。表现层→`ui/`、操作者工具→`cli/`、引擎支撑→`core/`；导入机械改写 **77 处 / 19 文件**，另修 3 处 `__file__` 相对资源、2 处 `mock.patch` 点号字符串、1 条源码守卫、`ci.yml` compileall 与 `release-executor.yml` 的 `import version`。`locales/` 与 `executor/` 保持根级。见 `docs/design/STRUCT-REFACTOR.md` R-07 | M |

## P3 — v3.42.0 之后新登记(本版实测发现；两条都已按实测收口，留档备查)

| ID | 事项 | 证据/说明 | 建议 | 工作量 |
|---|---|---|---|---|
| ✅ Q-16 | `snapshot_verify` 的**默认值**取舍(`create` vs `rollback`) | **已决定：默认保持 `create`，一行代码都不动。** 两档下坏快照都**不会被静默恢复**（`rollback()` 第一步就是完整性预检，有回归 F7 钉住），差别只是"坏快照何时暴露"：`create` 挡在写操作之前，`rollback` 等到想撤销时。夹具 347 文件 / 11.7 MB：只拷贝 **164 ms**、`create` **1929 ms**（8 线程）、`rollback` **162 ms**。本轮新测把"这 1.8 s 能不能降下来"问到了底，三条都指向**不能**：① **冷读 vs 热读**——对刚复制出来的副本校验 **24.4 ms/文件（8458 ms）**，紧接着对**同一份快照**再验一遍只要 **0.07 ms/文件（24 ms）**，**348×**，字节完全相同，差的只是"新写入文件的首次读盘"；② **哈希不要钱**——347 文件 / 11.7 MB 全部热读算 sha256 只要 **34 ms**（比那条冷读便宜约 50×；单个 12 MB 大文件 788 MB/s），所以不是"哈希慢"；③ **并发已到顶**——1/2/4/8 线程 8646/4850/2646/**1929** ms，而 12/16/24/32/48 线程 **2215/2392/2604/2635/2504 ms 全部比 8 线程更慢**，默认 `min(8, CPU)` 正是实测最优点（`ACE_HASH_WORKERS` 只是对照/排障旋钮，"调大它"是错的方向；以上均在本机 Windows 测得，跨平台最优线程数**未测**，别当跨平台结论）。而快照是**每个写工具调用**都建一次（`execution_layer.py` 的写工具分支），所以这个默认 = **每次写多花约 1.8 s 换坏快照早暴露**，是一个明码标价的取舍，不是待修的慢点 | 保持默认；成本拆解与"别再调大线程数"一并写进 `docs/CONFIGURATION.md`；不接受这个价就显式改成 `rollback` | S |
| ✅ Q-17 | L4 守门聚合后的**开销**已实测,如需再优化可加内容哈希缓存 | 修 warn 遮蔽 block 后,`check()` 从"第一条失败就返回"变成"跑满 8 条再按 block>warn 汇总"。实测 3349 字符代码载荷:**旧路径 53.6 µs**(在第 1 条 `type_hints` 就返回,于是密钥/SQL/AST 全没跑)→ **现在 5.4 ms**,其中 **4.65 ms 是 `v1_ast_check` 一条**(其余七条合计约 0.67 ms);纯文本 4 KB 0.51 ms;短输出 7.2 µs | **已决定：不要为它做优化**——多出来的时间正是"以前被跳过的检查现在真的跑了"(即修复本身)。**不登记为待办**;若将来单轮跑大量工具后真觉得慢,再给 `v1_ast_check` 加**按内容哈希缓存**(同一份输出每轮重复检查是纯浪费) | S |

## REL — 对外发布前

- ✅ REL-01 已建 `SECURITY.md` + Issue/PR 模板（`v3.3`）；GitHub topics/主页属仓库设置，需人工在网页维护
- ✅ REL-02 已处理：README 顶部"生产级"表述在二轮重构时对齐；关键数字动态化由 `test_all [39]`（Q-04）自动校验，文档里不再写死
- ✅ REL-03 真实 Windows 冒烟：**已走通**（`ace.cmd` → 解释器自解析 → 真实控制台对话，离线 `--mock`，退出码 0，中文与 emoji 正常）。固化为 `e2e/rel03_native_smoke.ps1` 三档（启动器 / 直接入口 / `chcp 936` 老终端），脚本纯 ASCII（PowerShell 5.1 按 ANSI 读无 BOM 脚本，第一版被自己的中文注释弄崩）。仍缺：真 TTY 下的 Textual 全屏（缺 `textual` 依赖时相关段跳过）与非 Windows 控制台
- ✅ REL-04 云端 e2e 激活说明已落文档(README secrets 指引 + e2e 头注释);配置 ACE_E2E_* 后 CI 自动启用
- ✅ REL-05 仓库落到组织名下（2026-09-18）：新建组织 **`ace-code-engine`**（个人号保留不动 —— 著作权署名仍是它），仓库过继为 `github.com/ace-code-engine/ace-agent`。实测过继后 **Issues / PR / Releases（v3.7.0 六件产物）、全部 tag、Actions 运行历史与两个 workflow 状态（active）都跟过来了**，旧地址 302 到新地址。仓库内 9 处"仓库地址"意义上的硬编码已换（`README.md`×3、`README.zh-CN.md`×3、`docs/GETTING-STARTED.md`、`docs/design/EXECUTOR-RELEASE.md`、`ai_code.py:194` 的 `_EXECUTOR_REPO` —— 最后一个不是装饰，`ace --install-executor` 就照它下载 Release 资产）；署名行（`LICENSE`、两份 README 页脚）与 `docs/history/**` 按纪律**不换**。遗留：组织侧 Actions 权限策略若日后收紧，注意 `release-executor.yml` 依赖 `permissions: contents: write`（workflow 内已显式声明）
- ✅ REL-06 **演示图重录**：四张全部重录（`demo.svg` / `demo_blocked.svg` / `demo_diff.svg` / `demo_landing.svg`），`python demo/record_demo.py --check` **四张全绿**（本机 exit 0）。**顺带推翻了这条事项的前提**：原判据写的是"必须在与 CI 同源的环境重录"，依据是"开发机上重录后失败转移到下一个没重录的文件"。真因不是列宽渲染不同源，而是录制脚本把临时目录的绝对路径**一律折成一个 `…`**，而面板补白是**按真实路径算好之后**才折叠的 —— ① 路径长度以补白形式留在 SVG 里（本机 work 路径 50 列、CI 69 列，CI 上 `--check` 必然对不上）；② 那一行比同框其它行短掉一大截，**已提交的图里那个框本来就是缺角的**（实测 HEAD 的 `demo.svg`：其余行 96 列，`目录` 行 28 列）。修法：折叠分两种口径（**框内行保宽**、**自由行折成一列**），并把判"框内行"前的 ANSI 剥掉（边框总带 `\x1b[0m`，不剥就永远判不出来）。**验收证据**：把临时目录路径加长 17 列，happy/blocked/landing/diff 四套剧本录出的**骨架逐字节一致**（修复前每 8 列路径差就让那一行窄 9 列）；`test_all [61]` 四条断言钉住（保宽、折一列、剥 ANSI、录制真的走 `_fold_path`）。**已知残余**：CI 那一次运行仍需观察（本机是 Windows/3.13、CI 是 ubuntu/3.12）；已知的平台差异（转轮帧与配色、时间戳）早已归一化，且修复前 `landing` 在数字归一化口径下就已与本机逐字节一致，说明渲染口径本身是通的。**残余已清（2026-09-26 发 v3.43.0 时）**：CI 那次真跑了 —— 四张图在数字归一化口径下确实与 CI 一致，红的是**版本横幅**（升 3.43.0 时漏了重录，而 `--check` 只在 CI 的 3.12 job 跑，本地全量套件看不出来）；顺带暴露出第二处平台不对称：录制只搬 `HOME` 时，签名锚（RG-01）在 Windows 上落到**录制者自己的** `%LOCALAPPDATA%`（Linux 上 `Path.home()` 认 `$HOME`，所以没露出来）→ 受限环境下锚建不出来 → 写路径 fail-close → `diff` 那张录到的是一条 `403` 并把录制者的真实路径印进图里。修法：录制环境把 `LOCALAPPDATA`/`APPDATA`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` 一并搬进临时 HOME；并新增 `test_all [68]` 调 `svg_version()` 在**本地**钉"图里的版本 == 版本单源"（反例已验：换回旧图，[68] 当场点名是哪张、什么版本）
- ✅ REL-07 **Rust 引擎（`engine/`）不进发布产物** —— 选路②并已写明。取证：`packaging/ace.spec` 的 `datas` 收的是 `prompts/ locales/ assets/ vendor/` + 三个根级文档（外加存在时的 `executor/`），**`engine/` 既不在列表里、也没有编好的二进制可带**，所以冻结版 `core/ace_engine.engine_path()` 必然找不到引擎、走 `_python_events/_python_meta`。为什么选②而不是①：实测引擎在热路径上**没有收益**（记忆召回 0.7×，即比 Python 慢；262 个小日志的跨会话聚合引擎 164 ms vs 本地 76 ms，只在单个大日志上赢），唯一用得上它的交互命令 `/audit stats` 省下的是毫秒级；而进包要给 `release-exe.yml` 加一套按平台编的 Rust 工具链 + 冒烟门禁，并长期维持引擎与 Python 两份实现的输出逐字节一致（现由 `engine/tools/xcheck.py` 8/8 与 `test_all [70]` H/I 段盯着）——为一个没有热路径收益的东西付这份长期同步成本不划算。降级不是能力缺失（字段集由 `_NORM_KEYS` 对齐、输出一致），故不与"不静默降级"取态冲突。文档：`docs/PACKAGING-EXE.md`（能力表新增一行 + "Rust 引擎不进包"整节，含实测数字与**改回去的方法**）、`docs/CONFIGURATION.md`（`ACE_ENGINE` → 源码树 → `PATH` 的发现顺序与降级行为）

- 🆕 REL-09 **主前端从不进 CI**（2026-09-27 发现并已修）：`frontend/`（TypeScript + Ink）有 17 个测试文件、`npm run build`（tsc）与 `npm test`（vitest）两个脚本，而 `.github/workflows/` 里 grep `node|npm|frontend|tsc` **零命中**。其中两条测试是**跨语言守卫**：`theme.test.ts` 直接读 `ui/ace_theme.py`、`protocol.test.ts` 直接读 `core/ace_events.py` / `agent_runner.py` 逐条比对 —— 也就是说 Python 侧改名、前端没跟上时，CI 是绿的，只有本机跑过 `npm test` 的人知道。另有 `integration.test.ts` 起真引擎（真管道 / 真协议 / 真审批往返），那是 `ace --serve` 目前唯一的端到端覆盖。**修法**：ci.yml 新增 `frontend` job（setup-node 20 + npm ci + tsc + vitest，带 setup-python 因为集成测试要 spawn 引擎）；前置条件是 H-31 先做掉（那个测试此前会把 mock 会话写进 checkout）。实测本机 17 文件 / 260 余条用例全绿、约 16 s

- ✅ REL-08 **发布要两次手动派发 → 已收成一次**（2026-09-27 实施）：`release-executor` 用 `gh release create` **经 API 建 tag**（不是 push 一个 ref），因此**不会**触发 `release-exe` 的 `push.tags`；而 `release-exe` 由 tag 触发时又**有意跳过** `Attach to release`（防两个工作流同时 create 撞 422）。于是"跑一次就两样产物齐全"不成立：Release 上的 5 平台执行器归 `release-executor`，MSI/zip 归**手动**再跑一次 `release-exe`（version 填同一个号）。**修法**：`release-executor` 的 `release` job 末尾新增一步 `gh workflow run release-exe.yml -f version=$VERSION` 主动接手（该工作流的 `permissions` 相应加了 `actions: write`），正常情况下仍只手动派发一次。两条路都幂等、先后随意，自动派发失败时仍可手工再来一次（`release-exe.yml` 顶部注释与 `push.tags` 那行错注释一并对齐了现码）

- ✅ REL-10 **改名 HooH（互）+ 仓库改名 `hooh-agent`**（2026-10-03）：产品改名见 `docs/NAMING.md`（含商标/版权口径与"不含任何游戏素材"的说明）。仓库 `github.com/ace-code-engine/ace-agent` → `github.com/ace-code-engine/hooh-agent`，GitHub 对旧地址 302，Issues/PR/Releases/tag/Actions 全部跟随（与 REL-05 过继时同样的性质）。仓库内**URL 意义上的硬编码**已一并换：`README.md`×2（徽章 + Releases）、`README.zh-CN.md`×2、`docs/BOOTSTRAP.md`×3、`docs/GETTING-STARTED.md`、`docs/design/EXECUTOR-RELEASE.md`、`packaging/make_wix.py`×2（WiX Comments / ARPURLINFOABOUT）、`ai_code.py` 的 `_EXECUTOR_REPO`（**不是装饰**，`ace --install-executor` 照它下载）、`demo/record_demo.py` 的图注。**按纪律刻意不换**：`core/guardian.py` 的 `%LOCALAPPDATA%\ace-agent\state`（那是**签名密钥锚目录**，属于磁盘兼容面，改了已装用户的快照链全部校验失败）、`docker/README-Docker.md` 的 `ace-agent:lite|standard|full`（**镜像名**，不是仓库名）、`docs/ARCHITECTURE.md` 目录树里的 `ace-agent/`（本地目录名）、`evidence-pack/**` 与 `docs/history/**`（历史留痕，改了等于篡改记录；里面的旧 URL 是**当时的事实**，不是待更新的引用）。仓库 description 与 social preview 卡图（`assets/repo-social-preview.png`，1280×640）同批换新

## WISH — 未来许愿（不计入排期：先把「差什么、要付多少」如实记下来）

### WISH-01 把 OpenSSF Scorecard 从 2.1 往上推（徽章因此先摘掉）

2026-10-31 实测（记分卡 v5.6.0，`api.securityscorecards.dev/projects/github.com/ace-code-engine/hooh-agent`，commit `ac36522`）总分 **2.1**，所以 README 的徽章先撤了 —— 顺带发现原来挂的是个 404 地址（`/badge/github/<owner>/<repo>`；正确形式是 `/projects/<host>/<owner>/<repo>/badge`），图里一直是裂的。

| 检查项 | 分 | 官方给的原因 | 要往上推得做什么 | 成本 |
|---|---|---|---|---|
| Dangerous-Workflow | 10 | 无危险工作流模式 | —— | —— |
| SAST | 10 | 检出 CodeQL | —— | —— |
| License | 10 | 检出许可证文件 | —— | —— |
| Security-Policy | 4 | 有 `SECURITY.md` | 补齐 scorecard 认的全套（披露渠道 / 响应时限） | 小 |
| Contributors | 3 | 1 家贡献组织 | 有更多贡献者自然涨 | —— |
| Maintained | 0 | **仓库创建还在 90 天内** | **会自己好**：约 2026-11-17 之后这条不再扣 | 免费 |
| Code-Review | 0 | 30 个变更集里 0 个经批准 | 以后走 PR + 至少一次 approve（自评也算） | 免费，改习惯 |
| Token-Permissions | 0 | workflow token 权限过大 | 每个 workflow 顶层 `permissions: contents: read`，按 job 加最小必需项 | 免费，半小时 |
| Branch-Protection | 0 | `main` 没开保护 | 开经典分支保护：要求 PR、要求 CI 绿、禁 force push | 免费，五分钟 |
| Dependency-Update-Tool | 0 | 没配更新机器人 | 加 `.github/dependabot.yml`（pip / npm / actions 三套） | 免费，十分钟 |
| Pinned-Dependencies | 0 | 有依赖没按 hash 钉住 | actions 全部 `@<sha>`、Dockerfile 钉 digest | 小但唠叨 |
| Binary-Artifacts | 0 | 仓库里有二进制 | 二进制只走 Release；`vendor/*.whl` 这类要么移出去、要么确认 scorecard 是否把 wheel 当二进制 | 中 |
| Vulnerabilities | 0 | **19 个已知漏洞** | 先 `npm audit` + `pip-audit` 拉清单（pip 侧现在是绿的，大头大概在 JS 依赖树 / vendor 里的旧 wheel 元数据），再决定升依赖还是把 vendor 移出扫描面 | 中-大 |
| Signed-Releases | 0 | Release 无签名/无 provenance | 加 `actions/attest-build-provenance`（免费，要 `id-token: write` + `attestations: write`） | 小 |
| CII-Best-Practices | 0 | 没申请 OpenSSF 最佳实践徽章 | 去 bestpractices.dev 填表 | 免费，费时间 |
| Fuzzing | 0 | 没有 fuzz | 给解析面（simhash / 协议帧）加一小套 fuzz | 大 |
| CI-Tests / Packaging | -1 | 没有 PR、没有 packaging workflow | 走 PR 流程；把 `build_release.ps1` 接进 CI 就分别有分 | 小 |

**挂回徽章的判据**：总分 ≥ 5，且 `Dangerous-Workflow` 仍是 10 分（别为了分数把危险工作流放开）。徽章只挂 `securityscorecards.dev` 的官方图 —— 自己画一个好看的静态图是自欺。

## 建议顺序

1. ✅ **P0 全批**（SEC-01→SEC-06）已完成 + 各自回归测试
2. ✅ **P1 快速项全清**（Q-01 ~ Q-15）：2026-09-18 的 v3.8 一轮把最后四项（Q-04/Q-06/Q-07/Q-11）连同 Q-08/Q-12/Q-15 的核对一起收口
3. ✅ **P2 结构重构**：R-01 / R-02 / R-04 / R-05 / R-06 / R-07 已闭环（v3.9 + v3.10.0）；**R-03 的引擎合并也已落地并两侧验收通过**（唯一客户端 `core/ace_client.py` + 无凭证契约冒烟 7/7 + **2026-09-25 在真实厂商端点 DeepSeek 上跑通**）。详见 `docs/design/STRUCT-REFACTOR.md`
4. ✅ **REL-03 真机冒烟已走通**（Windows，三档全过），并因此抓出并修掉一处真缺陷：`_generate_text` 把裸文本直接递给执行层，导致不带 `--tools` 时永远到不了最终回复（见 `CHANGELOG`）。剩余人工项：v3.7.0 Release 上那个多余的 `logo.svg` 资产（非必需）；darwin/amd64 执行器仍无 Intel Mac 原生冒烟（本机无 Go 工具链，无法在此复现）
5. ✅ **v3.42.0 一轮**（2026-09-26）：执行层 6 处"承诺了但没做"对齐 + Rust 元处理内核（会话事件流索引）+ 运行度量与跨会话成本 + 写前快照校验并行化 4.4×（另有 `snapshot_verify=rollback` 的 12× 档）。新增回归断言 D1–D10 / E1–E5 / F1–F9 / G1–G5 / H1–H4 / I1–I5 / J1–J2，详见 `CHANGELOG.md` 与 `docs/RELEASE-NOTES-v3.42.0.md`。**这一轮的四件未闭环事项已全部收口**：REL-06（演示图四张重录 + 录制位置无关已修）、REL-07（永不进包 + 写明降级）、Q-16（默认保持 `create` + 成本拆解）、Q-17（不优化，留档）
