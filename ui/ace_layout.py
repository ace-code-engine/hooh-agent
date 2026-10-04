#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_layout —— 布局与状态行：区域划分 · 可配置底栏 · 上下文可视化 · 任务树 · 动效

为什么需要这一层：底栏此前是一段写死在 `_footer()` 里的拼接 —— 加一项就要改那段代码，
终端窄了就把尾巴截掉（**先截掉的往往是"上下文 92%"这种最该看见的**），用户想把
"轮数/工具数"换成"成本"也无从下手。等待动画只有一个点号在转，"卡住"和"在干活"在
屏幕上长得一模一样。这一层把这些做成**数据 + 纯函数**：

- `fit_status_line`：底栏是"分段 + 优先级 + 按宽度丢车保帅"，不是一段字符串；
- `parse_statusline`：用户配置 `statusline: ["model", "permission", "context"]`
  决定顺序与去留，未知名字如实报错（不静默忽略）；
- `context_meter`：上下文占用画成条 + 百分比，颜色即语义（灰/黄/红），窗口未知时
  返回空串 —— 不拿 0 当分母造一个假的 0%；
- `shimmer_span` / `is_stalled`：等待动画的高光位置与"多久没动静算停滞"，都是纯函数；
- `TaskNode` / `render_task_tree`：目标 + 逐项待办 + 正在跑的工具渲染成**多行任务树**；
- `banner_frames`：首屏标题的逐字浮现，帧序列是纯数据（TTY 才播，非 TTY 直接跳过）；
- `compute_layout`：把终端高度切成 头部/正文/状态行/输入 四块，行数不够时**先牺牲
  装饰、绝不牺牲输入行**（没有输入行的界面等于坏了）。

纪律：本模块只算、不画、不读时钟、不打印 —— 颜色与输出由调用方决定，所以没有终端
也能把每条规则断言住。
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from ui import ace_widgets
from ui.ace_text import display_width, truncate_width

__all__ = [
    "StatusSegment", "STATUS_NAMES", "DEFAULT_STATUS_ORDER", "fit_status_line",
    "parse_statusline", "context_meter", "context_state_style", "context_state_ansi",
    "shimmer_span", "spinner_line", "spinner_verbs", "should_apply_label",
    "is_stalled", "STALL_SECONDS", "SOFT_STALL_SECONDS", "LABEL_DWELL_SECONDS", "TaskNode",
    "build_task_tree", "render_task_tree", "banner_frames", "compute_layout",
]

# ============================================================
# 状态行（底栏）
# ============================================================

# 内置分段名（配置 `statusline` 里写的就是这些名字）。
# 顺序 = 默认展示顺序；`footer_dim` 这类样式由调用方给，本模块只搬文本。
STATUS_NAMES = (
    "model", "permission", "sandbox", "net", "goal",
    "turns", "todos", "queue", "stash", "images", "context", "cost",
)
DEFAULT_STATUS_ORDER = STATUS_NAMES


class StatusSegment:
    """底栏的一段：`name` 是身份，`text` 是给人看的，`priority` 越小越先被保留。

    为什么要有优先级而不是"谁在后面谁被截"：位置靠后的恰恰常是上下文占用、待办进度
    这类"出事前唯一能救你"的信息。窄终端上该丢的是装饰（键位提示、轮数），不是它们。
    """

    def __init__(self, name: str, text: str, style: str = "class:footer",
                 priority: int = 50) -> None:
        self.name = str(name)
        self.text = str(text)
        self.style = str(style)
        self.priority = int(priority)

    def __repr__(self) -> str:
        return f"StatusSegment({self.name!r}, {self.text!r}, p={self.priority})"


def parse_statusline(raw: Any) -> Tuple[List[str], List[str]]:
    """解析配置里的 `statusline`：返回 (顺序列表, 未知名字列表)。

    接受 `["model", "permission"]` 或 `"model,permission"`。`-name` 表示**去掉**这一段
    （配置文件里"我只想藏掉轮数"比"重写完整列表"常见）。未知名字不静默忽略：调用方
    据此提示用户（写错名字却被当成"设置成功"，下次会再踩一次）。
    """
    if raw is None or raw == "":
        return list(DEFAULT_STATUS_ORDER), []
    names: List[str] = []
    if isinstance(raw, str):
        names = [x.strip() for x in re.split(r"[,\s]+", raw) if x.strip()]
    elif isinstance(raw, (list, tuple)):
        names = [str(x).strip() for x in raw if str(x).strip()]
    else:
        return list(DEFAULT_STATUS_ORDER), ["<非法类型>"]

    remove = {n[1:] for n in names if n.startswith("-")}
    keep = [n for n in names if not n.startswith("-")]
    unknown = [n for n in keep + sorted(remove) if n not in STATUS_NAMES]
    if keep:
        order = [n for n in keep if n in STATUS_NAMES]
        # 用户没提的段落在后面按默认顺序补齐（"只关心前几个"不必写全）
        order += [n for n in DEFAULT_STATUS_ORDER if n not in order]
    else:
        order = list(DEFAULT_STATUS_ORDER)
    order = [n for n in order if n not in remove]
    return order, unknown


def fit_status_line(segments: Sequence[StatusSegment], width: int,
                    order: Optional[Sequence[str]] = None
                    ) -> List[Tuple[str, str]]:
    """按顺序与优先级把分段塞进 `width` 列，返回 `[(样式, 文本)]`。

    规则：先按 `order` 排序、过滤掉不在里面的段；装不下就**从优先级最低的开始丢**；
    仍然装不下（只剩一段）时按列截断并给省略号 —— 宁可显示半句，也不要一行空底栏。
    """
    w = max(8, int(width or 80))
    want = list(order) if order else list(DEFAULT_STATUS_ORDER)
    by_name = {s.name: s for s in segments or []}
    picked = [by_name[n] for n in want if n in by_name]
    if not picked:
        return []

    def _total(items: Sequence[StatusSegment]) -> int:
        return sum(display_width(s.text) for s in items)

    # 优先级大的先丢；同优先级按"靠后"丢（前面的更接近上下文/模型这两件基本事实）
    dropped: List[StatusSegment] = []
    while len(picked) > 1 and _total(picked) > w:
        drop = max(range(len(picked)),
                   key=lambda i: (picked[i].priority, i))
        dropped.append(picked.pop(drop))
    # 丢完再"能塞回就塞回"：只按优先级丢会得到"只剩模型"这种劣解，而
    # "模型 + 上下文占用"（19 列）明明装得进 20 列 —— 回填一遍，信息更多。
    for seg in sorted(dropped, key=lambda s: s.priority):
        if _total(picked) + display_width(seg.text) <= w:
            picked.append(seg)
    picked.sort(key=lambda s: want.index(s.name) if s.name in want else 999)
    if _total(picked) > w:
        only = picked[0]
        return [(only.style, truncate_width(only.text, w))]
    return [(s.style, s.text) for s in picked]


# ============================================================
# 上下文可视化
# ============================================================

# 占用比例的语义分档（口径与 ai_code.context_usage 一致：估算，不是服务端读数）
_CTX_STATE = {"ok": ("class:footer-dim", "ctx.ok"),
              "near": ("class:footer-w", "ctx.near"),
              "over": ("class:footer-f", "ctx.over")}
_CTX_BAR_FULL = "█"
_CTX_BAR_EMPTY = "░"


def context_meter(usage: Dict[str, Any], width: int = 16,
                  text: str = "") -> str:
    """上下文占用 → `█████░░░░░░░░░░░ 32%`（窗口未知时返回空串）。

    `text` 由调用方给（本模块不碰 i18n）：形如 `"上下文 {bar} {pct}%"`，其中 `{bar}` /
    `{pct}` 会被替换。给空串则只返回 `bar pct%`。
    """
    state = str((usage or {}).get("state") or "unknown")
    if state not in _CTX_STATE:
        return ""
    pct = max(0, min(100, int(round(float(usage.get("pct") or 0)))))
    w = max(4, int(width or 16))
    filled = int(round(w * pct / 100))
    bar = _CTX_BAR_FULL * filled + _CTX_BAR_EMPTY * (w - filled)
    if text:
        return text.replace("{bar}", bar).replace("{pct}", str(pct))
    return f"{bar} {pct}%"


def context_state_style(usage: Dict[str, Any]) -> str:
    """上下文占用对应的样式类名（unknown → 空串，调用方据此不显示）。"""
    return _CTX_STATE.get(str((usage or {}).get("state") or ""), ("", ""))[0]


def context_state_ansi(usage: Dict[str, Any]) -> str:
    """上下文占用对应的 **ANSI 颜色名**（给直接 `print` 的路径用）。

    为什么单列一个函数：底栏用的是 prompt_toolkit 的样式类名（`class:footer-w`），
    而 `c()` 只认 ANSI 名（dim/yellow/red…）。把 `class:footer-w` 的后缀直接喂给
    `c()` 会 `KeyError: 'w'` —— 两套命名混用是会真炸的坑，所以在这里一次性翻好。
    """
    state = str((usage or {}).get("state") or "")
    return {"ok": "dim", "near": "yellow", "over": "red"}.get(state, "")


# ============================================================
# 等待动画：高光 + 停滞判定
# ============================================================

STALL_SECONDS = 45      # 多久没有新进展算"停滞"（提示可中断）
SOFT_STALL_SECONDS = 3  # 多久没有新进展开始"变色"（有活跃工具时不判）
LABEL_DWELL_SECONDS = 0.3   # 状态行文案两次变化之间的最小间隔（防高频切换闪烁）


def should_apply_label(now: float, last_change: float, dwell: float = LABEL_DWELL_SECONDS
                       ) -> bool:
    """状态行文案现在能不能换（纯函数，便于断言防抖规则）。

    规则：**第一次变化立即生效**，之后同一窗口（`dwell`）内的变化要等窗口过去 ——
    否则模型连着切几个工具名时，状态行会以每秒十几次的速度抖，看着像坏了。
    """
    if not last_change:
        return True
    try:
        return (float(now) - float(last_change)) >= max(0.0, float(dwell))
    except (TypeError, ValueError):
        return True


def spinner_verbs(translate: Optional[Callable[[str], str]] = None) -> List[str]:
    """等待时轮换的动词（我们自己写的词，不抄任何现成词库）。

    为什么要有：一个永远显示"思考中"的状态行，用户看两眼就再也不看了；轮换的词
    让"它还在动"这件事**不需要盯着看**。词库经 i18n 键进（三语一致）。
    """
    tr = translate or (lambda k: k)
    return [tr(f"spin_verb_{i}") for i in range(1, 6)]


def shimmer_span(length: int, phase: int, span: int = 3) -> Tuple[int, int]:
    """高光窗口 `[start, end)`：在 `length` 个字符上循环移动（越界自动回绕）。

    为什么要有它：一个静止的点号和一个缓慢移动的高光，在"它到底还在不在干活"这件事上
    给人的信息完全不同 —— 后者即使内容没变也在动。
    """
    n = max(0, int(length))
    if n <= 0:
        return (0, 0)
    s = max(1, min(int(span), n))
    start = int(phase) % n
    end = start + s
    if end <= n:
        return (start, end)
    return (start, n)            # 回绕片段：调用方对两段分别上色即可


def spinner_line(label: str, secs: float, phase: int = 0,
                 stalled: bool = False, width: int = 0,
                 soft_stalled: bool = False) -> str:
    """等待状态行：`◈ 思考中··· 12s`（停滞时补一句"还可以 Ctrl+C"）。

    `phase` 决定点号个数与（配合 `shimmer_span`）高光位置；`width>0` 时按列截断，
    免得等待行自己顶破终端、把光标推到第二行（那会让 `\\r` 重绘错位）。
    两档停滞：`soft_stalled`（几秒没动静 → 加一个安静的标记）/ `stalled`（几十秒 →
    明说可以中断）。分两档是因为"刚卡了一下"和"真的卡住了"该给不同的提示强度。
    """
    dots = "." * (int(phase) % 4)
    secs_i = int(max(0, secs))
    mark = "…" if soft_stalled and not stalled else ""
    line = f"◈ {label}{dots}{mark} {secs_i}s"
    if stalled:
        line += f"（{secs_i}s 没有新进展 · Ctrl+C 可中断）"
    return truncate_width(line, width) if width and width > 0 else line


def is_stalled(idle_secs: float, threshold: float = STALL_SECONDS) -> bool:
    """多久没动静算停滞（纯函数；阈值来自配置时也走这里，便于断言）。"""
    try:
        return float(idle_secs) >= float(threshold)
    except (TypeError, ValueError):
        return False


# ============================================================
# 多行任务树
# ============================================================

# 与 cli/ace_todos 的状态口径一致（pending / in_progress / done / blocked）
_TREE_GLYPH = {"done": "✓", "in_progress": "▶", "pending": "·", "blocked": "✗"}


class TaskNode:
    """任务树节点：`行文本 + 状态 + 子节点`（目标 → 待办 → 正在跑的工具）。"""

    def __init__(self, text: str, status: str = "pending",
                 children: Optional[Sequence["TaskNode"]] = None,
                 note: str = "") -> None:
        self.text = str(text)
        self.status = str(status)
        self.children: List["TaskNode"] = list(children or [])
        self.note = str(note)

    def glyph(self) -> str:
        return _TREE_GLYPH.get(self.status, "·")

    def __repr__(self) -> str:
        return f"TaskNode({self.text!r}, {self.status!r}, n={len(self.children)})"


def build_task_tree(goal: Optional[Dict[str, Any]] = None,
                    todos: Optional[Sequence[Dict[str, Any]]] = None,
                    running: str = "",
                    goal_text: str = "目标", todo_text: str = "待办",
                    running_text: str = "正在执行") -> Optional[TaskNode]:
    """目标 + 逐项待办 + 正在跑的工具 → 一棵树；三者都空时返回 None（调用方不打印）。

    `goal` 用 goal_store.snapshot() 的字段（phase/rounds_started/max_rounds/objective），
    `todos` 用 cli/ace_todos 的条目（id/text/status）。**不为空列表造节点** —— 空树
    打出来只会让人以为"这里本来该有东西"。
    """
    kids: List[TaskNode] = []
    for t in todos or []:
        kids.append(TaskNode(f"#{t.get('id', '?')} {t.get('text', '')}",
                             str(t.get("status") or "pending")))
    if running:
        kids.append(TaskNode(str(running), "in_progress", note="running"))
    if goal and goal.get("phase"):
        phase = str(goal.get("phase"))
        obj = str(goal.get("objective") or "")[:80]
        badge = {"active": f"R{goal.get('rounds_started', 0)}/{goal.get('max_rounds', 0)}",
                 "paused": "paused", "blocked": "blocked",
                 "complete": "done"}.get(phase, phase)
        status = {"active": "in_progress", "paused": "pending",
                  "blocked": "blocked", "complete": "done"}.get(phase, "pending")
        return TaskNode(f"{goal_text} [{badge}] {obj}", status, kids)
    if kids:
        return TaskNode(todo_text, "in_progress", kids)
    return None


def render_task_tree(node: Optional[TaskNode], width: int = 0,
                     indent: int = 0) -> List[str]:
    """任务树 → 待打印行（`├─`/`└─`/`│ ` 连接线，宽度感知）。

    `width>0` 时按列截断（中文两列），否则原样。空树返回 `[]`。
    """
    if node is None:
        return []
    out: List[str] = []

    def _walk(n: TaskNode, prefix: str, last: bool, is_root: bool) -> None:
        if is_root:
            line = f"{n.glyph()} {n.text}"
            # 根节点带**小进度条**（八分之一块，照 Claude Code `ProgressBar` 的做法）：
            # "3/8 走了多少"用文字看不出来，一根条一眼够。只给 10 格，免得这行被撑到折行。
            if n.children:
                _done = sum(1 for _c in n.children if _c.status == "done")
                _total = len(n.children)
                line += (f"  {ace_widgets.progress_bar(_done / _total, 10)}"
                         f" {_done}/{_total}")
        else:
            line = f"{prefix}{'└─ ' if last else '├─ '}{n.glyph()} {n.text}"
        if n.note:
            line += f"  ({n.note})"
        out.append(truncate_width(line, width) if width and width > 0 else line)
        child_prefix = prefix + ("   " if last else "│  ") if not is_root else ""
        for i, c in enumerate(n.children):
            _walk(c, child_prefix, i == len(n.children) - 1, False)

    _walk(node, " " * max(0, int(indent)), True, True)
    return out


# ============================================================
# 首屏动效（帧序列是纯数据）
# ============================================================

def banner_frames(title: str, subtitle: str = "",
                  steps: int = 6) -> List[List[str]]:
    """标题逐字浮现 + 下划线生长的帧序列（最后一帧 = 完整静态画面）。

    TTY 才播（调用方判断），非 TTY 直接取 `frames[-1]` —— 动画是给眼睛的糖，
    不该让管道/CI 里的输出多出几帧噪音。
    """
    t = str(title or "")
    n = max(1, int(steps))
    frames: List[List[str]] = []
    tw = max(1, display_width(t))
    for i in range(1, n + 1):
        cut = max(1, int(round(len(t) * i / n)))
        shown = t[:cut]
        width_i = max(1, int(round(tw * i / n)))
        frames.append([shown, "─" * width_i])
    frames[-1] = [t, "─" * tw + (f"  {subtitle}" if subtitle else "")]
    return frames


# ============================================================
# 区域划分（全屏布局）
# ============================================================

def compute_layout(rows: int, cols: int = 80, tree_lines: int = 0,
                   want_header: bool = True, want_tree: bool = True,
                   min_transcript: int = 3) -> Dict[str, int]:
    """终端尺寸 → 各区域高度：`{header, tree, transcript, status, input}`。

    退化顺序是刻意的：**先砍装饰（头部/任务树），再压正文，最后才动输入行** ——
    输入行被挤掉的界面等于坏了。行数再小也保住 `input=1`、`status=1`，正文至少 1 行。
    """
    r = max(3, int(rows or 24))
    header = 1 if want_header else 0
    status = 1
    input_h = 1
    tree = max(0, int(tree_lines)) if want_tree else 0

    def _rest() -> int:
        return r - header - tree - status - input_h

    if _rest() < min_transcript:                     # 不够放正文：先砍树
        tree = 0
    if _rest() < min_transcript:                     # 还不行就砍头部
        header = 0
    transcript = max(1, _rest())
    return {"header": header, "tree": tree, "transcript": transcript,
            "status": status, "input": input_h}
