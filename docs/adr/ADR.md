# 架构决策记录（ADR）

记录关键设计决策及其理由，供后续维护者理解"为什么这么写"。

## ADR-001：为什么用 SimHash 而不是向量数据库

- **决策**：记忆引擎用 64 位 SimHash + token 交集相似度，不引入 FAISS/向量库。
- **理由**：核心保持零第三方依赖；对话记忆量级（几百~几千条）用线性扫描 + `lru_cache` 完全够快；
  向量库的收益在 10 万级以上才明显。等记忆规模上来再换不迟（`MemoryArchive` 的接口已隔离）。

## ADR-006：为什么诱饵验证频率默认 0（每任务一次）

> 编号说明：本文档原内联序列 ADR-002 与独立文件 `docs/ADR-002-executor-boundary.md`
> 的编号冲突（两个 002 含义不同）。为消除歧义，本条目改为 **ADR-006** 接续内联序列；
> 独立文件序列（ADR-NNN-*.md）单独计数，两者不共享编号空间。

- **决策**：`bait.frequency = 0` 表示每个新任务只注入一次诱饵。
- **理由**：诱饵的目的是验证 Agent 有"识别并修复注入缺陷"的能力，而不是惩罚每一段代码；
  每任务一次能在覆盖能力验证的同时不拖慢正常开发（7B 模型每轮都要纠错会非常耗时）。

## ADR-003：为什么用"原生工具调用 + 文本协议"双层兼容

- **决策**：优先原生 function calling（`--tools`），端点不支持时自动降级为
  `<INTERNAL>/<EXTERNAL>` 文本协议。
- **理由**：原生工具调用是生产 Agent 的标准路径（结构化、省 token、不泄漏推理）；
  但本地小模型（Ollama/Qwen）常把工具调用写成 JSON 文本而非结构化 `tool_calls`，
  因此保留文本协议作为兜底，并兼容 Ollama 原生 schema 与 ```json 围栏。

## ADR-004：为什么安全核心保持纯 stdlib（不引入 Pydantic/FAISS）

- **决策**：**安全核心**（执行层 / 网关 / 记忆 / CLI / 内置编辑器）只用标准库。
  **模型调用需要 `requests`**：`core/ace_http.py` 是唯一出网点，`request_with_retry`
  直接 `import requests`、没有回退。`prompt_toolkit` 仍是可选懒加载（普通 REPL 的输入行）；
   自引擎界面落地（[`docs/TUI-ENGINE.md`](../TUI-ENGINE.md)）起，默认那条界面路径
   **不需要任何第三方界面库**（原 `textual` / `rich` 依赖已随 `tui/` 移除）。
- **理由**：降低部署与依赖风险；配置校验用 `dataclass`（`CLIConfig`）实现同样的默认值与校验能力，
  不引入 Pydantic。**安全边界不依赖任何第三方库** —— 这是"安全下沉到执行层"能成立的前提：
  被审计的那一层越少外部成分，权限/快照/审计链越可审计。容器化、插件化是未来的可选路径。
- **被否决的选项 (a)**：保留 `ace_http.urlopen_json_with_retry` 作为"没有 requests 也能调模型"的
  stdlib 路径。实测它自 R-03 把两个前端合并到 `core/ace_client` 之后，**生产调用点为 0** ——
  真实调用走的是 `request_with_retry`。一条没人走的第二份出网实现，却一直撑着"核心零依赖"的
  口径，让那句话变成假的。与其维护双重实现，不如把 `requests` 声明为事实依赖。
  决策与实测见 `docs/design/SAFETY-HARDENING.md` §17。
- **口径修正（v3.41）**：此前 README 徽章、`requirements.txt`、本文档与 `INTERFACES.md` 都
  把 `requests` 描述成"可选"，而 `setup_env.py` 也不装它 —— 结果是**干净机器上装完界面依赖
  仍然连不上模型**（报的是裸 `ImportError`）。现已改为如实声明，并把它列进 `setup_env.REQUIRED`。

## ADR-005：为什么 Plan Mode 用 `plan_propose` 工具而非文本识别

- **决策**：模型提议计划走结构化工具 `plan_propose`，执行层返回 `PLAN_PROPOSED`，用户批准后放行。
- **理由**：文本识别"这是计划"不可靠（小模型输出随意）；结构化工具调用让执行层有明确的状态机
  （未批准拦截 `PLAN_PENDING`、批准后防重复提议 `PLAN_ALREADY_APPROVED`），可测试、可审计。
