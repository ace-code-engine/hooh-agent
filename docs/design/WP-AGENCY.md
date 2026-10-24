# WP-AGENCY · 把正常 Agent 的体感拿回来 —— 总纲与进度

> 状态:**阶段 1 完成**(2026-10-24 立项并当日收口:四刀 + 前置小件 + 指标全部落地,
> 每块独立提交;阶段 2 与首份实测读数见文末进度日志与 docs/HANDOFF.md 的行)。
> 本文是本次改造的**唯一权威参照**:诊断、方案、硬边界、进度日志全在这一张卡里。
> 做完后按仓库惯例把结论并入 `docs/SECURITY-MODEL.md`、`docs/CONFIGURATION.md`
> 与 `docs/HANDOFF.md`。

## 〇、目标与边界

**用户原话级的目标**:现在的安全实现让产品「为了安全失去了太多」——操作能力、
响应速度、操作体验都要拿回来,要如正常 Agent 一般。

**诊断(一句话)**:成本不在「安全」本身,而在「问」。
安全分两种——**沉默的安全**(审计链/快照/forbidden 403/fail-close)从不打断用户,
体感成本≈0;**吵的安全**(逐次确认/逐目的地确认/readonly 默认档)才是全部痛感。
而爱「问」的根因是**执行边界默认 off**(沙箱弱),于是 interrogation 成了主要防线。
**解法不是拆安全,是把账单从「问」搬到「信封」**:项目内一切动作有快照兜底=
可逆=免确认;「问」只留给不可逆 × 范围外的动作。

**四刀(按性价比排序)**:

| # | 刀 | 内容 | 主要落点 |
|---|---|---|---|
| 1 | 默认档反转 | 默认权限 `readonly` → `write`:项目内写自动放行(快照/审计常开),readonly 留给不可信任务 | `ai_code.py`、配置文档、安全文档 |
| 2 | 快照增量化 | 内容寻址对象库 + 跨快照去重,哈希只发生在变化的文件上;rollback 语义/fail-close 一分不减 | `core/guardian.py` |
| 3 | 命令形状记忆 | terminal_exec「不再问」:会话级/项目级记忆归一化命令形状;H-27 元字符 fail-close 与敏感目标硬拦**照旧生效** | `core/execution_layer.py`、前端 PermissionDialog、协议 |
| 4 | 原生 tool-calling | API 支持时走 `tools`/`tool_calls` 原生协议,文本协议降级为旧模型回落;杀掉 FORMAT_ERROR 类与协议 token 税 | `ai_code.py`、`prompts/` |

**前置小件**:code_execute 的 503 死路改为可行动文案(怎么开、开了得到什么);
确认次数/等确认耗时进审计统计(把「体感差距」变成可测数字)。

**硬边界(一条都不能破)**:

- **fail-close 纪律不动**:快照失败拒写、沙箱拿不到 503 不回落、非交互全拒、
  `never`+`off` 启动即拒——这些是「免确认」的资格来源;
- **不可逆 × 范围外仍必问**:项目外覆盖/删除已存在文件、未白名单目的地外发,
  现在问,以后也问;
- **审计链与快照语义不动**:每事件仍全签、rollback 仍「宁可多退不可少退」;
- 形状记忆**永不**豁免 H-27(shell 元字符)与敏感目标硬拦;
  记忆载体只能是已有的已签名/敏感名单覆盖的存储(`.ace/permissions*.json`);
- 原生 tool-calling 默认**显式开启**(config/flag),文本协议路径保留为回落;
  引擎 14 阶段裁决管线不绕行——原生调用仍走同一条 `_stage_parse` 之后的路。

**不做什么**:不拆审计、不做自动放行外发、不把「问」改成静默拒绝
(那只是把打扰换成死路)。

---

## 一、指标(先测出来,再优化)

把「正常 Agent 差距」从感觉变成数字,随会话写进审计日志、`/audit stats` 可见:

- `asks_per_task`:一次任务里的确认弹窗次数;
- `gate_wait_ms`:等确认累计耗时 / 任务总耗时占比;
- `ttft_ms`:首 token 延迟(原生 tool-calling 前后对比)。

---

## 二、进度日志

- 2026-10-24 立项。前置:既有未提交工作(WP-GUI 三轨/雾蓝主题/DSH 桥接)已先行
  独立检查点入库,与新工作分离。基线:`test_all.py` 全绿(7 项能力探测跳过;
  需 `ACE_DISPLAY_ENCODING=utf-8`),前端 vitest 652 过 / 2 失败
  (dsh-ui-engine / dsh-ui-smoke / integration,迁入中状态,非本项目范围)。
- [x] 刀1 默认档反转——`merge_config(default_permission=…)` 按通道分流：交互 `write` /
      headless 显式 `readonly`（`--mcp` 与冻结入口都钉死）；设置注册表默认同步；
      GETTING-STARTED / INTERFACES / MCP-SERVER / SECURITY-MODEL 四处契约文档改口
- [x] 刀2 快照增量化——`core/guardian.py` 内容寻址对象库（`.guardian/objects/`）
      + 跨快照硬链接 + `(size, mtime_ns)` 索引跳过未变文件的哈希；meta.json 格式
      不变（verify/rollback/外部工具零改动）；`prune()` 顺带 `gc_objects()` 回收
      孤儿对象；mtime 欺骗的知情取舍（往旧退的方向）写在模块 docstring。
      实测（300 文件夹具）：基线 2074ms → 未变树 360ms（5.8×）→ 单文件改动 304ms。
- [x] 刀3 命令形状记忆(「记住并写规则」)——复用 `ace_rules` 持久规则面,不发明新存储:
      授权框新增第 4 项「记住并写规则」(decision 仍 `session` + `persist` 标志,
      协议三态不动;Python 侧等价动作是确认后的文字追问,shell-parity R-1 改记
      「TS 超集」契约);引擎按建议模式落 `.ace/permissions.local.json` 并 notice
      说清记了什么/怎么删。**建议端安全闸 `suggest_rule_safe`**:H-27 组合命令与
      危险包装第一词(`python:*` 会连 `python -c` 一起放行)一律拒绝建议——
      一次点击就长期生效的动作,闸门建在建议端;分层一致性(UNSAFE_RULE_HEADS ↔
      BANNED_AUTO_PREFIXES、组合正则)由守卫测试钉住。
- [ ] 前置小件:可行动 503/403 文案
- [x] 刀4 原生 tool-calling 阶段 1——**验证：骨架已在**（`agent_runner`/`ai_code` 全链路：
      tools 参数 + `tool_calls_to_protocol` 复用执行层 + 400/404 自动降级并声明 +
      tools 模式纯文本清洗），离线冒烟通过（mock 原生 tool_call → 执行 → final，2 轮）。
      本刀做的是把它从暗门变成一等公民：/config 向导加第 4 步「原生工具调用」
      （on/off，答案落 `cfg["tools"]`）、设置注册表登记（hot=False，与换档同寿命）、
      CONFIGURATION.md 立契约（含自动降级语义与建议矩阵）、三语 locale 4 键。
      阶段 2（待做）：TUI 设置面板显示端点实际状态（tools_ok/tools_degraded）。

- [x] 指标入统计——`session/interaction` 事件（确认次数 + 等确认累计耗时，含前端
      对话框挂起时间），会话收尾落一条（测量失败不拦收尾）；`/audit stats` 聚合展示
      （次数/累计秒/均秒；老日志无此事件 = 如实显示 0）；落盘往返有测试钉住。

- [x] 前置小件:可行动 503/403 文案 + 执行边界体检进 --setup(_sandbox_probe 纯查询可注入)
- [x] 刀4 原生 tool-calling 阶段 1(见上)
- [x] 指标入统计(见上)

## 三、阶段 2 留给下一程

1. TUI 设置面板显示端点实际 tools 状态(`tools_ok` / `tools_degraded`,`/model` 已带,面板未带);
2. 原生路径跑一轮**真实端点** e2e(现只有 mock 冒烟与组件级测试);
3. 新默认档(write)下的首份 `asks_per_task` / `gate_wait_ms` 实测读数——指标管道已通,读数要等真用;
4. 形状记忆的使用率观察:如果「记住并写规则」点得少,说明第 4 项的位置/文案还要调。
