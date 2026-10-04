# 文档索引

> 这份索引只回答一个问题：**我想干的事，该读哪一篇？**
> 仓库根的 `README.md` 是产品名片（给第一次来的人）；本页是全部文档的分流入口。
> **没找到对应场景时，先看 [`ARCHITECTURE.md`](ARCHITECTURE.md)** —— 它是权威目录树与分层职责的唯一来源。

## 我想…

| 我想… | 读这篇 |
|---|---|
| 先跑起来看看 | [`GETTING-STARTED.md`](GETTING-STARTED.md) —— 5 分钟路径 + 三维度矩阵 + 十个坑 |
| 看它长什么样 | [`SHOWCASE.md`](SHOWCASE.md) —— 全部来自真实 `--mock` 会话的演示图 |
| **知道它到底挡住了什么、没挡住什么** | [`security/SECURITY-FAQ.md`](security/SECURITY-FAQ.md) |
| 查某条命令 / 启动参数 | [`COMMANDS.md`](COMMANDS.md) |
| 改配置项 | [`CONFIGURATION.md`](CONFIGURATION.md) |
| 写自己的工具 / 命令 / 插件 | [`EXTENDING.md`](EXTENDING.md) · [`INTERFACES.md`](INTERFACES.md) |
| 让别人、或别的 agent 用 HooH | [`MCP-SERVER.md`](MCP-SERVER.md) |
| 知道代码怎么分层 | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| 参与开发、提交代码 | [`DEVELOPMENT.md`](DEVELOPMENT.md) · [`TESTING.md`](TESTING.md) |
| 打包发布 | [`PACKAGING.md`](PACKAGING.md) · [`PACKAGING-EXE.md`](PACKAGING-EXE.md) |
| 看某个版本改了什么 | [`releases/`](releases/)（逐版本更新介绍）· [`../CHANGELOG.md`](../CHANGELOG.md) |
| 知道接下来要做什么 | [`ROADMAP.md`](ROADMAP.md)（能力路线图）· [`BACKLOG.md`](BACKLOG.md)（战术待办） |
| 接手某块未完成的工作 | [`HANDOFF-FRONTEND.md`](HANDOFF-FRONTEND.md) · [`HANDOFF-R-03.md`](HANDOFF-R-03.md) |
| 对齐 Claude Code 的键位 | [`KEYMAP-CLAUDE-PARITY.md`](KEYMAP-CLAUDE-PARITY.md) |
| 深读安全 | [`security/SECURITY-MODEL.md`](security/SECURITY-MODEL.md) · [`security/SECURITY-AUDIT.md`](security/SECURITY-AUDIT.md) |
| 上报漏洞 | [`../SECURITY.md`](../SECURITY.md) |

---

## 按目录分组

### 入口与演示

| 文件 | 是什么 |
|---|---|
| [`GETTING-STARTED.md`](GETTING-STARTED.md) | 上手路径：5 分钟跑起来 + 三维度矩阵（permission / sandbox / approval_policy）+ 十个经典坑 |
| [`SHOWCASE.md`](SHOWCASE.md) | 演示与截图；每张图都由 `demo/record_demo.py` 生成，`--check` 在 CI 里防它腐化 |

### 安全（`security/`）

| 文件 | 是什么 |
|---|---|
| [`security/SECURITY-FAQ.md`](security/SECURITY-FAQ.md) | **安全边界 FAQ（11 问）**：挡住了什么、没挡住什么；每条都写明去哪段代码核实 |
| [`security/SECURITY-MODEL.md`](security/SECURITY-MODEL.md) | 完整安全模型：权限 / 隔离 / 路径 / 网络 / 沙箱 + 生产部署必读 |
| [`security/SECURITY-AUDIT.md`](security/SECURITY-AUDIT.md) | OWASP + STRIDE 逐条审计；**部分是某一天的实测记录**，以代码为准 |
| [`security/SECURITY-SCAN-2026-10-04.md`](security/SECURITY-SCAN-2026-10-04.md) | 自查扫描记录：`ace_security_scan` 扫本仓库；**口径是路径级**（干净 ≠ 安全）+ 两条工具反馈 |

### 架构决策（`adr/`）

| 文件 | 是什么 |
|---|---|
| [`adr/ADR.md`](adr/ADR.md) | 架构决策记录（内联序列 001–006） |
| [`adr/ADR-002-executor-boundary.md`](adr/ADR-002-executor-boundary.md) | 执行器进程边界 / NDJSON 协议 / Windows 沙箱选型 |

### 开发与运维

| 文件 | 是什么 |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | **权威目录树** + 分层职责 + ADR 索引（架构图与完整树以它为准） |
| [`INTERFACES.md`](INTERFACES.md) | 接口与类型契约：文本协议 / 状态码 / 注册表 / 权限模型 / 网络 |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | 标准化流程：改代码到推送八步 + 新增工具八步清单 |
| [`TESTING.md`](TESTING.md) | 测试：全量 / CI 矩阵 / 基准 / e2e / ruff |
| [`EXTENDING.md`](EXTENDING.md) | 扩展点：事件钩子 / 自定义命令 / 插件 / MCP（边界写清楚） |
| [`COMMANDS.md`](COMMANDS.md) | 命令参考：斜杠 / `@` 全表 + 启动参数 |
| [`CONFIGURATION.md`](CONFIGURATION.md) | 配置全项：config 键 + 出站白名单 / 检索 / 编码 / DB 边界 |
| [`MCP-SERVER.md`](MCP-SERVER.md) | `ace --mcp` 使用说明：三种 host 的配置片段 / 两个旋钮 / 排障 / 真 host 冒烟清单 |
| [`PACKAGING.md`](PACKAGING.md) | 打包与分发评估 |
| [`PACKAGING-EXE.md`](PACKAGING-EXE.md) | Windows 发行包：PyInstaller 单目录 + 冒烟门禁 + 冻结后能力表 |

### 规划与待办

| 文件 | 是什么 |
|---|---|
| [`ROADMAP.md`](ROADMAP.md) | **能力路线图**：四支柱兼得定位 / 语言裁决 / 功能模块矩阵 / 缺口 / 工作面 WP-0~WP-10 / 批次 |
| [`BACKLOG.md`](BACKLOG.md) | 战术待办（SEC- 安全 / Q- 快速项 / R- 结构 / REL- 发布） |
| [`BACKLOG-P2.md`](BACKLOG-P2.md) | P2 重构立项卡（R-01~R-05 范围 / 验收 / 顺序） |
| [`releases/`](releases/) | 逐版本更新介绍（37 篇，可直接贴进 GitHub Release） |

### 立项卡（`design/`）

已闭环的历史设计决策与**在途立项**，各一篇。

| 文件 | 是什么 |
|---|---|
| [`design/WP-0-FRONTEND-CONVERGENCE.md`](design/WP-0-FRONTEND-CONVERGENCE.md) | **前端收敛（`WP-0`，批次 0 前置）**：重复点名 / 协议消费 / 打包三选一 |
| [`design/ACC-GATES.md`](design/ACC-GATES.md) | **验收门槛（`ACC-01~04`）**：自报 token ↔ 实测 / 指标语义五要素 / 缺陷可达性六要素 / 五种偷换 |
| [`design/CREDENTIAL-HANDLING.md`](design/CREDENTIAL-HANDLING.md) | **凭据回显边界（`H-33~H-35`）**：向导 `hidden` 全程丢失 / 两条泄漏路径 / 断言只钉声明 |
| [`design/THREE-LAYERS.md`](design/THREE-LAYERS.md) | **三层脊柱设计卡**：驱动层 / 响应层 / 自愈层 + 两个共用账本 + 五级升级阶梯 |
| [`design/WP-0-TAIL-TECH.md`](design/WP-0-TAIL-TECH.md) | **WP-0/ACC 尾活技术难点与解法**：切片 C 终端权限提示统一 + benchmarks 校验器接法 |
| [`design/WP-4-SNAPSHOT-SEMANTICS.md`](design/WP-4-SNAPSHOT-SEMANTICS.md) | **WP-4 前置（C5）**：快照语义统一 —— worktree 与既有回滚不能是两套 |
| [`design/WP-6-AGENT-PRESETS.md`](design/WP-6-AGENT-PRESETS.md) | **WP-6 立项卡（C4）**：per-agent 权限预设 + **S-1 只许更严**（改权限层，高风险） |
| [`design/WP-9-SANDBOX-BACKEND.md`](design/WP-9-SANDBOX-BACKEND.md) | **WP-9 立项卡（C6）**：三层沙箱 + **SEC-020**；S-1 边界（外包执行边界可以，外包决定权不行） |
| [`design/CONFIRM-BOUNDARY.md`](design/CONFIRM-BOUNDARY.md) | 确认与只读边界加固（H-27~H-31） |
| [`design/SAFETY-HARDENING.md`](design/SAFETY-HARDENING.md) | 安全边界加固（H-01~H-22 审计证据 / 工作包 / 验收） |
| [`design/RGTC-LANDING.md`](design/RGTC-LANDING.md) | 信任锚外移 / 链式台账 / 来源归属 / 可逆性分类器 / 授权令 |
| [`design/STRUCT-REFACTOR.md`](design/STRUCT-REFACTOR.md) | P2 结构重构（R-01~R-05 实测规模 / 顺序 / 验收） |
| [`design/ARCH-TREE-CHECK.md`](design/ARCH-TREE-CHECK.md) | 权威树一致性校验（Q-06：R1–R4 规则 / 实测缺口） |
| [`design/MCP-SERVER.md`](design/MCP-SERVER.md) | MCP server 立项卡（暴露面 / 审批矩阵 / 非目标 / 验收） |
| [`design/ACE-MCP-SEC-SUBAGENT.md`](design/ACE-MCP-SEC-SUBAGENT.md) | **WP-11 立项卡**：HooH 作为 MCP 安全子层 + 共用 CubeSandbox 底座；**SEC-022**（扫过 ≠ 安全）（文件名保留旧前缀，历史文档不改名） |
| [`design/EXECUTOR-RELEASE.md`](design/EXECUTOR-RELEASE.md) | 执行器发布通道（预编译二进制 + `ace --install-executor`） |
| [`design/README-RESTRUCTURE.md`](design/README-RESTRUCTURE.md) | README 瘦身两轮立项（本结构由此演进） |

### 历史归档（`history/`）

| 文件 | 是什么 |
|---|---|
| [`history/SESSION-2026-09-06.md`](history/SESSION-2026-09-06.md) | 评审会话纪要（风险清单 → 决策 → 提交 → OPEN） |
| [`history/UI-CHAT-SCROLL.md`](history/UI-CHAT-SCROLL.md) | 聊天内置滚动立项卡（引擎已实现，接线待真机） |
| [`history/codex_research.md`](history/codex_research.md) | Codex 源码调研（45+ 可借鉴设计） |
| [`history/dsh_research.md`](history/dsh_research.md) | DeepSeek Harness 源码调研（62 项可借鉴设计） |
| [`history/prompt-engineering/`](history/prompt-engineering/) | 提示词工程规范 v1→v7 + 上下文包（历史归档） |

### 交接

| 文件 | 是什么 |
|---|---|
| [`HANDOFF-FRONTEND.md`](HANDOFF-FRONTEND.md) | Ink 前端（`frontend/` + `ace --serve`）的交接提示词：自包含、含「未完成 / 未验证」清单 |
| [`HANDOFF-R-03.md`](HANDOFF-R-03.md) | 双前端客户端合并（R-03）的交接提示词：自包含、可直接粘给另一个会话 |

### 界面设计

| 文件 | 是什么 |
|---|---|
| [`HOME-DESIGN.md`](HOME-DESIGN.md) | 主页设计：分区顺序为什么是这样、每条信息为什么在这个位置 |
| [`KEYMAP-CLAUDE-PARITY.md`](KEYMAP-CLAUDE-PARITY.md) | 键位对照表（Claude Code ↔ HooH，逐条核实 + 不做的理由） |

---

## 维护约定

- **新增文档要登记**：`ARCHITECTURE.md` 的权威树里，**已展开目录**的直接子项必须全部登记，
  否则 `test_all.py --only 38` 会红（这是故意的：树会随文件漂移，守卫不让它漂）。
- **不展开就免登记**：像 `releases/` 这样只列一行、不列子项的子目录，不需要逐文件登记。
- **动文档要复验**：`python test_all.py --only 38,39,68`
  （结构一致性 / 数字单一来源 / 无乱码）。
