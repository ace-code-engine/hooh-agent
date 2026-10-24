# 上手路径（Getting Started）

> 写给"第一次打开这个仓库的人"。目标很具体：**5 分钟跑起来 → 30 分钟搞懂三道闸门 → 按场景抄一条配置**。
> 深度材料各有房间：安全 → [SECURITY-MODEL.md](security/SECURITY-MODEL.md)、配置 → [CONFIGURATION.md](CONFIGURATION.md)、
> 命令 → [COMMANDS.md](COMMANDS.md)、架构 → [ARCHITECTURE.md](ARCHITECTURE.md)、测试 → [TESTING.md](TESTING.md)。

## 0 · 五分钟：不配任何密钥跑起来

```bash
git clone https://github.com/ace-code-engine/hooh-agent.git && cd hooh-agent
python test_all.py          # 全量测试（纯 stdlib）。受限环境会列出跳过项，那不是失败
python ai_code.py --mock    # 离线演示：提问 → 调工具 → 作答 → /status 一条龙
python -m cli.ace_doctor    # 环境自检：Python / 可选依赖 / Go 执行器 / Docker / 配置
```

跑完这三条，你就已经看过"模型 ↔ 执行层"的完整闭环了——**不需要任何 API Key**。

## 1 · 三十分钟：先分清三个正交维度

HooH 的所有配置混乱几乎都来自把这三件事混成一件事：

| 维度 | 回答的问题 | 档位 | 默认 |
|---|---|---|---|
| `permission` | 这个工具**准不准用** | `readonly` / `write` / `full` | **`readonly`** |
| `sandbox` | 命令**跑在哪** | `off` / `job`（Windows）/ `docker` | **`off`** |
| `approval_policy` | **要不要问人** | `on_request` / `on_failure` / `never` / `untrusted` | **`on_request`** |

一句话记法：**permission 管"能不能用"，sandbox 管"跑在哪"，approval 管"问不问人"。** 三者互相独立，可以任意组合：

- `--permission write --sandbox off` = 能写能跑，但只有进程内策略（默认形态）
- `--permission readonly --sandbox docker` = 只读，但连只读命令都跑在容器里（多半没必要）
- `--permission write --sandbox job` = 能写能跑，且命令在 Windows Job Object 里
- `--approval-policy never`（从不问人）**必须**配 `--sandbox job|docker`：`never` + `off` 会被**拒绝启动**（"没人 + 没边界"没有可辩护的用途，退出码 2）

## 2 · 按场景抄一条命令

| 你想干什么 | 命令 | 为什么这么配 |
|---|---|---|
| 第一次试用 | `python ai_code.py --mock` | 离线、零风险、不用密钥 |
| 读别人的代码、更谨慎的场合 | `python ai_code.py --permission readonly` | 写工具直接 403 |
| 让它改自己的项目 | `python ai_code.py`（默认 `write`） | 项目内写免确认；每次写前自动快照，`/undo` 一键回滚 |
| 跑它给的命令 | `--permission write --sandbox job`（Windows）/ `--sandbox docker` | 真内核边界；拿不到边界就 503，**绝不回退宿主** |
| 接真实模型 | `python ai_code.py` → 首页选 `2` 走配置向导 | 需要 `pip install requests`；或直接 `/provider deepseek <key>` |
| 只让它干一件小事 | `python ai_code.py --input "现在几点"` | 单轮、非交互 |
| CI / 无人值守 | `--sandbox docker --approval-policy on_failure` | 默认档在非交互下**需要审批的动作会被直接拒绝**，见 §4 |

## 3 · 该懂的七件事

1. **默认 `write`（项目内），从严可以调回去。** 项目内的写有写前快照兜底 = 可逆 = 免确认（WP-AGENCY，2026-10-24）；**不可逆 × 项目外**的动作仍逐次确认（见第 4 条）。想更严用 `--permission readonly`；提权到 `full` 是**人的动作**（`/permission full`、`F1`），模型只能 `request_permission` 求你。headless 通道（`--mcp`）默认仍是 `readonly`。
2. **写前自动快照。** 每次写操作都留物理快照：`/snapshots` 看列表，`/undo` 回滚最近一次；`.guardian/` 目录 Agent 自己改不了。回滚范围**就是那一轮动过的路径** —— 你同时自己改的文件不会被一起退回去（H-08）。用 `terminal_exec` / `code_execute` 这类"能任意写盘"的工具时范围说不清，会退回整树还原：宁可多退，不可少退。
3. **`terminal_exec` 每次都问。** 它的危险命令黑名单可被引号/长选项/变量展开绕开，所以"人看一眼"是唯一有效防线——它不接受会话级授权。
4. **外发要人点头。** 数据发往模型指定的目的地（`api_post`/`api_get`/`browser_*`/`notify_send` 的 email）、以及**覆盖/删除项目外已存在的文件**，都会逐次确认；配 `egress_allowlist` 等于把这件事一次性授权掉。
5. **三档沙箱的真实差别。** `off` = 进程内策略层（不是隔离）；`job` = Windows Job Object（进程树/内存上限 + 受限令牌）；`docker` = 一次性容器（network none + 只挂工作目录）。**拿不到边界一律 503，不静默回退**——这是设计，不是 bug。
6. **Agent 自己的状态不可写。** `.guardian/`（快照）、`.ace_sessions/`（审计日志）、`.ace_goals.json`、`.agent_memory.json` 对文件工具一律 403：让被审计方改不了自己的记录。
7. **安全拦截会告警。** 403 里"执行层主动防御"与"参数写错"分开计数，本会话累计到阈值会明确告警——那通常意味着有东西在借被读取的文件/网页注入指令。

## 4 · 新手最容易踩的十个坑

1. **"我让它写文件，它说 403"** —— 默认 `write` 下项目内写不该 403；真遇到，看理由：**项目外 / 敏感目标**（该走的确认没走）或你显式配了 `readonly`（`/permission write` 提权）。
2. **管道 / CI 里 `terminal_exec` 用不了** —— 非交互下审批统一 fail-close（拒绝）。要无人值守就得给真边界：`--sandbox docker` + `--approval-policy on_failure`。
3. **`--sandbox job` 在 Linux/macOS 上不存在** —— Job Object 是 Windows 专有原语；启动时会提示，改用 `--sandbox docker`。
4. **接不了真实模型** —— 缺 `requests`；`python ai_code.py --install-ui` 还能顺手装补全。
5. **`egress_allowlist` 不配 ≠ 不设防** —— 不配时闸门关闭，但外发仍会逐次问人；配了之后清单内直接放行、清单外 403。
6. **项目外的新建不打扰，覆盖已存在才问** —— 绝对路径算"明确意图"，但不许悄悄毁掉项目外已经在那儿的文件。
7. **凭据类文件读不了也写不了** —— `.pem` / `.key` / `~/.ssh` / `~/.ai_code.json` 即便在项目内也拦。
8. **`/provider` 显示的是"9 家厂商 · 10 入口"** —— 智谱占两个入口（Anthropic / OpenAI 兼容各一），所以入口数比家数多。
9. **配置要写进 `~/.ai_code.json` 才持久** —— 优先级：命令行参数 > `~/.ai_code.json` > `~/.claude/settings.json` > 环境变量。所有键都会透传进执行层（v3.8.x 之前有 7 个键写了不生效，已修并有断言）。
10. **沙箱镜像不用自己 build 了** —— 缺失时会自动拉官方预编译镜像 `ghcr.io/ace-code-engine/hooh-sandbox`（公开、匿名可拉，不需要 `docker login`）。本地已有的镜像永远优先，所以自己 build 过的机器行为不变；要完全离线就 `ACE_SANDBOX_PULL=0`，再 `docker build -t ace-sandbox:latest -f docker/Dockerfile.sandbox .`。

## 5 · 接下来去哪

| 想做的事 | 入口 |
|---|---|
| 照剧本动手看行为 | [examples/](../examples/README.md)（安全实验室 / 文档解析 / 多轮任务） |
| 搞懂安全边界与诚实限制 | [SECURITY-MODEL.md](security/SECURITY-MODEL.md)（含「无人值守 / 自动化部署」「静态检测的边界」） |
| 配 `~/.ai_code.json` | [CONFIGURATION.md](CONFIGURATION.md)（含三维度矩阵与各键语义） |
| 找回某个命令 / 启动参数 | [COMMANDS.md](COMMANDS.md) |
| 参与开发 | [DEVELOPMENT.md](DEVELOPMENT.md) + [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| 看测试与 CI 怎么保证这些说法 | [TESTING.md](TESTING.md)（`[38]/[39]/[40]` 三节守卫） |
