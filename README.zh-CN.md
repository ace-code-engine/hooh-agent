# HooH · 互

<div align="center">

<img src="assets/logo.svg" width="96" alt="HooH · 互" />

### 把安全边界放在模型**之下**的执行层。

**模型提出动作，代码裁决。**

[简体中文](README.zh-CN.md) · [English](README.md) · [更新明细](UPDATES.md) · [文档索引](docs/README.md) · [参与贡献](CONTRIBUTING.md)

[![CI](https://github.com/ace-code-engine/hooh-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/Version-1.2.1-7DA1DE)](https://github.com/ace-code-engine/hooh-agent/releases)
[![Release](https://img.shields.io/github/v/release/ace-code-engine/hooh-agent?label=Download&color=7DA1DE)](https://github.com/ace-code-engine/hooh-agent/releases)
<a href="CHANGELOG.md"><img alt="Latest" src="https://img.shields.io/badge/latest-v1.2.1%20(2026--10--31)-7DA1DE"></a>
[![License](https://img.shields.io/badge/License-MIT-7DA1DE)](LICENSE)
[![安全核心](https://img.shields.io/badge/safety%20core-zero--dep-orange)](docs/security/SECURITY-MODEL.md)
[![模型调用](https://img.shields.io/badge/model%20API-requires%20requests-blue)](docs/CONFIGURATION.md)
[![界面](https://img.shields.io/badge/界面-中%20·%20英%20·%20日-7DA1DE)](#三种外壳)
[![Security](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml/badge.svg?label=Security%20scans)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml)
[![CodeQL](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml/badge.svg?event=push&label=CodeQL)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml)
[![Bandit](https://img.shields.io/badge/Bandit-clean-4C1)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml)
[![pip-audit](https://img.shields.io/badge/pip--audit-clean-4C1)](https://github.com/ace-code-engine/hooh-agent/actions/workflows/security.yml)

</div>

---

## 它是什么

每一次工具调用 —— 文件、命令、出网、MCP —— 都要经过同一个裁决点：
**权限闸门 → 路径与敏感目标边界 → 写前物理快照 → HMAC 链式审计**。
安全核心是**纯标准库**：提示词失效时这道边界仍然成立（越狱、注入内容、被篡改的工具输出都改变不了它）。

> **互（HooH）** —— 两根横骨被一竖贯穿扣住：每一次动作都有对等回应，而且可逆。
> 先写快照，`/undo` 才谈得上意义。名字是致意，不是素材占用，见[下方说明](#名称与致意)。

## 和别的 Agent 差在哪

- **安全在模型之下、不在提示词里。** 权限、路径、沙箱、回滚都是 harness 代码。
- **默认只读。** 提权是人的动作（`/permission write`）。
- **每次写前物理快照 + `/undo`**，HMAC 签名，快照目录 Agent 自己不可写。
- **自我驱动。** 持久目标、子代理、知识库，一行命令切换 **9 家厂商 · 10 入口**。
- **三种外壳，一套引擎。** 完整的 dsh-TUI 多内核界面 / 经典瑞士规范前端 / 纯 Python 兜底，裁决链只有一个。

## 拿到手：双击就用

**不用看报错、不用装 Python、不用装 Node。** 下载安装包，双击装完，开始菜单点 **HooH**：

| 你的情况 | 下载 | 怎么用 |
|---|---|---|
| Windows，想直接用 | **`hooh-<版本>-windows-amd64.msi`** | 双击安装 → 开始菜单点 **HooH**（自带 Python 运行时 + 完整界面 + Node） |
| 便携党（解压即用，不装系统） | **`hooh-<版本>-windows-amd64.zip`** | 解压 → 双击 `ace.cmd` |
| 把 HooH 接进别的 agent（Cline / Claude Desktop / Cursor） | **`hooh-mcp-<版本>-<平台>.zip`** | 按 [docs/MCP-SERVER.md](docs/MCP-SERVER.md) 配置，只加边界、不改你的 agent |
| 源码党 | `git clone` 本仓库 | `hooh.cmd --mock` 离线体验 / `hooh.cmd` 接真模型 |

**只发这几个文件**；MSI 自包含（引擎 + 整壳界面 + Node 运行时全在里面），装完离线也能跑 `--mock`。

**[下载最新版](https://github.com/ace-code-engine/hooh-agent/releases)** · [更新明细](UPDATES.md) · [提 issue](https://github.com/ace-code-engine/hooh-agent/issues/new/choose)

## 30 秒上手

```text
双击 HooH（或终端里敲 ace）
  ↓
首屏输入一句话，回车
  ↓
要写文件/跑命令时，HooH 会先弹审批 → 同意后先拍快照 → 再动手
  ↓
不满意？/undo 回滚到动手前
```

源码运行：`hooh.cmd --mock`（离线演示，不需要密钥不需要网络）· `hooh.cmd`（接真模型，向导引导）。
终端里的斜杠命令全集见 **[docs/COMMANDS.md](docs/COMMANDS.md)**。

## 它到底能干什么

- **干**：文件、命令、代码、出网检索、文档解析（Word/Excel/PPT/PDF）、SQLite、浏览器——每一项都过裁决链；
- **守**：默认只读，提权需人确认；每次写前快照（HMAC 链式审计），`/undo` 一键回滚；
- **驱动**：持久目标（断电续跑）、子代理、任务树、知识库、计划模式；
- **接**：MCP 服务端（把裁决边界借给别的 agent）、事件钩子、自定义命令与技能；
- **换**：9 家模型厂商 · 10 入口一行切换；中/英/日三语界面。

**HooH 能挡什么 / 挡不住什么？** 看 **[docs/security/SECURITY-FAQ.md](docs/security/SECURITY-FAQ.md)**——11 问逐条说清。

## 三种外壳

| 外壳 | 入口 | 长什么样 | 适合 |
|---|---|---|---|
| **整壳应用**（默认） | 双击 HooH / `ace` | dsh-TUI 多内核界面：落地页、流式 Markdown、工具卡片、状态栏、命令面板 | 日常使用 |
| **经典前端** | `ace classic` | 瑞士规范界面：主屏两车道、一屏一个强调色 | 备用（功能冻结，只修 bug） |
| **纯 Python 兜底** | `ace --no-tui` | 传统 REPL，无任何 UI 依赖 | 脚本/CI/老旧终端 |

三种外壳背后是**同一个引擎、同一条裁决链**——界面可以换，安全边界不跟着换。

## 文档

| 想找什么 | 去这里 |
|---|---|
| 5 分钟上手 · 十个经典陷阱 | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) |
| HooH 能挡什么 / 挡不住什么 | [docs/security/SECURITY-FAQ.md](docs/security/SECURITY-FAQ.md) |
| 分层架构 · 完整目录树 · ADR | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 全部命令与参数 | [docs/COMMANDS.md](docs/COMMANDS.md) |
| 全部配置项 | [docs/CONFIGURATION.md](docs/CONFIGURATION.md) |
| 为什么是 HooH · 对比提示词护栏 | [docs/WHY.md](docs/WHY.md) |
| 能力清单 | [docs/CAPABILITIES.md](docs/CAPABILITIES.md) |
| 打包与发行（MSI / zip / MCP / 沙箱） | [docs/PACKAGING-EXE.md](docs/PACKAGING-EXE.md) |
| 测试 · CI · 承诺守卫 | [docs/TESTING.md](docs/TESTING.md) |
| 工程债 · 交接 | [docs/HANDOFF.md](docs/HANDOFF.md) |
| 全部文档索引 | [docs/README.md](docs/README.md) |

## 参与贡献

踩到坑、有想法、想加功能——都在 **[CONTRIBUTING.md](CONTRIBUTING.md)**：
环境搭建 → 标准流程 → 加工具八步清单 → 提 PR。
大版本的用户可见变化汇总在 **[UPDATES.md](UPDATES.md)**；技术明细在 [CHANGELOG.md](CHANGELOG.md)。

> 作者是学生：工作日要上课，issue / PR 一般集中在周末处理，消息看到了都会记下，不用急。

## 安全扫描（权威线）

CI 里有独立于测试的 **Security 工作流**，四条权威扫描并行跑、结果进 GitHub Security tab：

| 扫描器 | 扫什么 | 权威性 |
|---|---|---|
| **CodeQL**（GitHub 官方） | Python + TypeScript 的静态污点/注入分析（security-extended 规则集） | GitHub 原生 SAST，结果可复核 |
| **Bandit** | Python 专项 SAST；中危+中置信即红线（每条例外都带 `# nosec` + 补偿控制说明，人工 triage） | 行业标准 Python SAST |
| **pip-audit** | 依赖 CVE（requirements 锁定的运行时 + 构建环境逐包） | PyPA 官方审计工具，`--strict` |
| **OpenSSF Scorecard** | 供应链成熟度（分支保护 / 依赖 pinned / SAST 存在 / 令牌权限） | OpenSSF 基础设施发布、公开可查 |

每一条都**常驻 CI 门禁**：任何一条变红，PR 合不进去；不是"跑过一次贴个图"。

> OpenSSF Scorecard 的徽章**暂时不挂**：当前 2.1 分，扣分的那些项基本是仓库流程问题（分支保护、必须评审、依赖更新机器人、仓库里不留二进制），不是代码问题。扫描照常跑、结果进 Security tab；分项现状和"要多少分得做哪些事"记在 [docs/BACKLOG.md](docs/BACKLOG.md) 的 `WISH-01`。

## 安全

- 默认只读；每次写前物理快照，失败可回滚，快照目录 Agent 自己不可写；
- 权限闸门、路径与敏感目标边界、HMAC 链式审计——全部在 harness 代码里，不在提示词里；
- 出网只走单一闸门（pin-to-IP + 逐跳复检）；命令三值判定（allow / prompt / forbidden）；
- 完整安全模型见 **[docs/security/SECURITY-MODEL.md](docs/security/SECURITY-MODEL.md)**，发行包承诺见 **[SECURITY.md](SECURITY.md)**。

## 名称与致意

**HooH（互）** 是**致意，不是素材占用**。「互」就是这套系统的形状：模型提出、代码裁决；
先写快照，`/undo` 才谈得上意义。仓库内**不含任何米哈游素材**——这句只说**命名与素材**，
不等于本仓没有第三方代码：改编的源码与文案另见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。
视觉语言（「互」字几何构图，三横一竖）从零画出，没有描摹、没有提取、没有二次分发。

> 作者本人是米哈游长期玩家，这个名字是向《崩坏：星穹铁道》"均衡"星神致意。
> 如果米哈游（或任何权利人）认为这个命名不妥，**提一个 issue 就会改**——不争辩、不拖延。

## License

[MIT](LICENSE) © 2026 jincheng3870682453-hash

第三方许可声明：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) —— 本仓既分发未修改的第三方
wheel，也**改编**第三方源码与文案，逐条见该文件。
