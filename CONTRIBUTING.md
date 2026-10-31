# 参与贡献 · Contributing

> **给未来的人**：如果有一天我不再维护这个仓库，那大概率是我认为它已经足够好了。
> 但"我认为的足够好"只代表一个维护者的判断，不代表大公司、也不代表你——里面一定还有
> 没被发现的漏洞。发现了，请提 issue。

**10 分钟看懂项目骨架**：[docs/for-contributors.md](docs/for-contributors.md)（架构速览：一次工具调用怎么走、三层怎么接、怎么加东西）——没有的话先读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 我该从哪开始

| 你想做的事 | 走这里 |
|---|---|
| 报一个 bug | [提 issue](https://github.com/ace-code-engine/hooh-agent/issues/new/choose)——模板会要版本、系统、完整报错；能用 `--mock` 复现最好 |
| 加一条命令 / 一个工具 | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 的八步清单（工具唯一真源 = `tools/registry.py`） |
| 改界面（整壳 / 经典前端） | `frontend/dsh-ui/`（dsh-TUI 树）或 `frontend/src/`（经典），见 [docs/design/DSH-SHELL-TRACKING.md](docs/design/DSH-SHELL-TRACKING.md) |
| 写文档 / 修文案 | 直接改 `docs/`，PR 即可；用户可见文案要走 `locales/`（i18n） |
| 提大方向建议 | 先看 [docs/BACKLOG.md](docs/BACKLOG.md) 和 [docs/ROADMAP.md](docs/ROADMAP.md)——已经排上队的不用重复提 |

## 环境准备

- Python ≥ 3.10（建议 3.11/3.12）；**安全核心**（执行层/网关/记忆/CLI）零第三方依赖，跑测试不需要额外安装；
- **模型调用需要 `requests`**——没有它两个前端都连不上模型（报裸 `ImportError`）；`python setup_env.py --ensure` 一并装好；
- 可选：`prompt_toolkit`（`/` 与 `@` 实时补全菜单，`ace --install-ui`）；
- 本机无系统 Python 时可用 `uv`（`uv python install 3.12` 后以该解释器运行）；
- 前端（整壳 / 经典）需要 **Node ≥ 18**：`cd frontend && npm install`。

## 跑测试与校验（提交前本地全过）

```bash
python test_all.py                          # 全量端到端测试（退出码非 0 即失败）
python test_all.py --strict                 # 把"能力不足跳过"当失败（CI/严格复现）
python benchmarks/bench_core.py --quick     # 基准健康；正确性 check 失败退出码非 0
ruff check . --select E9,F63,F7,F82,F401,F841,E711,F811   # CI 同款;F401/F841 用 ruff --fix
python -m compileall -q <改动的模块>          # 编译检查
cd frontend && npm test                     # 前端门禁（692 条，含整壳冒烟）
python e2e/real_model_smoke.py              # 真实模型冒烟（需 ACE_E2E_* env，缺省跳过）
```

- 用例总数**随平台浮动**，不写死数字——看退出码与失败列表。
- 受限环境（无 Go Job Object / 禁联网 / 系统临时区只读）下，测试应优雅跳过并如实标注，
  不许假绿、不许整脚本 traceback；临时目录统一落 `.test_tmp/`。
- 改了行为就把断言旧行为的用例一起改，不要只加新例。

## 代码纪律（摘要；细节见 docs/）

- **工具唯一真相源 = `tools/registry.py` 的 `TOOL_SPECS`**：新增工具在 registry 加一条 +
  实现 handler（八步清单见 `docs/DEVELOPMENT.md` §2）。禁止手写第二份
  function schema / 权限集合 / 提示词工具清单。
- 对外边界返回 `tools.result.ExecutionResult`；内部逻辑用异常。
- 类型注解补全；用户可见文案走 i18n，不许用中文 message 子串承载错误语义。
- 读/检索类工具必须过与 `file_read` 同口径的路径闸门；执行类工具不许只靠 AST 精确名
  拦截，要叠 Go 执行器 job/docker 权界或引用级白名单（历史教训见 BACKLOG SEC-01/02）。
- 新模块用 `ace_` 前缀、小写下划线；旧名（`archive/nuwa/work/...`）不再新增同类。
- **界面改版不动裁决链**：`frontend/` 只画不判——权限、快照、审计永远在引擎侧（这是本仓
  的架构主张，见 [docs/WHY.md](docs/WHY.md)）。

## 提交流程

1. 从 `main` 切分支：命名 `feat/xxx` / `fix/xxx` / `docs/xxx`。
2. 改动后本地跑完上面"跑测试与校验"一段，全绿。
3. 提交信息 = 中文一句话主题（带前缀）+ 要点列表（参考 `git log`）。
4. push 后等 GitHub Actions：Python 3.10/3.11/3.12 全量测试 + ruff + Go×2 +
   bench + 真实模型 e2e（secrets 门控），8 个 job 全绿才算完。

## 结构速览

完整目录树与逐模块职责见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（权威清单，以它为准，这里不重复抄以免漂移）。
关键入口：执行层 `execution_layer.py` · 工具注册表 `tools/registry.py` ·
交互循环 `agent_runner.py` · 前端 `ai_code.py` · 全量测试 `test_all.py` · 整壳 `frontend/dsh-ui/`。

## 大版本改了什么

用户可见的变化按版本汇总在 **[UPDATES.md](UPDATES.md)**（大白话 + 怎么用）；逐条技术明细在
[CHANGELOG.md](CHANGELOG.md)。发版时两者同步更新——这是提交纪律的一部分。
