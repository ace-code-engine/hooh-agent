# 安全策略(Security Policy)

ACE 把“权限/沙箱/回滚下沉到执行层”当第一原则,因此安全反馈会严肃对待。

## 报告漏洞

- 请勿公开透露未修复漏洞细节;优先创建 **Private vulnerability report**(GitHub 仓库 Settings → Security → Vulnerability alerts → New draft security advisory),或直接邮件维护者。
- 请附:触发条件(最好是可复现的最小代码片段)、影响、你运行的环境(OS/Python/是否开沙箱档)。

## 我们承诺

- 确认后 7 天内给出修复计划;P0(可致 RCE/越界读/凭据泄漏)会优先处理并尽快发补丁。
- 修复会补回归测试并记入 CHANGELOG(安全条目)。

## 已知边界(非漏洞)

- 不开 `--sandbox docker/job` 时,`code_execute`/`terminal_exec` 只是进程内策略层,**不是 OS 级隔离**(详见 [`docs/SECURITY-MODEL.md`](docs/security/SECURITY-MODEL.md)「容器隔离 / Job Object 隔离」)。这类用法下的逃逸属设计边界,部署方应开对应沙箱档。
- **无人值守（非交互 / CI）的暴露面与直觉相反**:需要审批的动作会被**直接拒绝**(`terminal_exec`、外发确认、项目外覆盖确认在 CI 里走不通),而**不需要审批**的写/执行工具(`file_write` / `code_execute` / `api_post` …)照跑,只受进程内策略约束。要跑无人值守请显式给 `--sandbox job/docker`(可配 `--approval-policy on_failure`),或用 `readonly` 起步。
- **静态检测不可能闭合**:`code_execute` 的 AST 引用级拦截、`execpolicy` 的命令判定、出站清单都是模式/静态层——抬高成本、挡住已知形态,但枚举不完;复杂或多步拼装的恶意行为不在射程内。真正的边界是 OS/容器档 + 最小权限账户。
- **名称是致敬,不含第三方素材**：项目名 **HooH（互）** 是向《崩坏：星穹铁道》"均衡"星神
  的同名致意,作者本人是米哈游玩家。仓库内**不含任何米哈游素材**——图标
  [`assets/logo.svg`](./assets/logo.svg) 是按本项目自身视觉语言从零画的「互」字几何构图
  (两笔交错 + 一竖贯穿),非描摹、非提取、非二次分发。名称本身是短词,不构成版权客体;
  若权利人认为该命名不妥,**提一个 issue 即可改名**,不做争辩。
  (这句只针对**命名与素材**;第三方代码与文案的来源与许可见
  [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md),不要读成"本仓无任何第三方内容"。)
- **这份仓库的安全文档是自评,不是第三方审计**:`docs/SECURITY-AUDIT.md` 的 19 条结论逐条有证据(其中可自动化的 payload 已钉成 `test_all [40]` 断言),但"没被断言覆盖的结论"仍只是当时的实测记录。生产使用前请走自己的安全评估与红队演练(可从上表与审计报告的 payload 清单开始)。
