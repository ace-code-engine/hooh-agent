# 能力路线图（Roadmap）— 四项兼得，不做取舍

> 缘起：2026-09-27 对 `G:\agents\repos` 下**全部 29 个**开源编码 agent 做**只读**审计，逐项对照 HooH 实测能力，
> 整理出"产品面缺口 + 语言决策 + 工作面 + 批次"。审计全程未修改任何被审仓库，也未修改本仓库。
> **目标不是"追平参照系"，而是守住一个参照系都没占的位置**：安全性、高速响应、自我驱动、无需亲历亲为 —— **四者兼得**（§0）。
> 约定：编号 `LANG-`(语言决策) / `G-`(实测缺口) / `WP-`(工作面) / `NG-`(非目标) / `ACC-`(验收门槛)。
> 脊柱：编号 `DL-`(驱动) / `RL-`(响应) / `HL-`(自愈) —— 见 **§0.5** 与 `docs/design/THREE-LAYERS.md`。
> 关系：`BACKLOG.md` 管**战术**待办（SEC-/Q-/R-/REL-，多为已知缺陷与重构）；
> 本文管**能力面**的战略补齐（多为"参照系有、我们完全没有"）。两者不重叠。
> 状态：**已开工** —— 截至 2026-10-01，批次 **-1 / 0 / 1 / 2 / 3 / 4 / 5 已关闭**，只剩批次 6（WP-8 后半 · WP-9）；
> 三层脊柱 `DL-01~04` / `RL-01~04` / `HL-01~05` **13 项全部落地**。每个 WP 开工时另立卡进 `docs/design/`
> （已立：`WP-0-TAIL-TECH.md` · `WP-4-SNAPSHOT-SEMANTICS.md`（C5）· `WP-6-AGENT-PRESETS.md`（C4）· `WP-9-SANDBOX-BACKEND.md`（C6）· `ACE-MCP-SEC-SUBAGENT.md`（WP-11 · SEC-022））。

---

## 0. 定位：四项兼得，不做取舍

> **HooH 的核心主张 —— 安全性、高速响应、自我驱动、无需亲历亲为，四者兼得。**

这四项在**绝大多数 agent 里是互相收税的**：要安全就每次写都建快照（**Q-16 旧测 1929 ms/次 —— `2026-10-01 复测 55~132 ms`，见 §2.5 复测注**）；要自主就得有人盯着；
要人放心就得频繁确认，于是人反而更累；快，但每五秒打断你，等于没离开。

**所以 HooH 的核心工程任务不是"把某一项做到极致"，而是拆掉这四项之间的税。**

| 张力 | 通行做法（收税） | HooH 的拆法 | 落点 |
|---|---|---|---|
| **安全 ← 速度** | 每次写操作都付快照成本（**旧测 1929 ms → 复测 55~132 ms**） | 快照哈希下沉 Rust + reflink/COW | **WP-10 (R1)** · **WP-9** `cubecow` |
| **安全 ← 自我驱动** | 越自主越危险 → 只能靠人盯 | 把自主**关进边界**：三层沙箱 + 授权模型 | **WP-9** · **§2.6** |
| **自我驱动 ← 无需亲历亲为** | 让人放心就得频繁确认 → 人更累 | 逐次确认 → **对象绑定授权令**；"问什么"可配 | 已有 H-27~H-32 · **WP-6** |
| **速度 ← 无需亲历亲为** | 快，但不断打断你 | 前缀缓存 + 工具面伸缩 + 忙时不丢消息 | **WP-3** · **G-03** · **WP-1** |

### 0.1 四支柱的含义（每一根都可验收）

| 支柱 | 一句话 | 已在的支撑 | 要补的 |
|---|---|---|---|
| **A 安全性** | **敢走开**：后果有界、可回滚、可审计 | `execution_layer` 14 阶段状态机 / HMAC 链式台账 / 快照回滚 / H-27~H-32 / 对象绑定授权 | **WP-9** 三层沙箱 · **§2.6** 授权模型 · **WP-8** 域名级出网 |
| **B 高速响应** | **走得开**：不因安全而等待 | `ace --serve` NDJSON / 流式 delta / `engine/` 已有 Rust | **WP-10**（快照哈希 R1 · **流式客户端 R1** · grep R1）· **WP-3** 前缀缓存 · **WP-8** reflink |
| **C 自我驱动** | **有事可做**：你不在时自己推进多步 | 队列 + 两段式中断 / 20 轮闭环 / `subagent` | **WP-4** 四层进程模型 · **WP-3** 工具面伸缩 · **WP-10** LSP + 代码索引 · **WP-6** subagent 型预设 |
| **D 无需亲历亲为** | **回来能用**：结果可信、可读、可续 | 会话 JSONL / 台账 / `--serve` | **WP-1**（steering / followUp / `ask_user`）· **WP-4** 后台进程 · **WP-5** 会话树 · **ACC** 门槛 |

### 0.2 缺一条，另外三条就塌

- 没有 **A**，**C** 不可接受 —— 不敢让它自己跑。
- 没有 **B**，**D** 变成折磨 —— 等待比自己做还累。
- 没有 **C**，**A** 只是"什么都问一遍" —— 等于人自己干。
- 没有 **D**，**C** 没有意义 —— 跑了还得人盯着。

**合起来一句：敢走开（A）、走得开（B）、有事可做（C）、回来能用（D）。**

### 0.3 这条定位**倒推**出 Rust 扩大

不是"Rust 更快所以用 Rust"，而是：

1. **"安全性不与速度冲突"** 物理上等于 **"把安全机制的成本压到接近零"** ——
   Q-16 旧测的 **1929 ms/次快照**（每个写工具调用都付）**曾**是这条冲突的**现价** —— 但
   **2026-10-01 复测：347 文件 / 16.2 MB，`create` 冷 132 ms、热 55 ms，`verify` 5 ms**。
   旧数字过时 15~35×，所以"把快照成本从 O(秒) 压到 O(十毫秒)"这件事**现行代码已经做到了**，
   **R1 的快照哈希一项失去依据**（要下沉须先重测出新热点）；
   只有把它从 O(秒) 压到 O(十毫秒)，"安全"才不再对"速度"收税。这是 **WP-10 R1** 的全部理由。
2. **"自我驱动"** 需要重计算底座（代码索引 / LSP / 富读取器）—— Rust 的天然领域，且这些**目前不存在**，没有 Python 版本要维护，直接落 **R2**。
3. **"无需亲历亲为"的前提是结果可信** —— 这就是 **§6 ACC 门槛**存在的理由：
   **不可验证的自主性是赌博，不是自主性。**

> 结论：**Rust 扩大的驱动力来自四支柱兼得，不是语言偏好。** 技术细节在 §2.4~§2.7。

### 0.4 为什么这个位置只有 HooH 站着

| 事实 | 证据 |
|---|---|
| pi（110k★，参照系里产品面最完整）**明说没有内置权限系统**，交给容器/micro-VM（Gondolin / Docker / OpenShell） | `pi/packages/coding-agent/docs/security.md` |
| CubeSandbox 自我定位是「**跑 agent 的沙箱**，不是 agent 工具层」 | `CubeSandbox/agent/libs/safe-path/README.md:1-17` |
| 参照系里把权限做在**进程内**的极少，且都不如 HooH 硬（对象绑定授权 + HMAC 链式台账 + 全局单调 seq） | 见 §9 索引 |

两家都把**权限**主动推开 ⇒ "安全性与高速响应兼得"这个位置是**空的**，而它正好是 HooH 已经在的位置。

### 0.5 三层脊柱（设计卡：`docs/design/THREE-LAYERS.md`）

四支柱定了"要什么"，但**"上面怎么指挥、中间怎么回报、撞墙了怎么办"从来没有设计过** —— 这就是剩下的全部设计工作：

| 层 | 职责 | 现状（实测） | 设计卡 |
|---|---|---|---|
| **驱动层** | 定目标、排优先级、**从拒绝中学习** | 有目标 CRUD（266+149 行），**无优先级、无目标级预算、无学习机制** | §1 `DL-01~04` |
| **响应层** | 把执行结果（**含拒绝信号**）高效回传 | 结果**以中文散文回喂**，`status`/`error_code` 等结构化字段被丢掉 | §2 `RL-01~04` |
| **自愈层** | 连续失败时**降级或上报**，不无限撞墙 | **六套互不相通的机制**（退避/3 次熔断/H-21 abort/`STALL_ABORT_ROUNDS`/`MAX_ROUNDS=20`/`security_alerts`），无共享状态、无阶梯、无出口 | §3 `HL-01~05` |

**枢纽是一句话：拒绝是信息，失败是状态。**

现有代码把两者塞进同一个 `(tool, error_message)` 计数器 —— 于是 H-19 那次**截断导致的 400** 被当成"连续失败"，
把 `file_write` **永久熔断**（`agent_runner.py:96-103` 自己记下了这个 bug）。
所以三层共用**两个账本**：

| | 拒绝账本 | 失败账本 |
|---|---|---|
| 回答 | "这个意图是不是**此路不通**" | "现在该**升到哪一级**" |
| 寿命 | **长期 / 跨会话** —— 是**知识**（该固化进 `/rules`） | **短期 / 本会话** —— 是**状态**（结束即清） |

**同键不同命** —— 这是整张卡最容易被实现错、也最不能实现错的地方。

> 分层动机来自一个真实案例：H-21 的死锁里，自愈层**升级了、也上报了，但归错了因** ——
> 把"两个安全特性的交叉"上报成"模型死循环"（`agent_runner.py:613-631`）。**按错误的原因修，永远修不好。**

---

## 1. 风格（6 条，每条都带明确取舍）

| # | 风格 | 意味着 | 明确**拒绝** |
|---|---|---|---|
| S-1 | **权限在层内，不在模型里** | 继续 execution-layer-first；`CONFIRM_TOOLS` / `_gated_identity` / `BANNED_AUTO_PREFIXES` 是硬边界，模型永不自决权限 | 拒绝 pi 的"无内置权限，丢给容器"；拒绝把安全判断交给提示词。**但必须区分两件事**：把**执行边界**外包给沙箱（WP-9）是允许的；把**决定权**外包出去是不允许的。**语言可以换，层不能越**（§2.6） |
| S-2 | **一个内核，N 个外壳** | 引擎发事件，呈现器只渲染。现状是 4 个前端各写一遍：**权限对话框 ×4、工具卡 ×3、spinner ×3、菜单 ×3** | 拒绝"每个前端自己实现"；拒绝新增第 5 个前端 |
| S-3 | **齐全优先于深度** | pi 的教训：产品感来自"面"的齐全（37 篇文档 = 37 个面） | 拒绝先把某一个面做到极致再去补别的 |
| S-4 | **每一层可测、可回滚、可审计** | 这三样已是护城河，任何新面必须接入同一套台账与快照 | 拒绝为赶进度绕过 `execution_layer` |
| S-5 | **前缀稳定是一等公民** | 补上指纹校验 + 变化归因 + 恒等快路径（见 WP-3） | 拒绝把工具目录当随便拼的字符串 |
| S-6 | **文档即产品面** | pi 有 37 篇用户面文档；HooH 目前**0 篇**"某个面怎么用" | 拒绝把文档当附属品 |

**S-2 是最锋利的一条**，因为它决定后面每个面的工作量是 ×1 还是 ×4；也是 §7 批次 0 存在的唯一理由。

---

## 2. 语言决策（LANG-01 ~ LANG-06）

### 2.1 实测现状：HooH **已经是多语言项目**

| 语言 | 落点 | 实测行数 | 是否持有执行权 |
|---|---|---|---|
| Python | `execution_layer.py` / `ai_code.py` / `agent_runner.py` / `core/` / `tools/` / `ui/` / `tui/` / `cli/` / `gateway_v2/` / `e2e/` / `benchmarks/` / `demo/` | **≈31,900**（+ `test_all.py` 13,453） | **是（唯一）** |
| Go | `executor/`（10 个 `.go` + `go.mod`） | ≈2,200 | 否（只执行已批准的 OS 边界） |
| Rust | `engine/src/`（`events` `json` `main` `md5` `protocol` `simhash` + `Cargo.toml`） | ≈2,200 | **否**（现状：只读元处理，不进发布包）→ **由 LANG-04 扩大** |
| TypeScript | `frontend/src` + `frontend/test` + `frontend/tools` | ≈7,400 | 否（纯呈现） |

### 2.2 逐个语言的裁决（逐条回应"ts/python/rust/go/java/js"）

| ID | 语言 | 裁决 | 理由 |
|---|---|---|---|
| **LANG-01** | **Python** | ✅ **主语言，不替换** | 执行层 31.9k 行 + 2438 条断言 + 护城河（对象绑定授权 / HMAC 链式台账 / 14 阶段状态机）全在这里。重写 = 把护城河扔掉 |
| **LANG-02** | **TypeScript** | ✅ **呈现层唯一正式语言，扩大** | `frontend/` 已是声明的主前端（TS + Ink + React，走 `ace --serve` 的 NDJSON）。pi(110k★)/cline/opencode/codex 主前端同为 TS；Ink/React 生态只在 TS 侧 |
| **LANG-03** | **Go** | ✅ **保留，不扩大职责** | `executor/` 已承担 Windows Job Object 与跨平台 sandbox。它的价值在**OS 边界**，不在业务逻辑；边界之外不要再往 Go 里放东西 |
| **LANG-04** | **Rust** | ✅ **核心化：从"可选加速器"升级为"核心计算层"，并进发布包** | 见 **§2.4~§2.7**。HooH 自身的核心性能优化与功能增强以 Rust 为主要载体；下沉分 **R1 加速层 / R2 核心子系统 / R3 边界原语** 三层，受**授权模型**约束（§2.6）。参照系验证：CubeSandbox 把 `agent/libs/safe-path`（symlink/TOCTTOU 防护）写成 Rust，与本仓库 `engine/` 同构 |
| **LANG-05** | **JavaScript（无类型）** | ❌ **不新增业务代码** | 仅在工具链配置（vitest/tsconfig）里存在。`frontend/package.json` 已是 `"type": "module"` + 全 TS，保持 |
| **LANG-06** | **Java** | ❌ **不引入** | 无任何一项缺口需要 JVM；引入即增加一份运行时与一条发布通道 |

### 2.3 语言策略一句话

> **按职责分配语言，而权限只在 Python 那一层。**
> Python 决策 → **Rust 承担核心计算与加速** → Go 执行边界 → TypeScript 呈现。
> 新增能力**默认 Python**；核心热路径与**新建的高性能子系统**下沉 Rust（分层见 §2.4）；
> **不允许**为了"参照系也这么写"而跨层搬逻辑 —— 但**允许**为了实测性能与核心能力下沉 Rust。
> 无论语言怎么换，**权限的决定权不出 `execution_layer.py`**（§2.6）。

### 2.4 Rust 核心化：三个下沉层次

**决定：Rust 从"可选加速器"升级为"核心计算层"。** HooH 自己的核心要做**性能优化**与**功能增强**，这两件事的主要载体就是 Rust。
但"核心化"不等于"重写" —— 界线由下表三个层次划定。

| 层次 | 含义 | 降级要求 | 适用 |
|---|---|---|---|
| **R1 加速层** | 已有 Python 实现，Rust 替换热点 | **必须**保留 Python 同口径实现 + xcheck 对拍 | 快照哈希、grep/glob、AST 守门、simhash、NDJSON |
| **R2 核心子系统** | Rust 是该子系统的**唯一实现**（Python 侧只留编排与权限） | 允许无降级，但**缺 Rust 产物时必须显式拒绝该功能并给诊断** —— 不许静默走行为不同的实现 | 代码索引、LSP client、富读取器、PTY、文件监视 |
| **R3 边界原语** | 纯函数判定原语，供 Python 调用 | **必须**有 Python 参考实现（xcheck 用） | safe-path 路径判定、execpolicy 解析、路径规范化 |

### 2.5 核心子系统矩阵（Rust 接手清单）

| 子系统 | 现状 | 层次 | 依据 / 收益 |
|---|---|---|---|
| **快照哈希 / 目录校验** | `core/guardian.py`（Python） | **R1** | ~~Q-16：`create` 1929 ms~~ **⚠ 复测（2026-10-01）：347 文件 / 16.2 MB → `create` 冷 132 ms、热 55 ms，`verify` 5 ms** —— **旧数字过时 15~35×，这条 R1 依据已不成立**；要不要下沉须先重测 |
| **L4 守门 / AST 检查** | `core/work.py` `v1_ast_check` | **R1** | **Q-17**：`check()` **5.4 ms/次**，`v1_ast_check` 独占 **4.65 ms** → 目标 sub-ms |
| **文件检索（grep / glob）** | `tools/terminal_view.py`（Python） | **R1** | `search_read` 族的地基；ripgrep 级并发遍历 |
| **记忆检索（simhash）** | `engine/src/simhash.rs` **已有** | **R1** | 扩大；`core/archive.py` 的召回路径 |
| **流式模型客户端** | `core/ace_client.py`（Python） | **R1** | **每个 token** 都过 Python 的 JSON 解析与字符串拼接 —— 目前最大的未测热点 |
| **NDJSON 协议编解码** | `engine/src/protocol.rs` **已有** | **R1** | 前后端已在跑 NDJSON（`ace --serve`） |
| **代码索引（tree-sitter）** | **无** | **R2** | Reasonix `code_index`；是 G-03 工具面伸缩的前置 |
| **LSP client** | **无** | **R2** | 高频 JSON-RPC over stdio，延迟敏感；参照 Codewhale `lsp` / `diagnostics` |
| **富读取器（pdf / sqlite / archive / binary）** | `tools/parse_tools.py` 部分 | **R2** | oh-my-pi `read-*` 族 |
| **PTY / 终端** | `tools/terminal_exec.py`（走 Go executor） | **R2 候选** | 高吞吐交互；**与 Go executor 职责重叠，本路线图内不合并** |
| **文件监视（fs events）** | **无** | **R2** | 后台任务与 dev-server 等待（Codewhale `wait_for_dev_server`） |
| **路径判定原语（symlink / TOCTTOU）** | `core/sensitive.py`（Python） | **R3** | CubeSandbox `agent/libs/safe-path`（参考 `filepath-securejoin`、CVE-2021-30465） |
| **execpolicy 解析** | `core/ace_execpolicy.py` | **R3** | SEC-06 的落点；纯函数，易对拍 |

### 2.6 授权模型（**最关键的一条**）

> **Python 决定"允许什么"，Rust 在其内执行"怎么做"。**

Rust 可以承担核心计算，但**不得绕过权限层**：

1. Rust 的**每次副作用调用**（读文件 / 写文件 / 网络 / 起进程）都必须携带 **Python 签发的授权范围**（复用 **H-32 授权令**）；
2. Rust **自己一侧再执行一次**路径限定（纵深防御，照 CubeSandbox `safe-path`）—— **不信任调用方**；
3. Rust **不得扩大授权范围**，也**不得自行发起**未被授权的访问；
4. 权限的**决定**（是否放行、放行到哪）永远在 `execution_layer.py`。

这条解决了"核心化"与 **S-1（权限在层内）** 的张力：**语言可以换，层不能越。**

### 2.7 四条硬契约

1. **R1 必须有 Python 同口径降级实现** —— 沿用 `engine/` 现有契约（`docs/ARCHITECTURE.md`：Rust 引擎"坏掉只损失增强，退回纯 Python 同口径实现"）。
2. **R2 必须显式失败，不许静默降级** —— 缺 Rust 产物时给出明确诊断并拒绝该功能；**不许**回退到一个行为不同的 Python 替代。
3. **Rust 必须进发布包** —— 走**既有**预编译通道（`docs/design/EXECUTOR-RELEASE.md`：预编译二进制 + `ace --install-executor` + 5 平台），复用 `.github/workflows/release-executor.yml`，**不新开通道**。**终端用户不需要 Rust 工具链。**
4. **必须有基准与对拍** —— 每个下沉项进 `benchmarks/` 留可复核数据；`engine/tools/xcheck.py` **已存在**，新项必须纳入"同一输入下 Rust 与 Python 结果一致"。

**不做的事**：不重写 `execution_layer.py` 的权限状态机；不在本路线图内把 Go `executor/` 合并进 Rust（避免双重重写）。
**与分发的区别**：`exe` 只能跑 Python UI 的真因是 `packaging/ace.spec` 的 `datas` **没有 `frontend/`** 且 `ace.cmd:60-86` 需要 Node ≥18 + `tsx` —— 那是**打包问题**，重写 Rust 解决不了，见 WP-0 前置项。

---

## 3. 能力地图：功能模块 × 实测缺口

### 3.1 功能模块矩阵（6 平面 / 38 模块）

> 行数均为**本仓库实测**（`Get-Content | Measure-Object -Line`，排除 `node_modules` / `.git` / `__pycache__`）。
> 「语言」列写**现状 → 目标**；「状态」列的箭头指向 §4 的 **WP** 或 §3.2 的 **G**。

| ID | 功能模块 | 现有落点（实测） | 语言 | 状态 |
|---|---|---|---|---|
| | **平面 1 · 安全与权限**（S-1 的落点） | | | |
| M-01 | 权限裁定 | `execution_layer.py` `_stage_permission` · `core/ace_execpolicy.py` 439 · `core/ace_mandate.py` 152 | Py | 已有（**护城河**） |
| M-02 | 路径 / 敏感判定 | `core/sensitive.py` 135 · `canonical.py` 41 · `targets.py` 40 · `ace_isolation.py` 96 | Py → **Py + Rust(R3)** | 已有 → **WP-10** |
| M-03 | 出网闸门 | `core/ace_net.py` 493 · `tools/web_tools.py` 582 的 egress 分支 | Py | ✅ 已有（**域名级** allowlist 已落地）→ **WP-8** 只剩"非 URL 通道" |
| M-04 | 审计台账 | HMAC 链式 + `core/ace_claims.py` 41 · `ace_taint.py` 109 | Py | 已有（强于参照系） |
| M-05 | 沙箱边界 | `tools/docker_sandbox.py` 380 · `core/ace_executor.py` 540 · `executor/`(Go) | Py + **Go** → **+ CubeSandbox** | 已有 → **WP-9** |
| | **平面 2 · 执行与工具**（51 个 `ToolSpec`） | | | |
| M-06 | 工具注册表 | `tools/registry.py` 545（**51 个**，49 暴露） | Py | 已有 → **WP-3** 延迟目录 |
| M-07 | 文件与编辑 | `tools/file_ops.py` 741 · `file_common.py` 37 · `terminal_view.py` 247 | Py | 已有 |
| M-08 | 终端 / 代码执行 | `tools/terminal_exec.py` 271 · `code_tools.py` 332 | Py + Go | 已有 → **R1 / R2** |
| M-09 | 检索（grep / glob / search / kb） | `registry` 的 4 个检索工具 + `kb_tools.py` 134 | Py | 已有 → **R1** |
| M-10 | 网络与浏览器 | `tools/web_tools.py` 582 · `notify_tools.py` 76 | Py | 已有 |
| M-11 | 数据与文档 | `tools/db_tools.py` 138 · `parse_tools.py` 41 · `core/universal_document_parser.py` 588 | Py | 已有 → **R2** 富读取器 |
| M-12 | **git 工具族** | `tools/git_ops.py` 392（8 个 git_*，只读 5 + 写 3） | Py | 已有（WP-2 本批落地） |
| M-13 | **代码智能（LSP / 索引）** | **无** | **Rust (R2)** | **缺** → **WP-10** |
| | **平面 3 · 自主与状态**（支柱 C / D） | | | |
| M-14 | 多轮闭环与阶段机 | `execution_layer.py` 2276（14 个 `_stage_*`）· `agent_runner.py` 846 | Py | 已有（**护城河**） |
| M-15 | 目标与待办 | `tools/goal_tools.py` 266 · `core/ace_todos.py` 149 | Py | 已有 |
| M-16 | 子代理 | `tools/subagent_tools.py` **43** | Py | **薄** → **WP-4** 并行 |
| M-17 | 队列与中断 | `ai_code.py` 队列 + 两段式中断 | Py | 已有 → **WP-1** 策略可配 |
| M-18 | **任务 / 工作区 / 进程四层** | **无** | Py + **Rust(R2)** | **缺** → **WP-4**（G-09） |
| M-19 | 记忆与知识 | `core/archive.py` 290 · `nuwa.py` 143 · `ace_rules.py` 278 | Py → **R1**(simhash) | 已有 → **WP-7** skill |
| | **平面 4 · 上下文与模型**（支柱 B） | | | |
| M-20 | 上下文装配 | `ai_code.py` · `cli/ace_context.py` 256 · `prompts/` 3 个系统提示词 | Py | 已有 → **WP-1** |
| M-21 | 模型客户端（流式） | `core/ace_client.py` 424（**唯一 `ace_http` 出网点**）· `ace_http.py` 208 · `ace_model.py` 101 | Py → **Rust(R1)** | 已有 → **最大未测热点** |
| M-22 | **前缀缓存** | 只有"稳定拼接" | **Rust(R1)** | **缺后两半** → **WP-3**（G-02） |
| M-23 | 成本与用量 | `core/ace_cost.py` 98 · `ace_effort.py` 114 | Py | 已有 → **ACC-01** |
| M-24 | 提示词分层 | `prompts/` 3 个 + AGENTS.md / CLAUDE.md 层级发现 | Py | **缺 `SYSTEM.md`** → **WP-1**（G-06） |
| M-25 | 会话与分支 | `cli/ace_sessions.py` 135 · `ace_sessionlog.py` 351 · `.ace_sessions/` | Py | 已有 → **WP-5** 树（G-10） |
| | **平面 5 · 交互**（4 个前端） | | | |
| M-26 | 事件协议 | `core/ace_serve.py` 389（`FrameEmitter` / `EventEmitter`）· `ace_events.py` 184 · `ace_commands.py` 161 | Py ↔ JSON | **已有** → **WP-0** 补齐 |
| M-27 | 主前端 | `frontend/src` 4487 + `test` 2749（**TS + Ink + React**） | **TS** | 已有（**唯一正式外壳**；迁入的 dsh 壳为显式备用入口 `ace ui`，WP-DSH-SHELL——其 ink 自退出缺陷修复后重评） |
| M-28 | Python 终端 UI | `ui/` 24 文件 / 5050 | Py | 已有 → **降为 fallback** |
| M-29 | TUI | `tui/app.py` 1609 + `bridge.py` 53 | Py | 已有 → **降为 fallback** |
| M-30 | MCP 集成面 | `core/ace_mcp.py` 530 · `ace_mcp_server.py` 279 | Py | 已有（**保留，不参与收敛**） |
| M-31 | 设置与配置 | **32** 个 config key（`docs/CONFIGURATION.md`） | Py + TS | 已有 → **WP-1** `/settings` |
| | **平面 6 · 支撑** | | | |
| M-32 | 快照与恢复 | `core/guardian.py` 587 · `ace_recovery.py` 167 · `ace_patch.py` 97 | Py → **Rust(R1)** | 已有 → **Q-16 的 1.8 s** |
| M-33 | **Rust 加速层** | `engine/src/` 6 个 `.rs`（events 435 / protocol 519 / json 368 / main 320 / simhash 243 / md5 103） | **Rust** | 已有 → **WP-10** 核心化 |
| M-34 | Go 边界执行器 | `executor/` 10 个 `.go`（run 482 / sandbox_windows 381 / main 241 …） | **Go** | 已有 |
| M-35 | 打包与发布 | `packaging/` · `.github/workflows/` 3 个（ci / release-executor / release-exe） | — | 已有 → **R-3 前置** |
| M-36 | 门面与守护 | `gateway_v2/` 4 文件（`intent.py` / `guard.py` / `flywheel.py`） | Py | 已有 |
| M-37 | 本地化 | `locales/{en,ja,zh}.json` 757 / 757 / 752 | JSON | 已有 |
| M-38 | 测试与质量闸 | `test_all.py` 13453（**2438 断言**）· `benchmarks/` · `e2e/` · `demo/` | Py + TS | 已有 → **ACC** 门槛 |

**M-06 的 51 个工具按功能族分布（实测）**

| 功能族 | 数量 | 工具名 |
|---|---|---|
| 文件 | **9** | `file_read` `file_write` `file_delete` `file_move` `edit_file` `open_file` `str_replace` `glob` `terminal_view` |
| 检索 | **6** | `grep` `search` `search_read` `kb_search` `kb_add` `kb_list` |
| 终端与执行 | **3** | `terminal_exec` `code_execute` `terminal_dangerous`(隐藏) |
| 网络与浏览器 | **9** | `api_get` `api_post` `browser_navigate` `browser_open` `browser_click` `browser_type` `browser_screenshot` `notify_send` `image_generate` |
| 数据与计算 | **6** | `db_query` `db_write` `db_drop`(隐藏) `math_calc` `datetime_now` `parse_document` |
| 自主与控制 | **10** | `plan_propose` `request_permission` `ask_user` `goal_create` `goal_update` `goal_status` `subagent` `todo_write` `skill_list` `skill_load` |
| **git** | **8** | `git_status` `git_diff` `git_log` `git_show` `git_blame` `git_commit_plan` `git_fetch` `git_merge_tree` |
| **合计** | **51**（49 暴露） | 隐藏项：`terminal_dangerous` / `db_drop`（均 `PERM_HIGH_RISK`、`expose=False`） |

> **模块视角的两个直接结论**：
> ① **支柱 C（自我驱动）的模块最薄** —— M-16 子代理只有 **43 行**，M-18 四层进程模型**根本不存在**；
> ② **支柱 B（高速响应）的最大热点在 M-21** —— `ace_client.py` 是**唯一出网点**，每个 token 都过 Python 的 JSON 解析与字符串拼接，而它至今**没有基准数据**。

### 3.2 实测缺口（G-01 ~ G-12）

对照方式：`grep` 本仓库确认**完全不存在**，且参照系**有可抄实现**。

| ID | 缺口 | HooH 实测 | 参照系（可抄） | 严重度 |
|---|---|---|---|---|
| **G-01** | **git 工具族** | 工具数 **8**（51 个工具中 git 族占 8 个；auto-commit + `/undo` 已与快照回滚统一落地） | Codewhale **8 个** `git_*`（status/diff/commit_plan/log/show/blame/fetch/merge_tree）；oh-my-pi **6 个** `gh*`；aider auto-commit + `/undo` | **高** |
| **G-02** | **前缀缓存后两半** | 只有"稳定拼接"，**无指纹校验、无变化归因** | Reasonix `cache_policy.go:21-36`（路由级 TTL）→ Codewhale `core/src/prefix_cache.rs`（1220 行，SHA-256 pin + 强制归因 + drift）→ oh-my-pi `append-only-context.ts:97-151`（恒等快路径） | **高** |
| **G-03** | **工具面按需伸缩** | 51 个工具（49 暴露）描述**全部常驻**，啃前缀 | Codewhale `ToolSurfaceBudget` + `DEFAULT_ACTIVE_NATIVE_TOOLS` + 延迟目录（`tool_search` / `retrieve_tool_result`）；Reasonix `code_index` / `context_budget` | 中 |
| **G-04** | **面向模型的问题工具** | **0**（所有提问都在 UI 层，模型不能主动问人） | codex `RequestUserInput`；crush `question_choice_base` | 中 |
| **G-05** | **用户自定义提示词即命令** | **0**（59 个斜杠命令全硬编码，用户一条都加不了） | pi `prompts/*.md` → 自动成 `/name`；`argument-hint`（`<必填>`/`[可选]`）+ `${1:-默认}` | 中 |
| **G-06** | **系统提示词分层** | 无 `SYSTEM.md` 概念，只有 AGENTS.md 层级发现 | pi `SYSTEM.md`(**替换**) / `APPEND_SYSTEM.md`(**追加**)，trusted project 优先、同名不合并 | 中 |
| **G-07** | **繁忙时发送策略可配** | 有 queue + 两段式中断，但**消费策略硬编码** | pi `steeringMode` / `followUpMode`（`all` \| `one-at-a-time`），两个 config key | 低（但成本极低） |
| **G-08** | **Skill 系统** | 很薄/缺失 | pi 实现 [agentskills.io 规范](https://agentskills.io/specification)（`SKILL.md` + 只广告 name/description、正文按需加载、`/skill:name`、无效字段只 warning）；orca 的 **stub/guide 分离**（防桩与二进制漂移）+ 受管安装进各 agent 自己的根目录 | 中 |
| **G-09** | **工作区/进程模型** | 单根；无 worktree；无进程级状态 | vibe-kanban 四层 `Task → Workspace → Session → ExecutionProcess`（`models/execution_process.rs:53-78`）；orca `ipc/filesystem-auth.ts:73-94` 的 `allowedRoots + registered worktrees` | **高** |
| **G-10** | **会话树 / 分支** | 有 resume，**无树/分支** | pi `/tree`(同文件内移动) `/fork`(从早期消息建新会话) `/clone`(复制当前分支) 三态 + **离开分支时摘要化并附着到进入的分支** | **高** |
| **G-11** | **agent 预设 / 自定义模式** | **0**（`CONFIRM_TOOLS` 是全局常量） | kilocode `.kilo/agent/*.md` frontmatter + per-agent `permission:{read\|edit\|webfetch\|bash:ask}`；opencode `Agent.Info`；cline `mode.ts` | 中 |
| **G-12** | **出网按域名显式放行** | ✅ **已有** —— `egress_allowlist` + `DEFAULT_EGRESS_ALLOWLIST`（`core/ace_net.py` 的 `host_in_allowlist` / `egress_reject_reason`），配置→执行层→执行器**全链路接通**（`test_all` 6 处断言）。**残余缺口**：闸门**只管 URL** —— UNC/SMB 走 H-29 的路径层判据，`terminal_exec` 等非 URL 通道**不在闸门内** | CubeSandbox CubeVS 的 eBPF map `dns_allow` / `dns_query_track`（**连 DNS 都强制过** L7 MITM） | 中 |

### 3.3 三个已定位的**根因**（不是缺功能，是现有实现挡路）

| 根因 | 位置 | 影响 |
|---|---|---|
| **拿 label 当答案** | `ai_code.py:4000` `return list(items).index(str(picked))` | 4 个前端**都**做不了"让用户自己输入选项"（§9 的 Q 项） |
| **丢弃选项 key** | ~~`ui/ace_dialog.py:367` `labels = [it.text() for ...]`~~ **已过时**（2026-09-30 复核：现码 `:377`/`:388` 都 `selectable[idx].key`，key 没丢） | ~~`DialogItem.key` 被扔掉，选择器只能回传显示文本~~ → 见 `WP-0` 卡「P-10 实测复核」第 1 条 |
| **前端比后端弱** | `frontend/src/components/ChoiceDialog.tsx:166-171` 明文回显 API key；`getpass` 只在无 UI 时生效（`ai_code.py:2961-2967`） | 加密路径在有 UI 时**静默降级** |

**三条根因的归属（2026-09-27 补：此前三条都[没有 WP 承载](#72-批次表)）**

- **①② 归 `WP-0`**。协议侧**已经**支持这件事 —— `choice_request` 的 `kind` 就定义为
  `choose / confirm / text`（`core/ace_events.py:20` 与 `:79` 的必需字段表），发射点在 `core/ace_serve.py:521`。
  所以这两条不是"缺能力"，是**后端能、外壳把 key 丢了** —— 正是 `WP-0`"让 4 个外壳变成协议消费者"的正题。
- **③ 单列**，进 §7 **批次 -1**，已立卡 **`docs/design/CREDENTIAL-HANDLING.md`（`H-33 ~ H-35`）**。
  它是**凭据处理**缺陷（不是体验问题），要过 §6 `ACC-03`，因此**不并入 `WP-0`**。
  实测链条：`ai_code.py:3007` 的密钥步骤声明 `hidden=True` → `:2956` **有组件界面时**走 `_ask_text`（**不传 hidden**）
  → `:4007` `_ask_text`（签名里**没有** hidden）→ `frontend/src/components/ChoiceDialog.tsx:168` 的
  `kind === 'text'` **把值明文渲染**；`hidden` 只在 `:2963` 的**无界面分支**经 `getpass` 生效。
  **没有任何外壳掩码**（`tui/app.py:983` 的 `_hidden` 指"不可见 Unicode 字符"，与掩码无关 —— 复核时纠正过一处误判）。
  还有**第二条**泄漏路径：`_ask_text` 的 `input()` 兜底（`:4021`）本身回显，而它的准入判据
  `_ui_can_prompt()` 查的是 **`choose`** 不是 `ask_text`（`:3964-3967`）。
  而现有断言只钉"步骤**声明了** hidden"（`test_all.py:8555`），**没钉"hidden 被尊重"** ——
  这正是 §6 **ACC-04** 的"**attempted 读成 judged**"。

---

## 4. 工作面（WP-0 ~ WP-10）

> **WP ↔ 功能模块（§3.1）对照**
> WP-0 = M-26~M-31 · WP-1 = M-17 / M-20 / M-24 / M-31 · WP-2 = **M-12（新建）** · WP-3 = M-06 / M-21 / M-22 ·
> WP-4 = M-16 / M-18 · WP-5 = M-25 · WP-6 = M-01（per-agent 化）· WP-7 = M-19 · WP-8 = M-03 / M-32 ·
> WP-9 = M-05 · WP-10 = M-02 / M-08 / M-09 / M-11 / **M-13（新建）** / M-21 / M-22 / M-32 / M-33

### WP-0 · 前端收敛（**前置**）

> 立项卡：`docs/design/WP-0-FRONTEND-CONVERGENCE.md`（2026-09-27 立）。该卡实测复核了本节，
> 其中**三处与本节转述不一致**（跨语言守卫测试实为 **10** 个不是 8 个；§4 的打包前置项
> **没有构建产物可增补**；exe 的前提是 Ink 外壳靠 `tsx` 直跑源码）—— 以卡为准，原文未改。

- **现状**：`ui/` 5,050 + `tui/` 1,684 + `frontend/src` 4,487 + `frontend/test` 2,749 ≈ **13,970 行呈现代码**，
  与内核（Python 31.9k 中的引擎部分）体量相当，且重复实现：**权限对话框 ×4 / 工具卡 ×3 / spinner ×3 / 菜单 ×3**。
- **好消息：协议已存在。** `core/ace_serve.py` 的 `FrameEmitter` / `EventEmitter` + `ace --serve` 双向 NDJSON
  + `frontend/src/protocol/` 已在跑。**WP-0 不是造协议，而是让 4 个前端都变成协议消费者。**
- **范围**：
  1. 事件协议补齐到"权限请求/工具卡/状态/spinner/菜单"全覆盖（新增事件而非改旧语义）；
  2. `frontend/` 定为**唯一正式外壳**（2026-10-31 回归：dsh 壳存在 ink 自退出缺陷，修复前不转正）；`ui/` + `tui/` 降级为**无 Node 环境时的 fallback**，只修 bug 不加功能；
  3. `ace --mcp` 保留（它是**集成面**，不是外壳，不参与收敛）。
- **前置项（打包）**：`packaging/ace.spec` 的 `datas` 增补 `frontend/` 构建产物，否则 exe 用户看不到 WP-0/WP-1 的前端部分。
- **验收**：4 份权限对话框合一后，`test_all.py` 全绿；8 个跨语言守卫测试（theme/protocol/spinner/diff/tasktree/match/vim/launcher，读 Python 源码做 parity）全部改指协议层并仍绿。
- **风险**：**高**（动全部 4 个前端）。缓解：分批迁移，每批保持旧路径可用。

### WP-1 · 四个便宜的面（G-04 / G-05 / G-06 / G-07）

| 子项 | 做法 | 量 |
|---|---|---|
| 提示词模板 | `prompts/*.md` 加载器（**注意**：现有 `prompts/` 放的是系统提示词 `agent_system_prompt_v*.md`，需另立目录如 `prompts/commands/` 或 `ace_prompts/`），frontmatter `description` + `argument-hint`，`${1:-默认}` 插值，注册进现有 `COMMANDS` 表 | S |
| 繁忙发送策略 | 现有队列加 `steeringMode` / `followUpMode` 两个 config key | XS |
| `ask_user` 工具 | 新工具走 execution_layer 现有 confirm 通道，模型可主动提问 | S |
| 系统提示词分层 | 复用现有 AGENTS.md/CLAUDE.md 层级发现器，加 `SYSTEM.md`(替换) / `APPEND_SYSTEM.md`(追加) | S |

- **验收**：四子项各自带回归断言；`test_all [39]` 的"文档数字单一来源"校验不得因新增 config key 变红。
- **风险**：低。唯一注意点是 `prompts/` 目录已被系统提示词占用。

> **进度（2026-09-30）**：① 提示词模板 —— 已由 `core/ace_commands.py` 落地（`.ace/commands/*.md` +
> frontmatter + 插件目录 + `test_all [44]`），本轮补上 `${1:-默认}` 带默认值插值（此前是 `$1` 缺参空串）；
> ② 繁忙发送策略 —— `steering_mode`/`followup_mode` 两键已落地（`TurnController` + `CLIConfig` + TUI 透传）；
> ④ 系统提示词分层 —— `SYSTEM.md`（项目根，替换默认提示词）/ `APPEND_SYSTEM.md`（追加）已落地，
> 机器安全（守门/沙箱/权限/隔离标记）在代码里、不受 SYSTEM.md 影响；
> ③ ask_user —— 执行层 `ASK_USER` 往返 + `answer_ask_user` + 文本回流已落地（核心），
> **四壳接线也已收口**（REPL 的 `converse` 分支 · TUI 的 `ask_question` TextScreen ·
> Ink 走既有 `choice_request(kind=text)` 通道，零前端改动）—— `test_all [74]` 5 场景行为级断言。
> **⇒ 四个子项全部落地、UI 也消费了（`RL-01` 那句「字段到了、用途还没到」在这条上已不成立）。**

### WP-2 · git 工具族（G-01）

- **范围**：`git_status` / `git_diff` / `git_log` / `git_show` / `git_blame` / `git_commit_plan` / `git_fetch` / `git_merge_tree`（照 Codewhale 命名），
  加 aider 式 **auto-commit + `/undo`**。
- **必须复用**：现有 confirm 门 + `_prefix_auto_approved` / `BANNED_AUTO_PREFIXES`。
  **注意** `git config` 已被 SEC-06 限定为 `--get/--list`，新工具不得重新打开写路径。
- **验收**：每个工具进 `registry` 时带 `ToolSpec.egress`/权限组；只读类（status/diff/log/show/blame）与写类（commit_plan/fetch/merge_tree）**分档**，写类逐次确认。
- **风险**：中（git 是写操作，且 `.git` 是敏感目录，需与 `sensitive.py` 判定协同）。

> **进度（2026-09-30）**：git 工具族（8 个）已由 `tools/git_ops.py` 落地并进 `registry`（51 个 / 49 暴露）。
> 只读 5（status/diff/log/show/blame）= PERM_READ 免确认；写 3（commit_plan/fetch/merge_tree）=
> PERM_WRITE + `confirm=True` 逐次确认，`command` 参数接 `confirm_subject` 预览与
> `_prefix_auto_approved` / `BANNED_AUTO_PREFIXES` 同前缀免确认；`git config` 写路径未重开
> （argv[1] 结构锁定 + -c/--config/-C 显式拒绝）；`.git` 内部与敏感目标经 `sensitive_target` 协同拦截。
> **aider 式 auto-commit + `/undo` 已落地**（同日收尾）：config key `auto_commit`（**默认关**，行为逐字一致）；
> 成功写操作后自动 `git commit`（`ace: auto-commit <tool> <主题>`，git 写类工具除外）；
> `/undo` 仍走**同一条**快照回滚路（guardian.rollback 还原文件），仅伴随 `git reset --mixed`
> 把分支指针同步回写前提交 —— **不是第二套回滚**（§8 R-2）。非 git 仓库/无 git 如实声明一次。
> 边界见 `docs/CONFIGURATION.md`「aider 式自动提交与 `/undo` 的统一」。

### WP-3 · 前缀缓存后两半（G-02 / G-03）

- **范围**：
  1. 对不可变前缀（system + tool specs）取 **SHA-256 指纹**，每请求前校验（Codewhale `PrefixStabilityManager`）；
  2. **变化强制归因**：`/model`、`/mode`、goal、MCP 重 pin 等都在日志里带理由；**未声明的变化记为 drift 并上报，但原 pin 不丢**；
  3. **恒等快路径**：指纹不变则跳过 snapshot + stringify（oh-my-pi）。**关键细节**：比较**解析后的 parameters**而非工具容器，因为工具 `parameters` 可能是活体 getter；
  4. `ToolSurfaceBudget` + 延迟工具目录（`tool_search` / `retrieve_tool_result`）。
- **验收**：新增"前缀稳定性"断言——同一轮内重复构建必须命中快路径；`/model` 切换必须产生一条带理由的归因日志；drift 出现时原 pin 仍在。
- **风险**：中（触及模型调用路径，但**不触及权限**）。
- **进度（2026-09-30）**：四件事全部落地 —— `core/ace_prefix.py`（新文件，纯逻辑）：
  `PrefixStabilityManager`（pin / verify / attribute / drift，指纹 = SHA-256(system + **解析后的**
  工具 schema + scope)，**只解析一遍**工具规格以免活体 getter 让摘要与快照自相矛盾）、
  `ToolSurfaceBudget` + `DeferredToolCatalog`（超预算折叠、`tool_search` 常驻、命中即激活且
  sticky、预算装得下就不摆空目录）、`ResultStash`（`retrieve_tool_result` **只落接口**）。
  `ai_code.py`：`_model_turn` 里每请求前校验（指纹不变 → 不重写 `system/snapshot`，恒等快路径）、
  `/model` `/provider` `/permission` `/effort` 关键词逃生门 `/lang` `/net` 技能 `@file|@folder|@session`
  goal resume/pause/complete MCP 重 pin `tool_search` 激活 **全部带理由归因**（`model/switch` +
  `guard/verdict(rule=prefix_stability)`，空理由当场拒绝）；drift 一次/每个新指纹上报 stderr，
  **原 pin 不丢**；工具面改**现算**（`registry.openai_tools()`）—— 顺带修掉"运行时注册的 MCP 工具
  进不了请求清单"（`agent_runner.TOOLS` 是导入期快照）；配置键 `prefix_cache` / `tool_surface_budget`
  进了 `docs/CONFIGURATION.md`；断言在 `.test_tmp/wp3_check.py`（61 项，先红后绿）。
  **边界**：`retrieve_tool_result` 未接线（见 CONFIGURATION.md）；`tool_search` 不进 registry
  （由工具面在分发前截住）；goal 声明如实记为 `declare_noop`（它走用户消息，不进不可变前缀）；
  `skill_load` 工具路径换技能未声明（只覆盖了 `@skill` 命令路径）。
- **顺带（HL-03 规则②）**：`ModelClient` 的原生工具调用降级（400/404）此前**静默**，现补
  `tools_degraded` 状态字段 + stderr 一行 + 一条带理由的前缀归因（`describe()` 可查）。

### WP-4 · 工作区四层（G-09）

- **范围**（照 vibe-kanban 四层）：
  `Task → Workspace → Session → ExecutionProcess`；一个 workspace = 一个 worktree + 一个 branch；
  `ExecutionProcess.run_reason` 枚举（`SetupScript` / `CleanupScript` / `ArchiveScript` / `CodingAgent` / `DevServer`）+ `status` + `exit_code` + `dropped`；
  每行状态取**最新进程**（`LatestProcessInfo`）；
  `Workspace` 四字段 `archived` / `pinned` / `name`(首条 prompt 自动命名) / `worktree_deleted`。
- **更硬的一层**（照 orca）：`allowedRoots + registered worktrees` 文件系统授权 —— agent 读写被限制在**注册过的 worktree 根内**。
  **已接线（2026-10-01）**：`tools/base._confined` 的放行集合 = 项目根 ∪ `.ace/workspaces.json` 里注册过的 worktree 根。
  选 `_confined` 而不是逐个工具：它是 `file_ops` / `parse_tools` / `terminal_view` / `git_ops` **共用的咽喉点**，一处接线全覆盖。
  **边界（如实记）**：`file_write` / `file_delete` / `str_replace` **故意**放行任意绝对路径（"放到桌面"是产品意图），
  所以接线给它们带来的是"能写进 worktree"而不是"被收紧到 worktree"——`_confined` 管的是**被项目边界约束的那一类路径**。
  想让绝对路径写也受 allowedRoots 管，是一次**收紧既有已测行为**的独立决策，不塞进这次接线。
- **C5 规则 3（快照基）**：**已落地为"如实声明"，不落地为"进程内切换"**。按 `--project-root <worktree>` 重开会话
  时快照基自然就是该 worktree（每根还有各自独立的签名锚），规则 3 的两条要求由构造方式直接满足；
  进程内改 `project_root` 会波及 executor / guardian / archive / sessionlog / MCP / 技能 / 权限规则六七个持有者，
  且**半途实现恰好会产生 C5 卡禁止的"两套回滚"**（共用 store 时 `rollback` 会用当前实例的根解析快照里的相对路径）。
  落地的那一半：`snapshot_state` 新增 `partial`（快照盖不住本轮路径时**走结果**而不是只打 stderr）+ `/workspace`
  逐行报「撤销覆盖：是/否」。放行与否一字未改。详见 `docs/design/WP-4-SNAPSHOT-SEMANTICS.md` §6。
- **开工前必须先做的统一**：**worktree 与现有快照回滚语义必须统一**，否则会存在两套回滚（灾难）。
- **风险**：**高**。这是本路线图里最重的一项，且与 `core/guardian.py` 的快照体系强耦合。

### WP-5 · 会话树（G-10）

- **范围**：`/tree`（同文件内移动）/ `/fork`（从早期用户消息建新会话）/ `/clone`（复制当前分支）三态严格区分；
  **离开分支时可摘要化并附着到进入的分支**（29 个仓库里只有 pi 做了这件事）；
  `/compact` 加摘要但**不删除原始条目**；session picker 支持搜索/重命名/删除/排序/只看命名/显示路径。
- **落点**：HooH 现在有会话 JSONL + 台账；需引入 **entry 树**，且**只有 active branch 进上下文**。
- **风险**：高（会话是持久化格式，改动涉及向后兼容）。

### WP-6 · agent 预设 / 自定义模式（G-11）

- **范围**：`agents/*.md` frontmatter（照 kilocode），把 `CONFIRM_TOOLS` 从**全局常量**变成 **per-agent 权限规则**
  （`permission: {read|edit|webfetch|bash: ask}`）。
- **顺序**：必须等 WP-0 之后，因为预设切换要广播到所有外壳。
- **风险**：**高** —— 直接改权限层（属"权限模型风险最高"的一项；全局最高的安全风险在 WP-9）。必须**单独立卡 + 单独评审**，且不得削弱 S-1。

### WP-7 · Skill 系统（G-08）

- **范围**：`skills/<name>/SKILL.md` + `scripts/` `references/` `assets/`；
  **只广告 name+description，正文按需加载**；`/skill:name` 调用；**无效字段只 warning 不阻塞启动**；
  抄 orca 的 **stub/guide 分离**（桩在仓库里，完整指南由二进制按版本提供，**永不与真实二进制脱节**）。
- **风险**：中。注意与 WP-6 共用一套分层发现器，建议同批做。

### WP-8 · 出网与快照（G-12）

- **范围**：egress 从"工具名/端点白名单"升级为**域名级显式放行**（CubeSandbox `dns_allow`）；
  快照从整目录拷贝向 reflink/COW 演进。
- **注意**：HooH **不自研**容器/micro-VM（见 NG-01），只抄 CubeSandbox 的**策略模型**（域名级放行）与 `cubecow` 的快照模型。
- **风险**：中。与 SEC-03 的 egress 设计需保持兼容（不得削弱逐次确认）。

### WP-9 · 沙箱后端：接腾讯云 CubeSandbox

- **定位**：把 H-30 的"**没有 OS 边界就 503 拒绝**"升级为"**有边界就跑**"。
  CubeSandbox 提供**硬件级隔离**（KVM MicroVM，RustVMM 自带内核，无共享内核逃逸），启动**数十 ms**，E2B API 兼容，Apache-2.0，已进 CNCF Landscape。
- **它是什么**：`TencentCloud/CubeSandbox` —— 自我定位「*Instant, Concurrent, Secure & Lightweight Sandbox Service **for AI Agents***」，
  即"**跑 agent 的沙箱**"，**不是 agent 工具层**。这正好补上 HooH 缺的那一层边界。
- **接入点**：`tools/code_tools.py`（`code_execute`）、`tools/terminal_exec.py`。
- **形态**：E2B 兼容 REST（`openapi.yml`）+ Python SDK（PyPI `cubesandbox`）：
  `Sandbox.create(template=…)` → `run_code` / `commands.run`；
  端点族 `/sandboxes`、`/{id}/{connect,logs,network,pause,resume,rollback,snapshots,timeout}`、`/snapshots`、`/templates*`、`/volumes`。
- **三层沙箱后端**：

| 层 | 边界 | 何时用 |
|---|---|---|
| Tier 0 | **无边界 → 拒绝** | 现状（H-30）。**保持不变** |
| Tier 1 | 本地 Go `executor/` + Windows Job Object | 本地、可信机器 |
| **Tier 2** | **CubeSandbox MicroVM** | 不可信代码 / 远程 / 高并发 |

- **不只是当后端用 —— 可抄的四项技术**：
  1. **`CubeEgress`**：全部出网强制经 **L7 MITM**，域名须**显式放行**（BPF map `dns_allow` / `dns_query_track`）→ 直接强化 **WP-8 / G-12**；
  2. **`cubecow`**：XFS `FICLONE` reflink，**O(1) 快照/克隆**，扁平快照模型 + 崩溃恢复扫 `volumes/` → 直接对治 **Q-16 实测的 1.8 s**；
  3. **`agent/libs/safe-path`**（Rust，symlink/TOCTTOU，参考 `filepath-securejoin`、CVE-2021-30465）→ 落 **LANG-04**；
  4. **`CubeTemplateCenter` + templates-from-sandbox**：**从沙箱固化模板**，把"跑通的环境"变成可复用起点。
- **必须新增的验收（本条最关键）**：
  - **凭据绝不进沙箱环境**：参照 Codewhale 的 Daytona 注记 —— provider secret **不得**经 `-e` / SDK `envVars` 传入（**服务端可见**）；需断言"沙箱调用时上下文里没有 API key"。
  - **模板 / 快照不含凭据**：固化前必须扫敏感内容（复用 `core/sensitive.py`）。
  - **出网默认拒绝**，域名显式放行；沙箱内 DNS 与 HooH `egress_allowlist` 口径一致。
  - **故障降级方向必须朝"更严"**：CubeSandbox 不可达时**降级到 Tier 0 拒绝**，**绝不**降级到本地无边界执行。
- **风险**：**最高（安全影响面）**。这是本路线图里唯一新增**远程执行通道**的项。
  必须：过 §6 全部 ACC 门槛 + 领 SEC 编号 + 单独立卡 + 按 `docs/design/SAFETY-HARDENING.md` 的既有格式评审。
- **许可证注意**：CubeSandbox 内 `agent/` 为 **Kata 派生（Apache-2.0）**；若 vendor 任何代码，须保留 Kata 版权声明与 `SPDX-License-Identifier` 头。

### WP-10 · Rust 核心化（**横向工作面**）

- **定位**：**横向** —— 不排在某个批次里，而是贯穿所有 WP。**§2.5 的矩阵就是它的工作清单**。
- **为什么横向**：Rust 不是在某个阶段"引入"，而是给每个 WP 提供更快的底座 ——
  WP-3（前缀缓存）要 `simhash`、WP-2（git）要快的大文件与差异解析、WP-4（工作区）要快照哈希、WP-8（快照演进）要 reflink 语义。
- **交付形态**：`engine/` 从"只读元处理、不进发布包"改为**正式加速层**；新增 crate 与 `engine/src/` 同构，统一走 `release-executor.yml`。
- **验收**（缺一不可）：
  - 每个下沉项在 `benchmarks/` 留下**下沉前 / 后**的可复核数据（**不许只报"更快了"**）；
  - **R1** 类必须有 Python 同口径降级 + xcheck 对拍；
  - **R2** 类必须有"**缺 Rust 产物**"的**显式失败**测试（不许静默降级）；
  - **R3** 类必须有 Python 参考实现并对拍；
  - **授权模型测试**：构造"Rust 收到**超出授权范围**的路径"的用例，必须**被 Rust 自己拦住** —— 纵深防御不能只靠 Python。
- **风险**：**高**。这是把 Rust 从"可选"变成"必需"的一步，会同时改动**构建 / CI / 发布**三条链路。
- **前提**：**只剩 R-9**（工具链与 CI）—— `engine/target/` 那条已核实为 **R-6 = 虚警**（`.gitignore:43`，0 个跟踪文件），
  且 `ci.yml:66` 的 `engine` job（`dtolnay/rust-toolchain` + offline build + `--selftest` + parity）**已存在**。

### WP-11 · MCP 安全子层（ACE-as-a-service）

- **定位**：安全纵深的新一档 —— 把 HooH 的**裁决点 + 安全体检**打包成一个完整 MCP 服务，
  主 agent（任意 MCP host）挂上它当**子安全层**做安全测试；两者**共用 CubeSandbox 虚拟化底座**。
- **范围**：`ace_security_scan`（路径级静态扫描，判据全部复用 `core/sensitive.py` 等既有名单）+
  `ace_sandbox_exec`（不可信代码进 CubeSandbox；**Tier-0 铁律**：不可达 → 拒绝，绝不退回本地）。
- **落点**：`core/ace_secscan.py` · `core/ace_cubesandbox.py` · `ai_code.py::_run_mcp` 的工具面拼接 ·
  `e2e/mcp_probe.py` 新用例。协议层**复用**既有 `--mcp`（`MCP-SERVER.md` M1–M7），不重写。
- **卡**：`docs/design/ACE-MCP-SEC-SUBAGENT.md`（**SEC-022** 首次登记：防止"扫过了"被当成"安全了"）。
- **真机冒烟（人做）**：部署 CubeSandbox → `ACE_SANDBOX_API` → 主 agent 调 `ace_sandbox_exec`。

---

## 5. 非目标（NG-01 ~ NG-06）

| ID | 不做 | 理由 |
|---|---|---|
| **NG-01** | **自研**容器 / micro-VM | HooH 是工具层，**不自研** hypervisor / 网络 / 存储。但**要接**现成的硬件级沙箱（**WP-9**：腾讯云 CubeSandbox）—— H-30"没有 OS 边界就拒绝 `code_execute`"正好由它来满足 |
| **NG-02** | IDE / Electron 桌面 | orca 是 `src/main/` 下约 130 个 agent 目录的规模，不是我们的战场 |
| **NG-03** | 会话上传 / 分享链接 | pi 自己在文档里警告：会话含提示词、工具参数、命令输出、文件内容、**对话中暴露的凭据** |
| **NG-04** | computer-use / browser 自动化 | oh-my-pi 有 `browser`/`computer`/`ida`，我们没有这个体量，且与 S-1 冲突 |
| **NG-05** | 重写权限架构 | H-27~H-32 刚修完并已推 17 个 commit；这是护城河 |
| **NG-06** | 引入 Java / 无类型 JS 业务代码 | 见 LANG-05 / LANG-06 |

---

## 6. 验收门槛（ACC-01 ~ ACC-04）

> 来源：DeepSeek-Reasonix 把"可发布性"做成了**代码**而不是文档，这套纪律比我们现有的更严。
> HooH 的 H-27~H-32 编号制度**已经是这套东西的雏形**，只是没写成契约。
> 立项卡：`docs/design/ACC-GATES.md`（2026-09-27 立）。该卡实测指出：**ACC-04 说的
> "进 `test_all.py` 评审清单"里那份清单目前并不存在**（全仓库零命中），需要新建。

| ID | 门槛 | 说明 |
|---|---|---|
| **ACC-01** | **自报 token 必须与实测一致** | Reasonix `-meter` 用环回代理自数 token，**与模型自报不一致即取消该结果的可发布资格**。HooH 有链式台账，接这个很自然 |
| **ACC-02** | **指标语义契约**（五要素） | `Metric` / `Anchor` / `Population` / `Excludes` / **`Reads as`** |
| **ACC-03** | **缺陷可达性契约**（六要素） | `Constructed state` / **`Production producer`** / `Transition path` / `Persistence boundary` / `Authority` / `Observed` |
| **ACC-04** | **五种偷换**（进 `test_all.py` 评审清单） | unknown 读成 true、latest 读成 all、accepted 读成 closed、attempted 读成 judged、**未评估读成 false** |

**ACC 建议独立立卡**，因为它反过来保护上面所有 WP。

---

## 7. 批次与依赖

**排序依据 = 先拆哪条"税"最划算**（对应 §0 的张力表），再加两条**乘数优先**原则：

- **依据一（原有）** 先拆哪条"税"最划算 —— 见下表"拆哪条税"列；
- **依据二（新增）** **凡是"决定别人怎么写"的先做**：范围闸门 / 验收模板 / 单一来源口径，成本以小时计，
  却决定后面每一项要不要返工。这就是 **批次 -1** 存在的理由；
- **依据三（新增）** **改公共契约的必须同批**：`RL-01` 与 `WP-0` 是**同一份数据的两端**，
  分成两批就等于让 `ExecutionResult` 的新字段**漏给 4 个外壳一次**。

### 7.1 六条硬约束（每条都有落点，不是偏好）

| # | 约束 | 证据 |
|---|---|---|
| **C1** | **`RL-01` 必须与 `WP-0` 同批** | `docs/design/THREE-LAYERS.md:310`：RL-01 与 WP-0 **同源**——"给机器的结构与给前端的事件是**同一份数据**"；`TH-R5`：只做正交新增字段，**配合 WP-0** |
| **C2** | **厂商 `usage` 必须在任何"报数"之前进账本** | `core/ace_client.py` 今天**不解析 `usage`**（实测零命中），而 `ai_code.py:5619/5626` 报出的每个数都由 `estimate_tokens` 折出 |
| **C3** | **`DL-03`（拒绝账本）与 `HL-01`（失败账本）必须同批** | `THREE-LAYERS.md:259-271`：两者**同一键空间 `(goal_id, fingerprint, class)`**、只有**寿命不同**；拆开做必被实现成一个（`TH-R2` 防的正是这个） |
| **C4** | **`DL-03` 必须先于 `WP-6`** | `THREE-LAYERS.md:309`：**WP-6（per-agent 权限）是拒绝账本的消费方** |
| **C5** | **`WP-4` 开工前必须先立"快照语义统一"卡** | §8 **R-2**：worktree 与现有快照回滚会打架 ⇒ **两套回滚**（灾难） |
| **C6** | **`WP-9` 必须先过 §6 全部 ACC + 领 SEC 编号 + 单独立卡** | §4 WP-9 验收段 + §8 R-8 |

### 7.2 批次表

| 批次 | 内容 | 拆哪条税 | 硬依赖 | 出口条件 |
|---|---|---|---|---|
| **-1 闸门** | **ACC-A0**（`usage` 进账本）· **ACC-A1**（02/03 模板）· **ACC-A2**（04 守卫段）· **WP-0 W0-A**（重复点名）· **WP-0 W0-D**（打包三选一）· **G6 凭据回显边界**（§3.3 ③；已立卡 `docs/design/CREDENTIAL-HANDLING.md`，`H-33~H-35`）**—— ✅ 2026-09-27 六项完成**（W0-A 的"新增实现就红"断言按退档形态留待名单数据化，见该卡 §2） | 不拆税 —— **它决定后面每一批怎么做** | — | 六项**全部可执行**：ACC 四道门槛从"文风"变成"断言/清单"；重复度有名单；打包口径已写进文档；有界面时凭据不再明文 |
| **0** | **WP-0** 前端收敛 **+ `RL-01`**（**C1 同批**） | 速度 ← 无需亲历亲为 | 批次 -1 | 4 份重复对话框合一 + `ui/`/`tui/` 降为 fallback + **打包口径落定**；10 个 parity 测试全绿 |
| **1** | **WP-1** 四个便宜的面 · **`DL-01`** 目标可判定 · **`RL-02`** 拒绝六分类 · **`RL-04`** 两条回喂纪律 | 速度 ← 无需亲历亲为 **+** 自我驱动 | 批次 0（前端部分）；`DL-01` ← ACC-02 | 四子项各带回归断言；六类拒绝**各有唯一动作**（A1） |
| **2** | **WP-2** git · **WP-3** 前缀缓存 + G-03 工具面 · **`RL-03`** 三段式回传 · **`HL-03`** 三条硬规则 | 速度（+ 能力缺口） | 互相独立 | 前缀稳定性断言 + `MALFORMED` 不计熔断（A2）+ 降级必声明（A4） |
| **3** | **`DL-02`** 优先级 DAG · **`DL-03` 拒绝账本 + `HL-01` 失败账本（C3 同批）** · **`HL-02`** 五级阶梯 | 自我驱动 ← 无需亲历亲为 | 批次 1 / 2 | 熔断的是**指纹**不是工具（A3）+ 两账本**同键不同命**（A5） |
| **4** | **WP-4** 工作区四层（**先立快照语义统一卡，C5**）· **WP-5** 会话树 · **`HL-04`** 上报物料 | 自我驱动 | 批次 3；`HL-04` ← ACC-02/03 | 上报物料缺 **`Production producer`** 即红（A6） |
| **5** | **WP-6** 预设（**单独立卡 + 单独评审；消费 `DL-03`，C4**）· **WP-7** skill · **`DL-04`** 学习只变严 · **`HL-05`** 三级预算 | 安全 ← 自我驱动 | 批次 4 | "预设不得放宽到比全局更松"的断言；三级预算替换全局 `MAX_ROUNDS` |
| **6** | **WP-8** 出网与快照 · **WP-9** 沙箱后端（**C6：先过 ACC + 领 SEC 编号 + 立卡**） | 安全 ← 速度 | 两者强咬合：CubeEgress→WP-8 出网、cubecow→WP-8 快照 | 凭据不进沙箱 / 模板无凭据 / 出网默认拒绝 / **降级朝"更严"** |

> **进度（2026-10-01）**：批次 **-1 / 0 / 1 / 2 / 3 / 5 已关闭**；批次 **4 已关闭**（WP-5 ✅ · `HL-04` ✅ ·
> **WP-4 ✅**：四层模型 · 回滚纪律 · `allowedRoots`（含接入 `_confined`，带出并修掉 **SEC-021**）· 持久化 ·
> `/workspace` 命令面 · C5 规则 3 的如实声明）。
> 三层脊柱 **13/13 落地**（实施记录见 `docs/design/THREE-LAYERS.md` §9）。工具 **42 → 51**；`test_all` **2438 → 2733**。
> 命令表 **59 → 61**（`/preset` · `/escalation`），两条都走 `AgentCLI` 共用分发表 → 四外壳同一份；
> `agent_preset` 事件**四外壳全都有**（底栏段加在引擎侧，`status` 事件每次发全量分段 ——
> 不用每个外壳各画一份，各画一份正是"某个外壳忘了"的病根）。
> **WP-11 已开工**（MCP 安全子层：`ace_security_scan` / `ace_sandbox_exec` 上线，
> `e2e/mcp_probe.py` 46 条全过；**M8 读路径已由真 host（Cline）闭环**，台账 `mcp:external agent` 为证；
> 写路径待有意提权后走；沙箱真机冒烟 A5 待做 —— 需要一台部署了 CubeSandbox 的机器）。
> **未开始**：**WP-9** 沙箱后端（C6 前置未做，卡与 SEC-020 已立）· 横向 **WP-10**（R1 依据已被复测推翻）。
> **明确不做**（各有理由，不是没做完）：WP-4 的"进程内切 `project_root`"（半途实现会产生 C5 卡禁止的
> 两套回滚，理由见 `WP-4-SNAPSHOT-SEMANTICS.md` §6）· WP-8 的非 URL 出网通道（脆弱 shell 解析，H-27 的教训）。
> **部分**：**WP-8** —— 域名级出网 allowlist（G-12）**早已落地并接线**，只剩"闸门只管 URL、非 URL 通道不在内"这一半；快照 reflink 归 **WP-10 / cubecow 口径**。
| **横向** | **WP-10** Rust 核心化 | 安全 ← 速度（把安全成本压到接近零） | 前提**只剩 R-9** —— `engine/target/` 那条是 **R-6（虚警）**，且 `ci.yml:66` 的 `engine` job（`dtolnay/rust-toolchain` + offline build + `--selftest` + parity）**已存在** | §2.5 矩阵逐项 + **超范围路径必须被 Rust 自己拦住** |
| **前置/并行** | **ACC**（A0/A1/A2 已在批次 -1；A3 接 `DEVELOPMENT.md` 的"完成"定义） | — | — | **WP-9 依赖它**（§7 依据一最后一条） |

### 7.3 与旧表的差异（五条，全部是**排序**改动）

1. **新增批次 -1（闸门）** —— 旧表没有"决定别人怎么写"的位置，于是 ACC 的落点、WP-0 的范围、打包口径
   三件**纯决策**被混进了实现批次里。
2. **三层脊柱（`THREE-LAYERS`）首次有了批次位置**：`RL-01`→0、`DL-01`/`RL-02`/`RL-04`→1、
   `RL-03`/`HL-03`→2、`DL-02`/`DL-03`/`HL-01`/`HL-02`→3、`HL-04`→4、`DL-04`/`HL-05`→5。
   **旧表里三层脊柱一行都没有**，而 §0.5 称它是"**剩下的全部设计工作**"；现在它有了 6 个锚点。
3. **WP-4 / WP-5 从批次 3 顺延到批次 4**（让位给两个账本），**WP-6 / WP-7 从 4 到 5**（`C4`：WP-6 消费 `DL-03`），
   **WP-8 / WP-9 从 5 到 6**。原因：旧表把 WP-6 排在批次 4，而它的上游 `DL-03` **当时根本没有位置**。
4. **`§3.3` 的三条根因第一次有了归属**（见 §3.3 末尾补注）：①② 归 **WP-0**；③ 进**批次 -1**，
   已立卡 `docs/design/CREDENTIAL-HANDLING.md`（`H-33 ~ H-35`，接 H- 命名空间）。
5. **修正两处笔误/事实**：WP-10 前提的 `R-10` → **`R-6`**（§8 的 R-10 是"Rust 绕过权限层"，与 `engine/target/` 无关）；
   §8 **R-1** 的"8 个跨语言守卫测试" → **10 个**（实测：多出 `text`/`i18n`，而 `launcher` 读的是 `ace.cmd`）。

---

## 8. 风险登记

| # | 风险 | 缓解 |
|---|---|---|
| R-1 | **WP-0 动全部 4 个前端**，回归面最大 | 分批迁移、旧路径保持可用；**10 个**跨语言守卫测试（实测个数，见 §7.3 第 5 条）会立刻抓到不一致 |
| R-2 | **WP-4 的 worktree 与现有快照回滚会打架** → 两套回滚 | WP-4 开工前先做语义统一，单独立卡 |
| R-3 | **打包架空一半工作**：`ace.spec` 的 `datas` 无 `frontend/`，exe 只能跑 Python UI | 进 **§7.2 批次 -1**（`WP-0` W0-D）；**注意没有可增补的"构建产物"**（`npm run build` = `tsc --noEmit`）⇒ 必须三选一，见 `docs/design/WP-0-FRONTEND-CONVERGENCE.md` §0.2 ② 与 §2 W0-D |
| R-4 | **WP-6 改 `CONFIRM_TOOLS` 是动权限层** | 单独立卡 + 单独评审；不得削弱 S-1；必须有"预设不能放宽到比全局更松"的断言 |
| R-5 | **WP-5 改会话持久化格式** → 向后兼容 | entry 树带版本号 + 旧格式只读迁移路径 |
| R-6 | ~~`engine/target/` 构建产物~~ **已核实 = 非问题** | 实测 `git check-ignore -v engine/target` → `.gitignore:43:engine/target/`；`git ls-files engine/target` = **0 个跟踪文件**。磁盘上那 290 个 `.o` / 4 个 `.exe` / 4 个 `.pdb` 全是**未跟踪**的本地构建产物，不影响发布 |
| R-7 | **Rust 进发布包**会新增一条分发通道与体积成本 | 复用**既有** `release-executor.yml` 通道（不新开）；每平台产物带校验。**R1** 缺产物时降级到 Python 同口径实现；**R2** 缺产物时**显式拒绝该功能**，不许静默降级（硬契约 1 / 2） |
| R-8 | **WP-9 新增远程执行通道**（沙箱后端）—— 本路线图安全影响最大的一项 | 先立 SEC 卡 + 过全部 ACC 门槛；凭据不出本机；**故障降级朝"更严"**（降级到拒绝，不降级到无边界执行） |
| R-9 | **WP-10 让 Rust 成为必需** → 开发者与 CI 都需要 Rust 工具链；CI 时长与矩阵变复杂 | 终端用户**不需要**（预编译 + `ace --install-executor`）；CI 用 `dtolnay/rust-toolchain` + 缓存；R1 项保证"无 Rust 也能跑" |
| R-10 | **Rust 承担核心计算后绕过权限层**的风险（最危险的失效模式） | §2.6 授权模型：每次副作用携带 Python 签发的授权范围 + Rust 侧纵深防御再校验；WP-10 验收含"超范围路径必须被 Rust 自己拦住"的用例 |

---

## 9. 参照系索引（29 仓 → 学到了什么）

| 仓库 | 语言 | 主要贡献 |
|---|---|---|
| **pi** | TS | **产品面完整参照**（37 篇文档）：配置分层（project 覆盖 agent-dir、**资源列表合并**）、`SYSTEM.md`/`APPEND_SYSTEM.md`、prompt templates、skills(agentskills.io)、extensions、sessions 树三态、`steeringMode`/`followUpMode`。**且明说无内置权限系统** |
| Codewhale | Rust | **8 个 git 工具**；`prefix_cache.rs` 1220 行（前缀指纹 + 变化强制归因 + drift）；`ToolSurfaceBudget` + 延迟工具目录；`fleets/stopship.toml` 声明式舰队 |
| oh-my-pi | Rust+TS | `StablePrefix` **恒等快路径**（比较解析后的 parameters）；富读取器族（pdf/sqlite/archive/binary）；AST 编辑；`gh*` 族 |
| DeepSeek-Reasonix | Go | **`benchmarks/README.md` 649 行 / 5 个 harness**；**两份方法论契约**（指标语义 / 缺陷可达性 + 五种偷换）；`-meter` 环回代理自数 token 作可发布性门槛；`DefaultCacheTTL` 路由级 TTL |
| **CubeSandbox**（**腾讯云** `TencentCloud/CubeSandbox`，Apache-2.0，CNCF Landscape） | Rust | KVM MicroVM(RustVMM，自带内核) + CubeShim(containerd Shim v2)；**eBPF `dns_allow` 域名级出网** + CubeEgress L7 MITM；`cubecow` FICLONE reflink **O(1) 快照**；`agent/libs/safe-path`（Rust，symlink/TOCTTOU）；CubeTemplateCenter templates-from-sandbox；**自我定位"跑 agent 的沙箱，不是 agent 工具层"** → **WP-9 / WP-8 / LANG-04** |
| vibe-kanban | Rust | `Task → Workspace → Session → ExecutionProcess` 四层；`run_reason` 枚举；`LatestProcessInfo`；review 意见 → `spawn_follow_up` |
| orca | TS | `allowedRoots + registered worktrees` **文件系统授权**；attention 四件套（policy/contract/acknowledgement/notification-delivery）；**skill stub/guide 分离**防漂移 |
| kilocode | TS | `.kilo/agent/*.md` frontmatter + **per-agent permission**（WP-6 最佳参照） |
| opencode | TS | `Agent.Info{name, mode: primary\|subagent\|all, permission: Ruleset, model, prompt, steps}` |
| cline | TS | `mode.ts` plan↔act 切换（含 switch-source 跟踪 + session 重建 + 合成续接提示） |
| crush | Go | `question_choice_base` 选项实现（"自己输入"参照 A）；`itemCount = len(Choices)+1` |
| codex | TS | `RequestUserInput` / `is_other`（"自己输入"参照 B）；全局单调 seq + gap 检测 |
| aider | Python | auto-commit + `/undo`；`/model` 纯自由文本（"自己输入"参照 E） |
| qwen-code | TS | 向导式 `BaseUrlInputStep` + 就地 `baseUrlError`（"自己输入"参照 D） |
| 其余 15 仓 | — | 见 `.poc_reports` 与会话纪要；已并入结论，未单独产生 WP |

---

## 10. 开工检查单

- [ ] 确认 **§3.1 功能模块矩阵**（6 平面 / 38 模块）与 42 工具族分布
- [ ] 确认 **§0 四支柱兼得**（安全性 / 高速响应 / 自我驱动 / 无需亲历亲为）与其张力拆法
- [ ] 确认 §1 六条风格
- [ ] 确认 §2 六条语言裁决（**LANG-04：Rust 核心化**）
- [ ] 确认 §2.4 三层下沉（R1/R2/R3）与 **§2.6 授权模型**（Python 决定允许什么，Rust 在其内执行）
- [ ] 确认 §5 六条非目标（**NG-01：不自研，但要接 CubeSandbox**）
- [ ] 确认 **WP-9** 三层后端与四条安全验收（凭据不进沙箱 / 模板无凭据 / 出网默认拒绝 / **降级朝更严**）
- [ ] 确认 **WP-10** 的五条验收（尤其"超范围路径必须被 Rust 自己拦住"）
- [ ] 决定 R-3 打包口径（修打包 / 明确 exe 只带 Python UI）
- [x] WP-10 前提已核实：`engine/target/` 在 `.gitignore:43`，**0 个跟踪文件**（R-6 = 虚警）
- [x] 批次 0 立卡进 `docs/design/`（2026-09-27：`WP-0-FRONTEND-CONVERGENCE.md`；同批另立 `ACC-GATES.md`）
- [ ] 每个 WP 开工时：先读 `docs/DEVELOPMENT.md`(流程) + `docs/INTERFACES.md`(契约) + `docs/ADR.md`
- [ ] 每个 WP 完成时：`ruff + py_compile + test_all + bench --quick` 全绿 → 登记 `CHANGELOG.md` → push
