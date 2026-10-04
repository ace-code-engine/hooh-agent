#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""core.ace_contracts —— 两份方法论契约：指标语义（ACC-02）与缺陷可达性（ACC-03）

「可发布性」不是文风，是**能被断言的东西**。这两份契约管的正是那件事：
一个数字、一份缺陷报告，**要说清它是什么、不是什么**。

## ACC-02 · 指标语义契约（五要素）

| 要素 | 回答的问题 | 写不清楚的后果 |
|---|---|---|
| `metric` | 它叫什么 | 同一个词在两处指两件事 |
| `anchor` | **锚点**：什么时候取、以什么为基准 | 「最近一次」和「全部」混成一个数 |
| `population` | **总体**：哪些对象被算进去了 | 分母悄悄变了没人知道 |
| `excludes` | **排除了什么** | 排除了却没说 ⇒ 读者按"包含"理解 |
| `reads_as` | **怎么读**：这个数**不是**什么 | 最常见的一种错：把「未评估」读成 `false` |

## ACC-03 · 缺陷可达性契约（六要素）

| 要素 | 回答的问题 |
|---|---|
| `constructed_state` | 要构造出什么状态才能看到它 |
| `production_producer` | **真正的生产者** —— 必须是**代码定位符**（`文件:符号`），不是一句症状描述 |
| `transition_path` | 从那个状态到症状，中间怎么走过去的 |
| `persistence_boundary` | 会不会被持久化 / 越过哪个边界 |
| `authority` | 谁有权触发、谁有权放行 |
| `observed` | **观察到的症状**（它**不是**生产者） |

**为什么 `production_producer` 必须是代码定位符**：这不是洁癖，是 `H-21` 唯一可执行的教训 ——
那次上报写的是「模型死循环」（= **症状**），于是修的人去修提示词；而真正的生产者在
**两个安全特性的交叉处**（`agent_runner.render_error_result` 复用了给外部内容用的隔离块）。
**按错误的原因修，永远修不好。** 所以这里把「症状 ≠ 生产者」从一句呼吁改成一条判据。

## 这张表怎么才能不变成"没人看的模板"

靠**两条机械链接**（都在 `test_all [73]` 里断言）：

1. **声明 ↔ 那一行的 i18n 占位符**：对外那条「跨会话累计」一行报几个数，
   就要求几条契约（`audit_metric_declaration`，三语模板一起比）；
2. **声明 ↔ 汇总真实返回的路径**：`cross_session_metrics` 算出来的每条路径
   必须**二选一** —— 要么有一条五要素契约，要么在 `INTERNAL_ONLY` 里**写明它为什么不报出**。
   新增一个指标而两边都不动 ⇒ 红的。

纯函数：构造 / 校验 / 审计。不发请求、不读时钟、不碰文件系统。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional

# HL-05 的级别闭集来自 `tools.status`（唯一登记处）—— 这里只是消费它。
from tools.status import BUDGET_SCOPES as _BUDGET_SCOPES

__all__ = ["METRIC_FIELDS", "DEFECT_FIELDS", "SUBSTITUTION_FIELDS",
           "metric", "defect", "substitution", "all_assessed",
           "validate_metric", "validate_defect", "validate_substitution",
           "metric_paths", "unclassified_metrics", "placeholder_set",
           "audit_metric_declaration", "CROSS_SESSION_TEMPLATE",
           "CROSS_SESSION_PLACEHOLDERS", "CROSS_SESSION_METRICS", "INTERNAL_ONLY",
           "KNOWN_DEFECTS", "SUBSTITUTIONS", "PERMISSION_RENDERERS",
           "TOKEN_DEVIATION_THRESHOLD", "token_deviation", "token_verdict",
           "usage_token_verdict", "validate_bench_report",
           # ── HL-04（§3.5）：L4 上报物料必须可判定 ──
           "ESCALATION_FIELDS", "SUBSTITUTION_IDS", "MaterialIncomplete",
           "REFUSAL_SOURCE_PRODUCERS", "REFUSAL_CLASS_PRODUCERS", "DEFAULT_PRODUCER",
           "producer_for", "producer_for_source", "locator_format_ok",
           "validate_substitution_answers", "detect_substitutions",
           "validate_escalation_material"]

# 五要素 / 六要素的**唯一来源**（顺序即文档里的顺序）
METRIC_FIELDS = ("metric", "anchor", "population", "excludes", "reads_as")
DEFECT_FIELDS = ("constructed_state", "production_producer", "transition_path",
                 "persistence_boundary", "authority", "observed")

# 对外那条「跨会话累计」一行所用的 i18n 模板键（`ai_code._cross_session_line`）。
CROSS_SESSION_TEMPLATE = "status_cross_session"


def metric(**fields: str) -> Dict[str, str]:
    """构造一条指标语义契约。多写/少写字段由 `validate_metric` 报出来。

    定义必须在声明表**之前** —— 表是用它构造的（模块级语句自上而下执行）。
    """
    return {str(k): str(v) for k, v in fields.items()}


def defect(**fields: str) -> Dict[str, str]:
    """构造一条缺陷可达性契约（顺序同上）。"""
    return {str(k): str(v) for k, v in fields.items()}


def substitution(**fields: str) -> Dict[str, str]:
    """构造一条「偷换」记录（ACC-04，顺序同上）。"""
    return {str(k): str(v) for k, v in fields.items()}


def all_assessed(items: Any) -> bool:
    """`all()` 的**防偷换版**：空总体返回 `False`。

    为什么不能直接用 `all()`：`all([])` 恒为 `True` —— 于是"**没东西可判**"会被读成
    "**全都合格**"。这正是 ACC-04 第一种偷换（unknown → true），而且它在本仓**真实发生过**：
    `test_all [73]` 第一版用 `all(validate_defect(d) == [] for d in KNOWN_DEFECTS.values())`，
    声明表为空时那条断言**假通过**。

    所以：**没有总体就没有结论**。要么把总体做非空（并另加一条"非空"的 companion 断言），
    要么就别问"是不是全都合格"。
    """
    seq = list(items) if items is not None else []
    return bool(seq) and all(bool(x) for x in seq)

# **字段路径 → i18n 占位符名**。有了它，"那一行多了一个数"与"这里多了一条契约"
# 就能机械对齐（见 `audit_metric_declaration`），不靠人记得同步。
# 来源：`ai_code._cross_session_line` 的 `t("status_cross_session", …)` 实参。
CROSS_SESSION_PLACEHOLDERS: Dict[str, str] = {
    "sessions": "n",
    "rounds": "rounds",
    "tool_calls": "tools",
    "tool_errors": "errors",
    "usage.in_tokens": "tin",
    "usage.out_tokens": "tout",
    "usd": "cost",
}

# **字段路径 → 五要素**。只收**对外报出**的量（理由见模块头"两条机械链接"）。
CROSS_SESSION_METRICS: Dict[str, Dict[str, str]] = {
    "sessions": metric(
        metric="跨会话累计的会话**份数**",
        anchor="跑这一刻现算：`_session_files()` 加上当前会话日志，**不缓存**",
        population="有事件的会话日志（`session_metrics` 返回 `events > 0` 才计入）",
        excludes="空日志、坏日志、不存在的路径（跳过，且不计入）",
        reads_as="它是**文件数**，不是对话数 —— 同一台机器多开一次 ACE 就多一份；"
                 "**不是**「用户用了多少次」"),
    "rounds": metric(
        metric="跨会话累计的轮数（模型调用轮）",
        anchor="按日志里 `request/snapshot` 事件逐条计数",
        population="全部会话日志里的每一个 `request/snapshot`，**含子代理那些轮**",
        excludes="没有走模型调用的回合（例如被闸门在更早阶段拦下的）不产生这个事件",
        reads_as="它是**模型调用轮数**，不是用户提问次数 —— 一次提问可能跑多轮"),
    "tool_calls": metric(
        metric="跨会话累计的工具调用次数",
        anchor="按 `tool/call` 事件计数（那是**事后**审计记录，不是意图预告）",
        population="每一次工具调用，**含被拒绝与失败的那些**；控制类工具"
                   "（`plan_propose` / `goal_*` / `todo_write`）同样计入",
        excludes="不排除任何工具；被闸门在更早阶段拦下、根本没进执行器的调用不算",
        reads_as="它是**调用次数**，不是不同工具数 —— 同一个工具调 50 次就是 50；"
                 "也**不等于**「有用功」"),
    "tool_errors": metric(
        metric="跨会话累计的工具错误次数",
        anchor='按 `tool/result` 事件的 `status != "success"` 计数',
        population="**执行层真的跑过、但结果非 `success`** 的工具调用：含工具自己返回的 "
                   "403（越界 / 敏感目标 / execpolicy 拒绝）与 404 / 409 / 500（真失败）",
        excludes="★被闸门在**工具执行之前**挡下的那些**不在里面** —— 它们根本不落 "
                 "`tool/result`：逐次确认被拒 → `permission/decision`；AST 守门 / 诱饵 / "
                 "快照不可用 → 各自的早退分支（实测：readonly 下一次被拒的 `file_write`，"
                 "这个计数是 0，日志里连一条 `tool/result` 都没有）",
        reads_as="★它把**工具自己返回的「拒绝」（403）与真失败（404/409/500）算在一起** —— "
                 "`THREE-LAYERS` 说的「拒绝是信息，失败是状态」在这里还没有拆开。"
                 "所以**不能**读成「工具有多少坏的」，也**不能**读成「我被拦了多少次」"
                 "（后者看 `permission/decision` 聚合出的 `decisions`）。"
                 "拆开它是 `THREE-LAYERS` **HL-01** 的活"),
    "usage.in_tokens": metric(
        metric="跨会话累计的输入 token",
        anchor="按 `model/usage` 事件的 `in_tokens` **增量**求和（重放求和才是真值）",
        population="每一轮模型请求的输入侧",
        excludes="老日志里没有这个字段的轮次按 0 计（是「如实缺」，不是「算成 0」）",
        reads_as="★它多半是**按字符估的**（`cli/ace_context.estimate_tokens`），"
                 "**不是账单**；厂商实测值在 `usage.measured_in_tokens`（ACC-01 / A0），"
                 "同一次聚合里已可对照 —— 偏差本身就是 ACC-01 的判据（`ACC-GATES.md`）"),
    "usage.out_tokens": metric(
        metric="跨会话累计的输出 token",
        anchor="按 `model/usage` 事件的 `out_tokens` 增量求和",
        population="每一轮模型请求的输出侧",
        excludes="同上：缺字段的老日志按 0 计",
        reads_as="同 `usage.in_tokens`：**估算**，对照见 `usage.measured_out_tokens`（已聚合）。"
                 "流式下厂商通常只在**收尾分片**报用量，读不到时实测侧就是空的"),
    "usd": metric(
        metric="跨会话累计成本（美元，**估算**）",
        anchor="用 `core/ace_cost` 的**本地价格快照**（`PRICING_SNAPSHOT`）现算，"
               "按最长子串匹配模型名",
        population="价格表里**查得到**的模型的那部分 token",
        excludes="查不到价格的模型**整体不计入**（一个都没命中时 `usd` 直接是 `None`）",
        reads_as="★`None` = **价格未知**，不是 0 元；即便有值它也是估算 —— "
                 "缓存折扣、阶梯价、厂商调价都不反映。**它不是账单**"),
}

# 汇总里算了、但**不对外报出**的路径：显式登记 + 一句为什么。
# 它存在的意义是让"新增一个指标"必须二选一，而不是悄悄多一个数。
INTERNAL_ONLY: Dict[str, str] = {
    "events": "日志里的原始事件条数 —— 是**规模**不是行为（改一次日志格式它就会变），"
              "对外报它等于把实现细节当产品指标",
    "subagent_rounds": "`rounds` 的**细分切面**（其中属于子代理的那些）—— "
                       "单报会让读者把子集当全集",
    "tool_elapsed_ms": "工具耗时合计（毫秒），**缺分母**（没有次数就没有均值）—— "
                       "单报容易被读成「总时长」；单会话视图（`/audit`）报它才有上下文",
    "user_messages": "用户消息条数 —— 与 `rounds` 不同源（一轮里可能 0 条或 N 条）；"
                     "对外那行用 `rounds` 表达「跑了多少」",
    "assistant_messages": "同上（模型消息条数）；存量老日志里它与 `rounds` 的比值不稳定",
    "usage.rounds": "`rounds` 里**有 usage 记录**的那些 —— 它是分母候选，不是对外结果",
    "usage.measured_in_tokens": "ACC-01 的**对照证据**（自报 vs 实测）：已聚合、可与 `usage.in_tokens` 对账，"
                                "但对外那行暂只报自报值；对照视图另做（见 `ACC-GATES.md` §7.5）",
    "usage.measured_out_tokens": "同上（输出侧实测值），与 `usage.measured_in_tokens` 成对出现",
}

# 已知缺陷（**样板**）：`{编号: 六要素}`。每条都要能过 `validate_defect`。
KNOWN_DEFECTS: Dict[str, Dict[str, str]] = {
    "H-21": defect(
        constructed_state="一段**执行层自己写的**错误 payload（status / message / "
                          "instruction），而 payload 里那句指令写着「请修正后继续」",
        production_producer="agent_runner.py:render_error_result",
        transition_path="该分支当时复用 `wrap_untrusted`（外部内容隔离块）⇒ payload 被"
                        "标成「外部（未分类）」⇒ 模型按系统提示词的约定**拒绝**把它当指令 "
                        "⇒ 连续 5 轮原样重发、报错正文一字未变 ⇒ 第 6 轮被 "
                        "`STALL_ABORT_ROUNDS` 中止",
        persistence_boundary="不进日志、不落盘：它只活在**回喂给模型的那一段文本**里"
                             "（`request/snapshot` 只记 `system_len` / `messages_count`，"
                             "所以事后从日志里看不到那个标签）",
        authority="**无人在场**：两个既有特性（SEC-011 隔离块 + 纠错指令）交叉出的默认"
                  "行为，没有被任何审批或策略显式选择过",
        observed="第 6 轮被 `STALL_ABORT_ROUNDS` 按「模型死循环」中止，且责任被归给"
                 "模型与提示词 —— **症状**，不是生产者"),
}

# ACC-04 · **五种偷换**：五种"把 A 读成 B"的错误读法。
# 这不是文风清单 —— 每条都要有一个**本仓真实**的样例（`sample`）与一条**可执行**的判据（`witness`），
# 判据在 `test_all [73]` 里逐条跑。写不出真实样例的条目不该留在这里。
SUBSTITUTION_FIELDS = ("id", "reads_as", "should_read", "sample", "witness")

SUBSTITUTIONS: tuple = (
    substitution(
        id="unknown-as-true",
        reads_as="总体是空的 ⇒ 报「全部合格」",
        should_read="空的总体**没有**合格可言 —— 那是「没评估过」，不是「都没问题」",
        sample="`test_all.py [73]`：A1 期间**真实发生过** —— 空 `KNOWN_DEFECTS` 上 "
               "`all(...)` 为真，那条「已知缺陷全都合格」假通过",
        witness="`all_assessed([])` 为 `False`，而 `all([])` 为 `True`（并排比）"),
    substitution(
        id="latest-as-all",
        reads_as="拿**最近一份**日志的数当**全部**会话的数",
        should_read="单会话与跨会话是**两个函数、两种口径**，合并读必错",
        sample="`core/ace_engine.py:414 session_metrics`（单份）vs `:489 cross_session_metrics`"
               "（跨会话）；对外也各有各的一行：`ai_code.py:2771`（`/audit`）与 `:4462`（`/status`）",
        witness="两会话 fixture：`session_metrics(s1)['rounds'] == 1` 而 "
                "`cross_session_metrics([s1, s2])['rounds'] == 3`"),
    substitution(
        id="accepted-as-closed",
        reads_as="快照「创建没报错」⇒ 就有回滚点",
        should_read="「被接受」≠「已闭合」：H-06 的第二种 fail-open 是**无异常**的 —— "
                    "只收到凭据文件时，快照里其实什么都没有",
        sample="`core/guardian.py:254 count_credential_only_files`；`execution_layer.py:1864` "
               "的 `> 0` 分支正是为它加的（H-06）",
        witness="只放一个 `.env` 的目录上 `count_credential_only_files() > 0`"),
    substitution(
        id="attempted-as-judged",
        reads_as="`compileall` 过了 ⇒ 代码没问题",
        should_read="编译过只说明**语法**过 —— `compileall` 是**结构**校验，不是运行验证",
        sample="`ci.yml` 的 `compileall` 步骤 + `[38]` 的三条 compileall 断言 —— 它们管的是"
               "**覆盖率**（列出的路径都编译），不是**可运行**",
        witness="语法合法、import 即抛的模块：`py_compile` 过而 `exec_module` 失败"),
    substitution(
        id="unassessed-as-false",
        reads_as="`usd` 没算出来 ⇒ 这次免费 / 成本 0",
        should_read="`None` = **价格未知**，与 `0.0` = 真的免费，是两件事",
        sample="`core/ace_cost.py:119` 的 `usd is None` 说明与 `:125` 的「价格未知（配置 pricing 可补）」；"
               "`core/ace_engine.py:568` `usd if priced else None`，注释写着「不编」",
        witness="免费档模型（`glm-4.7-flash`）→ `usd == 0.0`；查不到价格的模型 → `usd is None`"),
)

# 生产者必须是**代码定位符**：`文件:符号`（允许相对路径与点号）。
# 一句症状描述（"模型死循环"）会在这里被拦下 —— 那正是 H-21 要防的事。
_LOCATOR = re.compile(r"^[\w./\\-]+:\w[\w.]*$")

# 明确不算"一个度量路径"的字段，理由写在 `metric_paths` 里。
_NON_METRIC = frozenset({"sources"})


def _blank(v: Any) -> bool:
    return not (isinstance(v, str) and v.strip())


def _check(rec: Any, fields: tuple) -> List[str]:
    """两种契约共用的形状检查：**缺字段** / **空值** / **TODO 占位**。"""
    if not isinstance(rec, Mapping):
        return ["记录不是映射（契约是一条 dict，不是别的）"]
    problems: List[str] = []
    for f in fields:
        if f not in rec:
            problems.append(f"缺字段 {f}")
        elif _blank(rec.get(f)):
            problems.append(f"字段 {f} 是空的（占位符不算契约）")
        elif str(rec.get(f)).strip().upper().startswith("TODO"):
            problems.append(f"字段 {f} 还是 TODO")
    return problems


def validate_metric(rec: Any) -> List[str]:
    """校验一条指标语义契约：返回问题列表（空 = 合格）。"""
    problems = _check(rec, METRIC_FIELDS)
    if not isinstance(rec, Mapping):
        return problems
    extra = sorted(set(rec) - set(METRIC_FIELDS))
    if extra:
        problems.append(f"多出字段 {extra}（五要素之外的不算契约的一部分）")
    return problems


def validate_defect(rec: Any) -> List[str]:
    """校验一条缺陷可达性契约：返回问题列表（空 = 合格）。

    比 `validate_metric` 多两条**来自 H-21 的**判据：
    ① 生产者必须是代码定位符（症状描述不算）；② 生产者不许等于症状。
    """
    problems = _check(rec, DEFECT_FIELDS)
    if not isinstance(rec, Mapping):
        return problems
    extra = sorted(set(rec) - set(DEFECT_FIELDS))
    if extra:
        problems.append(f"多出字段 {extra}（六要素之外的不算契约的一部分）")
    producer = rec.get("production_producer")
    if isinstance(producer, str) and producer.strip() and not _LOCATOR.match(producer.strip()):
        problems.append(
            "production_producer 必须是代码定位符（`文件:符号`），"
            f"现在写的是 {producer!r} —— 那读起来像症状；"
            "H-21 的教训正是「按错误的原因修，永远修不好」")
    if rec.get("production_producer") == rec.get("observed"):
        problems.append("production_producer 与 observed 相同：生产者不该等于症状")
    return problems


def validate_substitution(rec: Any) -> List[str]:
    """校验一条偷换记录：五栏都要有内容。"""
    return _check(rec, SUBSTITUTION_FIELDS)


def metric_paths(total: Any) -> List[str]:
    """`cross_session_metrics` 的返回里，**哪些路径算一个度量路径**。

    两类路径**不是**度量路径，因此不要求声明：

    - `sources`：它标的是"这份汇总是谁算的"（`ace-engine` 还是 `python`）—— **溯源字段**；
    - 形如 `usage.by_model` 的**维度分解**（按模型再分一层）：那是同一个指标的一个切面。

    嵌套一层的标量展开成 `父.子`（如 `usage.in_tokens`），与声明表同口径。
    """
    if not isinstance(total, Mapping):
        return []
    out: List[str] = []
    for k, v in total.items():
        if k in _NON_METRIC:
            continue
        if isinstance(v, Mapping):
            for kk, vv in v.items():
                if isinstance(vv, Mapping):
                    continue            # 维度分解（by_model）
                out.append(f"{k}.{kk}")
        else:
            out.append(str(k))
    return sorted(out)


def unclassified_metrics(total: Any) -> List[str]:
    """真实汇总里**既没契约、也没登记"不报出"**的路径。

    这就是防"悄悄多一个数"的那道门：新增指标必须二选一 ——
    补一条五要素契约，或在 `INTERNAL_ONLY` 里写明它为什么不报出。
    """
    known = set(CROSS_SESSION_METRICS) | set(INTERNAL_ONLY)
    return sorted(set(metric_paths(total)) - known)


def placeholder_set(template: str) -> List[str]:
    """一个 i18n 模板里的占位符名（`{n}` → `n`），排序去重。"""
    return sorted(set(re.findall(r"\{(\w+)\}", str(template or ""))))


def audit_metric_declaration(templates: Mapping[str, str]) -> List[str]:
    """把声明与**三语模板**的占位符对齐（机械链接，不靠人记得）。

    `templates`：`{语言: status_cross_session 模板}`。三语必须一致，且必须与
    `CROSS_SESSION_PLACEHOLDERS` 的值集合**完全相同** —— 那一行多一个数而这里
    没声明，就是红的。
    """
    problems: List[str] = []
    if set(CROSS_SESSION_METRICS) != set(CROSS_SESSION_PLACEHOLDERS):
        problems.append(
            "声明表两张不一致："
            f"语义 {sorted(CROSS_SESSION_METRICS)} vs 报出面 {sorted(CROSS_SESSION_PLACEHOLDERS)}")
    declared = sorted(set(CROSS_SESSION_PLACEHOLDERS.values()))
    seen: Dict[str, tuple] = {}
    for lang, tpl in templates.items():
        names = placeholder_set(tpl)
        seen[str(lang)] = tuple(names)
        if names != declared:
            problems.append(f"{lang}: 模板占位符 {names} ≠ 已声明 {declared}")
    if len(set(seen.values())) > 1:
        problems.append(f"三种语言的占位符不一致：{seen}")
    return problems


# ============================================================
# 权限渲染器名单（`WP-0` W0-A P-01 的数据化）
# ============================================================
#
# 「第 5 份权限对话框出现就红」的**机器可读来源** —— 谁在渲染"要不要授权"这个三态问题。
#
# 实测（见 `WP-0` 卡 P-01）：权限渲染器是 **3 份**，不是 `ROADMAP` S-2 的「×4」。
# 第 4 个候选（`ui/ace_dialog.run_dialog` + `ui/ace_selector`）是 REPL 的**选择**浮层，不渲染
# 权限请求；`ChoiceDialog`（ink）同理是选择/确认；`ServeUIHost` 是**桥**，
# 只发事件等答案。这些**不是**权限渲染器，不在这张表里 —— 混进来会把计数越数越乱（P-01 结论）。
#
# 2026 修订：Textual 那条路（`tui/`）已整体删除，第三份换成**引擎界面的内联面板**
# （`ui/ace_host.py`，主屏两车道里顶替输入行的那块）。**数量仍然是 3** —— 换了一份实现，
# 不是多了一份；这条注释就是"为什么这次改名单不需要解释成第 4 份"的依据。
#
# 纪律与 `EVENT_TYPES ↔ EVENT_REQUIRED` 同一条：**新增一个权限渲染器 = 先在这里登记**，
# 然后 `test_all` 的"数量钉住"断言会红，逼你把「为什么是第 4 份」写清楚 ——
# 这正是"先看着它红"要防的：静默多出一个渲染器而无人知晓。
PERMISSION_RENDERERS = (
    {"id": "repl", "role": "REPL 权限渲染器（行式）",
     "file": "agent_runner.py", "symbol": "def ask_grant"},
    {"id": "engine", "role": "引擎界面权限渲染器（内联面板，主屏两车道）",
     "file": "ui/ace_host.py", "symbol": "class EngineHost"},
    {"id": "ink", "role": "Ink 权限渲染器",
     "file": "frontend/src/components/PermissionDialog.tsx",
     "symbol": "export function PermissionDialog"},
)


# ============================================================
# ACC-01 ③ · 自报 token 的偏差阈值
# ============================================================
#
# 契约（ACC-GATES.md §2 ACC-01）：实测（厂商 `usage`）与估算（`estimate_tokens`）的
# 相对偏差超阈值 ⇒ 该结果**不得作为"可发布"证据**。
#
# **暂用值 50%**：A0 只证明"路通了"（实测能进账本），还没有真实偏差数据来定这个数
# （§7.5 原话："没证明估得准不准"）。发布前必须用真实会话的偏差分布替换它 ——
# 这不是"拍脑袋定死"，是"先有判据形状、再等数据校准"。
TOKEN_DEVIATION_THRESHOLD = 0.5


def token_deviation(estimated: Any, measured: Any) -> Optional[float]:
    """实测 vs 估算的相对偏差：0 = 完全一致，1 = 差一倍。分母取**实测**（那是真值）。

    没实测（`measured` 为 None 或 ≤ 0）→ `None` = **无从评**，不是"一致" ——
    把"没数"读成"一致"正是 ACC-04 第五种偷换（`未评估 → false`）要防的。
    """
    if measured is None:
        return None
    try:
        m = float(measured)
        e = float(estimated)
    except (TypeError, ValueError):
        return None
    if m <= 0:
        return None
    return abs(e - m) / m


def token_verdict(estimated: Any, measured: Any) -> Optional[str]:
    """`ok`（可用作可发布证据）/ `flag`（偏差超阈值，**不得**作为可发布证据）/
    `None`（没实测，无从评）。"""
    d = token_deviation(estimated, measured)
    if d is None:
        return None
    return "flag" if d > TOKEN_DEVIATION_THRESHOLD else "ok"


def usage_token_verdict(usage: Mapping[str, Any]) -> Optional[str]:
    """对聚合后的 `usage`（`session_metrics` / `cross_session_metrics` 里那个）给总判决。

    输入与输出两个方向都判，**取更严的那个**（任一超阈值即 `flag`）；
    两个方向都没实测 → `None`（无从评）。
    """
    if not isinstance(usage, Mapping):
        return None
    verdicts = [token_verdict(usage.get("in_tokens"), usage.get("measured_in_tokens")),
                token_verdict(usage.get("out_tokens"), usage.get("measured_out_tokens"))]
    if "flag" in verdicts:
        return "flag"
    if "ok" in verdicts:
        return "ok"
    return None


def validate_bench_report(payload: Any) -> List[str]:
    """校验 `benchmarks/results/bench_report.json` 的形状（ACC-02 落点 ① 的形状校验器）。

    这是"benchmarks 接校验器"里**现在能做的那半**：报告结构可校验，坏报告当场红。
    真实 before/after token 数据要等 WP-10 —— 那半进来时替换数据、校验器不用改。
    返回问题列表（空 = 合格）。
    """
    problems: List[str] = []
    if not isinstance(payload, Mapping):
        return ["报告不是 JSON 对象"]
    sysinfo = payload.get("sysinfo")
    if not isinstance(sysinfo, Mapping) or not sysinfo.get("python") or not sysinfo.get("platform"):
        problems.append("缺 sysinfo（python/platform）")
    checks = payload.get("checks")
    if not isinstance(checks, Mapping) or "passed" not in checks or "total" not in checks:
        problems.append("缺 checks（passed/total）")
    elif int(checks.get("passed", -1)) != int(checks.get("total", -2)):
        problems.append(f"正确性检查有失败：{checks.get('passed')}/{checks.get('total')}")
    metrics = payload.get("metrics")
    if not isinstance(metrics, list) or not metrics:
        problems.append("缺 metrics（非空列表）")
    return problems


# ============================================================
# HL-04 · L4 上报物料必须**可判定**（THREE-LAYERS §3.5，接 §6 A6）
# ============================================================
#
# L4 是"停下来问人"。而人能不能据此做决定，取决于这份物料**能不能被复核** ——
# §3.5 的原话："不允许只上报『失败了 8 次』"。所以物料必须由三块拼成，缺一块就是
# 假的"可判定"：
#
#   ① 指标语义契约（五要素，ACC-02）：那个数字是什么、以什么为锚、总体是谁、
#      排除了什么、**不是**什么；
#   ② 缺陷可达性契约（六要素，ACC-03）：要构造什么状态才看得到、
#      **真正的生产者是谁（必须是代码定位符）**、怎么走到症状、越过哪个边界、
#      谁有权、观测到的症状是什么；
#   ③ 五种偷换（ACC-04）**逐条回答**：没写"我没有这样读"，就无法证明没有这样读。
#
# 这三块不是新造的东西 —— 它们是 `METRIC_FIELDS` / `DEFECT_FIELDS` / `SUBSTITUTIONS`
# 的**消费口**。`validate_escalation_material` 是唯一的判定处。

#: 物料必须齐的四块（多出来的字段是事实，不算契约的一部分，因此**不做闭集检查**）。
ESCALATION_FIELDS = ("refusal_class", "metric", "defect", "substitutions")

#: 五种偷换的 id（唯一来源 = `SUBSTITUTIONS`）。物料必须**逐条**回答。
SUBSTITUTION_IDS = tuple(s["id"] for s in SUBSTITUTIONS)

#: 拒绝的**生产现场**（`文件:符号`）—— "谁拒的，就指谁"。
#: 为什么不指"规则本身有问题"：那是**症状+归因**，正是 §0.1 修错地方的原因。
REFUSAL_SOURCE_PRODUCERS: Dict[str, str] = {
    "permission": "execution_layer.py:_stage_permission",
    "tool_result": "tools/base.py:execute",
    "hook": "core/ace_hooks.py:run_hook",
    "code_gate": "execution_layer.py:_gate_code_execute",
    "snapshot": "execution_layer.py:_snapshot_unavailable",
    "output_guard": "execution_layer.py:_stage_output_guard",
    "tool_precheck": "execution_layer.py:_stage_tool_precheck",
    # HL-05：预算耗尽的生产现场 —— 就是那个**预算检查点**（不是"目标/会话"这种症状）
    "budget": "execution_layer.py:_check_budget",
}

#: 六类拒绝（+ 未分类）的**类级**生产者：取不到现场来源时的兜底。
#: 每一个都必须是真实存在的 `文件:符号`（由 `test_all` / 自查断言逐条核）。
REFUSAL_CLASS_PRODUCERS: Dict[str, str] = {
    "POLICY": "core/ace_execpolicy.py:evaluate_command",
    "BOUNDARY": "tools/base.py:_confined",
    "AUTH_PENDING": "execution_layer.py:_stage_permission",
    "CAPABILITY": "tools/base.py:execute",
    "TRANSIENT": "core/ace_http.py:request_with_retry",
    "MALFORMED": "agent_runner.py:TruncatedOutput",
    "": "execution_layer.py:_ladder_budget_exhausted",
}

#: 什么都不知道时的定位符：执行层总入口（有现场就说现场，没有就指总门）。
DEFAULT_PRODUCER = "tools/base.py:execute"

#: 物料被当成"已闭合"的偷换状态词（`accepted-as-closed` 的判据）。
_CLOSED_STATUSES = frozenset({"closed", "fixed", "resolved", "done", "accepted"})


class MaterialIncomplete(AssertionError):
    """L4 上报物料缺件 / 自相矛盾 —— **当场拦下**，不生成一份"像样的"假契约。

    §0.1 的教训是"按错误的原因修，永远修不好"；一份缺 `production_producer` 的
    物料比没有物料更坏（它看起来可复核）。所以这里是断言，不是警告。
    """


def producer_for_source(source: str) -> str:
    """这次拒绝是**哪个现场**产生的（`文件:符号`）；认不出的来源落总入口。"""
    return REFUSAL_SOURCE_PRODUCERS.get(str(source or "").strip(), DEFAULT_PRODUCER)


def producer_for(refusal_class: str) -> str:
    """该类拒绝的**类级**生产现场；认不出的类落总入口（**不编**、也不留空）。"""
    return REFUSAL_CLASS_PRODUCERS.get(str(refusal_class or "").strip().upper(),
                                        DEFAULT_PRODUCER)


def locator_format_ok(locator: Any) -> bool:
    """形状上是不是一个代码定位符 `文件:符号`（与 `validate_defect` 同一条判据）。"""
    return bool(_LOCATOR.match(str(locator or "").strip()))


def validate_substitution_answers(answers: Any) -> List[str]:
    """五种偷换**逐条**回答了没有：返回问题列表（空 = 齐）。

    "不出现某种误读"这件事无法靠翻字典证明 —— 只能要求物料**明确写下自己怎么读的**，
    然后由 `detect_substitutions` 对事实字段做机械判据。两者一起才算"没有偷换"。
    """
    if not isinstance(answers, Mapping):
        return ["记录不是映射（应当是 {偷换 id: 一句「我是怎么读的」}）"]
    problems: List[str] = []
    for sid in SUBSTITUTION_IDS:
        val = answers.get(sid)
        if not isinstance(val, str) or not val.strip():
            problems.append(f"缺对 {sid} 的回答（没写 ⇒ 没证明没这样读）")
    extra = sorted(set(answers) - set(SUBSTITUTION_IDS))
    if extra:
        problems.append(f"多出 {extra}（偷换清单是闭集，认不出的不算回答）")
    return problems


def detect_substitutions(mat: Any) -> List[str]:
    """五种偷换的**机械判据**：命中一条返回一条（空 = 一个都没出现）。

    每条判据都钉在一个事实字段上，不靠人读措辞：

    | 偷换 | 判据 |
    |---|---|
    | `unknown-as-true` | `verdict == "escalate"` 而 `population_size <= 0`（没数却说全都成立） |
    | `latest-as-all` | `trigger == "cross_goal"` 而 `distinct_goals <= 1`（一次观察当总体） |
    | `accepted-as-closed` | `requires_human is not True` 或 `status` 是"已闭合"词 |
    | `attempted-as-judged` | `judgement != "pending_human"`（尝试过 ⇒ 当成已判定） |
    | `unassessed-as-false` | `rule_change_decided is not None`，或 `unknowns` 不是列表 |
    """
    if not isinstance(mat, Mapping):
        return []
    out: List[str] = []
    pop = mat.get("population_size")
    if str(mat.get("verdict") or "") == "escalate" and (
            isinstance(pop, bool) or not isinstance(pop, int) or pop <= 0):
        out.append("unknown-as-true: 总体是空的（population_size<=0）却宣布升级 —— "
                   "「没数」不等于「全都成立」（`all([])` 那类假通过）")
    if str(mat.get("trigger") or "") == "cross_goal" and int(mat.get("distinct_goals") or 0) <= 1:
        out.append("latest-as-all: 拿单个目标的一次观察当「跨目标全都如此」—— "
                   "单会话/单目标与跨目标是两种口径，不能合并读")
    if mat.get("requires_human") is not True or str(mat.get("status") or "") in _CLOSED_STATUSES:
        out.append("accepted-as-closed: 「被记录」被读成「已闭合/已处理」—— "
                   "账本只是记录，规则的处置权在人")
    if str(mat.get("judgement") or "") != "pending_human":
        out.append("attempted-as-judged: 把「被拒 N 次」当成「已判定规则有缺陷」—— "
                   "尝试过 ≠ 已判过")
    if (mat.get("rule_change_decided", "missing") is not None
            or not isinstance(mat.get("unknowns"), list)):
        out.append("unassessed-as-false: 没人评过的维度被写成 False/没登记 —— "
                   "未评估是 `None`（无从评），不是 `False`（评过且否定）")
    return out


def validate_escalation_material(mat: Any) -> List[str]:
    """HL-04 的**唯一判定处**：L4 上报物料可判定吗？返回问题列表（空 = 可判定）。

    = 四块齐（`ESCALATION_FIELDS`）
      + 五要素（`validate_metric`）
      + 六要素（`validate_defect`，含"生产者必须是代码定位符且不等于症状"）
      + 五种偷换逐条回答（`validate_substitution_answers`）
      + 五种偷换一个都没出现（`detect_substitutions`）

    **注意**：物料里除这四块之外还有大量事实字段（计数/目标/指纹…），它们不是契约的
    一部分，所以这里**不做**闭集检查 —— 与 `validate_metric` 的"多出字段"纪律不同。
    """
    if not isinstance(mat, Mapping):
        return ["物料不是映射（L4 上报物料是一条 dict）"]
    problems: List[str] = []
    # 预算耗尽型物料说的**不是某一类拒绝**（会话 rounds 用尽与 refusal_class 无关）：
    # 它的"是谁"由 `budget_tier` 承担（下面单独判）。其余物料必须有 refusal_class。
    _is_budget = str(mat.get("trigger") or "") == "budget_exhausted"
    if _blank(mat.get("refusal_class")) and not _is_budget:
        problems.append("缺字段 refusal_class（或为空）")
    for block in ("metric", "defect", "substitutions"):
        if block not in mat:
            problems.append(f"缺字段 {block}")
        elif not isinstance(mat.get(block), Mapping):
            problems.append(f"字段 {block} 不是映射（契约是一条 dict）")
    if isinstance(mat.get("metric"), Mapping):
        problems += [f"metric: {p}" for p in validate_metric(mat["metric"])]
    if isinstance(mat.get("defect"), Mapping):
        problems += [f"defect: {p}" for p in validate_defect(mat["defect"])]
    if isinstance(mat.get("substitutions"), Mapping):
        problems += [f"substitutions: {p}"
                     for p in validate_substitution_answers(mat["substitutions"])]
    # HL-05（§3.6）：预算耗尽型物料**必须报出是哪一级** —— 否则"一个目标卡住"与
    # "整个会话失控"会以同一份物料出现在人面前（本包要治的正是这件事）。
    if str(mat.get("trigger") or "") == "budget_exhausted":
        tier = str(mat.get("budget_tier") or "").strip()
        if tier not in _BUDGET_SCOPES:
            problems.append(
                f"budget_tier: 预算耗尽型物料必须报出是哪一级（{list(_BUDGET_SCOPES)}），"
                f"拿到 {tier!r} —— 级别不可辨的上报等于没有上报")
        dim = str(mat.get("budget_dimension") or "").strip()
        if not dim:
            problems.append("budget_dimension: 预算耗尽型物料必须报出耗尽的维度")
        if not int(mat.get("budget_spent") or 0):
            problems.append("budget_spent: 预算耗尽型物料必须带用量（没有用量就谈不上耗尽）")
    problems += detect_substitutions(mat)
    return problems
