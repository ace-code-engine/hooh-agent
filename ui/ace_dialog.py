#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_dialog —— 统一对话框：单选/多选/分组/进度/分页签 + 向导框架

为什么需要：此前"弹个框问一句"散在三处（`_pick_option` 用选择器、`_config_wizard`
用一串 `input()`、权限档位用选择器），各有各的排版与按键约定。同一个软件里问同一件
事有两种长相，用户每次都要重新学一遍。这里把"对话框"抽成**一份数据 + 一个渲染器**：

- 数据：`DialogSpec`（标题/条目/模式/分组/页签/进度条/脚注），条目是 `DialogItem`；
- 渲染：`render_dialog()` 纯函数出**行**（宽度感知，复用 `ui/ace_text`），
  非交互场景直接打印它 —— 脚本里看到的东西和 TTY 里弹的是同一个模型；
- 交互：`run_dialog()` 复用 `ui/ace_selector` 的浮层（模糊过滤、↑↓、Esc），
  单选/多选只差一个模式位，不再各写一套；
- 向导：`WizardStep` / `WizardState` + `wizard_answer()` 是**纯状态机**，
  能后退、能校验、能取消。调用方只提供"怎么问一句"（`ask` 回调），
  所以整条流程在没有终端的环境里也能被断言。

两条纪律：
- **纯函数**：`render_dialog` / `progress_bar` / `validate` / `wizard_answer` 只依赖入参，
  `styler` 可注入（测试传 no-op 就能断言纯文本）。
- **不编数字**：进度条在总数未知（0）时显示 `—`，不拿 0 当分母造一个假百分比。
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from ui.ace_text import display_width, pad_width, truncate_width

__all__ = [
    "DialogItem", "DialogSpec", "DialogResult", "WizardStep", "WizardState",
    "grouped_rows", "visible_items", "checked_keys", "apply_checks",
    "validate_selection", "progress_bar", "tab_bar", "render_dialog",
    "run_dialog", "wizard_answer", "wizard_back", "wizard_restep",
    "render_wizard", "BAR_FULL", "BAR_EMPTY",
]

BAR_FULL = "█"
BAR_EMPTY = "░"
MIN_BAR = 6


def _plain(kind: str, text: str) -> str:
    """no-op styler（测试与无颜色终端用）。签名与真 styler 一致：`(kind, text)`。"""
    return text


# ============================================================
# 数据模型
# ============================================================

class DialogItem:
    """对话框里的一条：`key` 是回给调用方的身份，其余都只是给人看的。

    `group` 非空时，渲染时它前面会插一行组标题 —— 权限档位、工具清单这类
    "同一件事的不同类"混在一个平铺列表里，用户读不出边界。
    `disabled` 的条目**能看见但不能选**（例如被设计拒绝会话级授权的工具），
    让它在列表里消失反而会让人以为"这功能漏了"。
    """

    def __init__(self, key: str, label: str, detail: str = "",
                 group: str = "", disabled: bool = False,
                 note: str = "", checked: bool = False) -> None:
        self.key = str(key)
        self.label = str(label)
        self.detail = str(detail)
        self.group = str(group)
        self.disabled = bool(disabled)
        self.note = str(note)
        self.checked = bool(checked)

    def text(self) -> str:
        """列表里显示的一行（不含选中/勾选标记，标记由渲染器加）。"""
        out = self.label
        if self.detail:
            out += "  " + self.detail
        if self.note:
            out += "  " + self.note
        return out

    def __repr__(self) -> str:  # 便于测试失败时看清是什么
        return f"DialogItem({self.key!r}, {self.label!r}, group={self.group!r})"


class DialogSpec:
    """一份对话框的全部输入。

    mode: "single"（单选，回车即定）或 "multi"（多选，Space 勾，回车确认）。
    tabs: 可选页签标题列表（展示用；切页由调用方决定要不要接）。
    progress: 可选 `(done, total, 说明)`，渲染在标题下方。
    """

    def __init__(self, title: str, items: Sequence[DialogItem],
                 mode: str = "single", hint: str = "",
                 keys_hint: str = "", tabs: Sequence[str] = (),
                 active_tab: int = 0,
                 progress: Optional[Tuple[int, int, str]] = None,
                 allow_empty: bool = False, empty_text: str = "（没有可选项）") -> None:
        self.title = str(title)
        self.items = list(items or [])
        self.mode = "multi" if str(mode).lower() == "multi" else "single"
        self.hint = str(hint)
        self.keys_hint = str(keys_hint)
        self.tabs = [str(x) for x in (tabs or [])]
        self.active_tab = max(0, int(active_tab or 0))
        self.progress = progress
        self.allow_empty = bool(allow_empty)
        self.empty_text = str(empty_text)

    # ---- 便捷视图 ----
    @property
    def selectable(self) -> List[DialogItem]:
        return [it for it in self.items if not it.disabled]

    def initial_checked(self) -> List[str]:
        return [it.key for it in self.items if it.checked and not it.disabled]

    def by_key(self, key: str) -> Optional[DialogItem]:
        for it in self.items:
            if it.key == key:
                return it
        return None


class DialogResult:
    """对话框的结果：`accepted` 与选中的 key 列表。取消 = `accepted=False`。"""

    def __init__(self, accepted: bool, keys: Sequence[str] = (),
                 values: Optional[Dict[str, Any]] = None) -> None:
        self.accepted = bool(accepted)
        self.keys = list(keys or [])
        self.values = dict(values or {})

    @property
    def cancelled(self) -> bool:
        return not self.accepted

    @property
    def key(self) -> Optional[str]:
        return self.keys[0] if self.keys else None

    def __repr__(self) -> str:
        return (f"DialogResult(accepted={self.accepted}, keys={self.keys!r})")


# ============================================================
# 纯逻辑：分组 / 过滤 / 勾选
# ============================================================

def grouped_rows(items: Sequence[DialogItem]
                 ) -> List[Tuple[str, Any]]:
    """扁平列表 → `[("group", 组名), ("item", DialogItem), ...]`。

    组标题只在**组名变化**时插一次；没有 `group` 的条目直接跟在当前组里
    （不凭空造一个"其他"组 —— 那是渲染器替用户做决定）。
    """
    rows: List[Tuple[str, Any]] = []
    cur = None
    for it in items or []:
        if it.group and it.group != cur:
            rows.append(("group", it.group))
            cur = it.group
        rows.append(("item", it))
    return rows


def visible_items(spec: DialogSpec, query: str = "") -> List[DialogItem]:
    """按模糊查询过滤（复用 `ui/ace_selector.filter_items`，与选择器同一套评分）。

    组标题不参与匹配：用户搜的是条目，不是分组名。
    """
    items = list(spec.items or [])
    if not str(query or "").strip():
        return items
    try:
        from ui.ace_selector import filter_items
    except ImportError:            # 极端情况下（禁用 ui 包）退化为不排序的包含匹配
        q = str(query).lower()
        return [it for it in items if q in it.text().lower()]
    labels = [it.text() for it in items]
    order = [i for i, _score in filter_items(labels, str(query))]
    # 被过滤掉的条目里，组标题也该一起消失：所以按过滤结果重建
    return [items[i] for i in order]


def checked_keys(items: Sequence[DialogItem]) -> List[str]:
    """当前勾选的 key（保持条目顺序，便于断言与稳定输出）。"""
    return [it.key for it in items or [] if it.checked]


def apply_checks(items: Sequence[DialogItem], keys: Sequence[str]
                 ) -> List[DialogItem]:
    """把 key 集合落到条目上（返回**新列表**，不改入参 —— 纯函数好断言）。"""
    want = {str(k) for k in (keys or [])}
    out: List[DialogItem] = []
    for it in items or []:
        copy = DialogItem(it.key, it.label, it.detail, it.group, it.disabled,
                          it.note, checked=it.key in want and not it.disabled)
        out.append(copy)
    return out


def toggle_checked(items: Sequence[DialogItem], key: str) -> List[str]:
    """勾选/取消一条，返回新的 key 列表。禁用的条目**不许勾**（点它等于没点）。"""
    keys = checked_keys(items)
    target = None
    for it in items or []:
        if it.key == str(key):
            target = it
            break
    if target is None or target.disabled:
        return keys
    if target.key in keys:
        keys.remove(target.key)
    else:
        keys.append(target.key)
    return keys


def validate_selection(spec: DialogSpec, keys: Sequence[str]) -> str:
    """校验选中集合，返回错误文本（空串 = 通过）。

    单选必须恰好一项；多选默认至少一项（`allow_empty=True` 才允许空手确认 ——
    "什么都不选"和"取消"必须是两个不同的动作，否则用户分不清自己干了什么）。
    """
    sel = [str(k) for k in (keys or [])]
    known = {it.key for it in spec.items or []}
    unknown = [k for k in sel if k not in known]
    if unknown:
        return f"未知条目: {', '.join(unknown)}"
    disabled = [it.key for it in spec.items or [] if it.disabled and it.key in sel]
    if disabled:
        return f"这些条目不可选: {', '.join(disabled)}"
    if spec.mode == "single":
        if len(sel) != 1:
            return "请选择一项"
    elif not sel and not spec.allow_empty:
        return "请至少选择一项（或按 Esc 取消）"
    return ""


# ============================================================
# 纯渲染：进度条 / 页签 / 整个框
# ============================================================

def progress_bar(done: int, total: int, width: int = 24,
                 styler: Callable[[str, str], str] = _plain,
                 label: str = "") -> str:
    """`████████░░░░░░░░ 2/5 40%`；总数未知（<=0）时给 `—`，不编百分比。"""
    try:
        d, t = int(done), int(total)
    except (TypeError, ValueError):
        return styler("dim", "—")
    if t <= 0:
        return styler("dim", (label + " " if label else "") + "—")
    d = max(0, min(d, t))
    w = max(MIN_BAR, int(width))
    filled = int(round(w * d / t))
    bar = BAR_FULL * filled + BAR_EMPTY * (w - filled)
    pct = int(round(d * 100 / t))
    head = (label + " ") if label else ""
    return (styler("cyan", head + bar)
            + styler("dim", f" {d}/{t} {pct}%"))


def tab_bar(tabs: Sequence[str], active: int = 0,
            styler: Callable[[str, str], str] = _plain) -> str:
    """`[ 常规 ]│ 高级`（当前页签加方括号，其余留空位保持列宽稳定）。"""
    names = [str(x) for x in (tabs or [])]
    if not names:
        return ""
    active = max(0, min(int(active or 0), len(names) - 1))
    parts = []
    for i, name in enumerate(names):
        parts.append(styler("bold", f"[ {name} ]") if i == active else f"  {name}  ")
    return styler("dim", "│").join(parts)


def _kv_line(inner: int, text: str, styler: Callable[[str, str], str],
             kind: str = "") -> str:
    body = pad_width(truncate_width(text, inner), inner)
    return styler("dim", "│ ") + (styler(kind, body) if kind else body) \
        + styler("dim", " │")


def render_dialog(spec: DialogSpec, query: str = "", cursor: int = 0,
                  checked: Sequence[str] = (), tab: int = 0,
                  width: int = 76,
                  styler: Callable[[str, str], str] = _plain) -> List[str]:
    """对话框 → 待打印行（宽度感知，含边框/页签/进度/脚注）。

    `cursor` 是**可见行**里的下标（与选择器一致：过滤后就地定位），
    `checked` 是勾选集合（多选模式用）。
    """
    w = max(30, int(width or 76))
    inner = w - 4                                   # "│ " + 内容 + " │"
    lines: List[str] = []
    title = truncate_width(spec.title or "选择", inner)
    # 边框宽度必须与内容行对齐：`┌ `(2) + 标题 + ` `(1) + 横线 + `┐`(1) = w
    head = ("┌ " + title + " "
            + "─" * max(0, inner - display_width(title)) + "┐")
    lines.append(styler("bold", head))

    if spec.tabs:
        lines.append(_kv_line(inner, tab_bar(spec.tabs, tab, styler), styler))
    if spec.progress is not None:
        done, total, label = (list(spec.progress) + ["", ""])[:3]
        lines.append(_kv_line(inner,
                              progress_bar(done, total, 24, styler, str(label)),
                              styler))
    if spec.hint:
        lines.append(_kv_line(inner, spec.hint, styler, "dim"))

    rows = grouped_rows(visible_items(spec, query))
    if not rows:
        lines.append(_kv_line(inner, spec.empty_text, styler, "dim"))
    checked_set = {str(k) for k in (checked or [])}
    shown = 0
    for kind, item in rows:
        if kind == "group":
            lines.append(_kv_line(inner, f"— {item}", styler, "dim"))
            continue
        assert isinstance(item, DialogItem)
        mark = "▶" if shown == int(cursor or 0) else " "
        box = ""
        if spec.mode == "multi":
            box = "[x] " if item.key in checked_set else "[ ] "
        suffix = "（不可选）" if item.disabled else ""
        text = f"{mark} {box}{item.text()}{suffix}"
        lines.append(_kv_line(inner, text, styler,
                              "bold" if shown == int(cursor or 0) else ""))
        shown += 1

    lines.append(styler("dim", "├" + "─" * (inner + 2) + "┤"))
    if query:
        lines.append(_kv_line(inner, f"过滤: {query}", styler, "cyan"))
    lines.append(_kv_line(inner, spec.keys_hint or _default_keys_hint(spec, checked),
                          styler, "dim"))
    lines.append(styler("dim", "└" + "─" * (inner + 2) + "┘"))
    return lines


def _default_keys_hint(spec: DialogSpec, checked: Sequence[str] = ()) -> str:
    if spec.mode == "multi":
        n = len([k for k in (checked or []) if k])
        return "Space 勾选 · Enter 确认 · Esc 取消" + (f" · 已选 {n}" if n else "")
    return "输入即过滤 · ↑↓ 移动 · Enter 确认 · Esc 取消"


# ============================================================
# 交互：复用选择器浮层（单选/多选同一条路）
# ============================================================

def run_dialog(spec: DialogSpec, selector: Optional[Callable[..., Any]] = None,
               multi_selector: Optional[Callable[..., Any]] = None
               ) -> DialogResult:
    """真弹框。返回 `DialogResult`（取消时 `accepted=False`）。

    - 单选走 `run_selector`，多选走 `run_multiselect`（同一套浮层与按键）；
    - 选择器不可用 / 非 TTY：单选取第一个可选项（与既有 `_pick_option` 语义一致），
      多选取 `initial_checked()` —— 脚本里**不阻塞**，但也不会假装用户选过；
    - `disabled` 的条目不进候选列表（渲染器里仍能看到它们，知道"有这一项"）。
    """
    selectable = spec.selectable
    if not selectable:
        return DialogResult(False)
    labels = [it.text() for it in selectable]
    if spec.mode == "multi":
        if multi_selector is None:
            from ui.ace_selector import run_multiselect
            multi_selector = run_multiselect
        initial = [i for i, it in enumerate(selectable) if it.key in
                   set(spec.initial_checked())]
        picked = multi_selector(spec.title, labels, initial=initial)
        if picked is None:
            return DialogResult(False)
        keys = [selectable[i].key for i in picked if 0 <= i < len(selectable)]
        if not keys and not spec.allow_empty:
            return DialogResult(False)
        return DialogResult(True, keys)

    if selector is None:
        from ui.ace_selector import run_selector
        selector = run_selector
    idx = selector(spec.title, labels)
    if idx is None or not (0 <= idx < len(selectable)):
        return DialogResult(False)
    return DialogResult(True, [selectable[idx].key])


# ============================================================
# 向导框架（纯状态机）
# ============================================================

class WizardStep:
    """向导的一步：怎么问、默认值是什么、允许跳过吗、答案怎么校验。

    `validate(answer) -> str` 返回错误文本（空串 = 通过）。`choices` 只用于展示
    （把可选值列出来），真正的取值判定仍在 `validate` 里 —— 展示与判定同源是最好的，
    但这里刻意不合并：展示可以宽松（给人看），判定必须严（给数据把关）。

    `choice_values` 是 `choices` 的**平行表：展示串 → 答案值**。有了它，外壳就能把
    "可选值"弹成**选择框**（与 `/provider` 同一套交互），再把选中项折回答案 ——
    而不是先打一份清单、再让用户手输编号。留空 = 没有这个对应关系，界面退回文本输入。
    """

    def __init__(self, key: str, title: str, prompt: str,
                 default: str = "", hidden: bool = False,
                 choices: Sequence[str] = (), help_text: str = "",
                 skippable: bool = True,
                 validate: Optional[Callable[[str], str]] = None,
                 choice_values: Sequence[str] = ()) -> None:
        self.key = str(key)
        self.title = str(title)
        self.prompt = str(prompt)
        self.default = str(default)
        self.hidden = bool(hidden)
        self.choices = [str(x) for x in (choices or [])]
        self.choice_values = [str(x) for x in (choice_values or ())]
        self.help_text = str(help_text)
        self.skippable = bool(skippable)
        self.validate = validate

    def check(self, answer: str) -> str:
        """校验一步的答案（空答案 = 跳过，`skippable=False` 时不允许）。"""
        text = str(answer or "").strip()
        if not text:
            return "" if self.skippable else "这一项不能跳过"
        if self.validate is not None:
            try:
                return str(self.validate(text) or "")
            except Exception as e:  # noqa: BLE001 —— 校验器自己崩了不该让向导崩
                return f"校验失败: {type(e).__name__}: {e}"
        return ""


class WizardState:
    """向导进度：第几步、已经答了什么、上一步的错误。

    **答案先攒着，最后一起落库**：此前 `/config` 是边问边改 `self.cfg`，中途 Ctrl+C
    说"未保存"，可内存里的 base_url/model 早被改过一轮了 —— 说话与事实不一致。
    现在取消就是真的什么都没发生。
    """

    def __init__(self, steps: Sequence[WizardStep],
                 answers: Optional[Dict[str, str]] = None,
                 index: int = 0, error: str = "", done: bool = False,
                 cancelled: bool = False) -> None:
        self.steps = list(steps or [])
        self.answers: Dict[str, str] = dict(answers or {})
        self.index = max(0, min(int(index or 0), len(self.steps)))
        self.error = str(error)
        self.done = bool(done) or self.index >= len(self.steps)
        self.cancelled = bool(cancelled)

    @property
    def current(self) -> Optional[WizardStep]:
        if self.done or not self.steps:
            return None
        return self.steps[min(self.index, len(self.steps) - 1)]

    @property
    def step_no(self) -> int:
        return min(self.index + 1, len(self.steps))

    def copy(self, **kw: Any) -> "WizardState":
        st = WizardState(self.steps, self.answers, self.index, self.error,
                         self.done, self.cancelled)
        for k, v in kw.items():
            setattr(st, k, v)
        return st


def wizard_answer(state: WizardState, raw: str) -> WizardState:
    """吃一步答案，返回新状态（纯函数；`b`/`back` = 后退一步）。

    空答案 = 用默认值（`WizardStep.default`）；校验不过就停在原地并带上错误文本，
    不前进也不丢已答的内容。
    """
    if state.cancelled or state.done:
        return state
    step = state.current
    if step is None:
        return state.copy(done=True)
    text = str(raw or "").strip()
    if text.lower() in ("b", "back", ":b"):
        return wizard_back(state)
    err = step.check(text)
    if err:
        return state.copy(error=err)
    answers = dict(state.answers)
    answers[step.key] = text or step.default
    nxt = state.copy(answers=answers, index=state.index + 1, error="")
    if nxt.index >= len(nxt.steps):
        nxt.done = True
    return nxt


def wizard_back(state: WizardState) -> WizardState:
    """后退一步（第一步时原地不动，并说清楚为什么）。"""
    if state.index <= 0:
        return state.copy(error="已经在第一步了")
    return state.copy(index=state.index - 1, error="", done=False)


def wizard_restep(state: WizardState, steps: Sequence[WizardStep]) -> WizardState:
    """换一套步骤定义，保留已答内容与进度。

    为什么需要：后面几步的**可选值依赖前面的答案**（选了 Kimi 就该列 Kimi 的模型，
    而不是 DeepSeek 的）。纯状态机不该自己去猜这件事，所以调用方在每一步之后按当前
    答案重建步骤表，再由这里把进度接上 —— 换了步骤表，已答的答案一个都不丢。
    """
    return WizardState(steps, state.answers, state.index, state.error,
                       state.done, state.cancelled)


def render_wizard(state: WizardState, width: int = 76,
                  styler: Callable[[str, str], str] = _plain) -> List[str]:
    """当前这一步 → 待打印行（进度 N/M、提示、可选值、错误、脚注）。"""
    w = max(30, int(width or 76))
    inner = w - 4
    lines: List[str] = []
    step = state.current
    head = f"向导 {state.step_no}/{len(state.steps)}"
    if step is not None:
        head += f" · {step.title}"
    lines.append(styler("bold", "┌ " + truncate_width(head, inner - 2) + " "
                        + "─" * max(0, inner - display_width(head)) + "┐"))
    if step is not None:
        # 隐藏步骤**不许**把默认值画出来（H-34c）：这个渲染器是 `ui/` 回落路径的画法，
        # 而它此前完全不认识 `hidden` —— 只要哪天隐藏步骤带了默认值（例如"已配置的密钥"），
        # 这里就会把它原样印在屏幕上。
        _body = step.prompt if step.hidden else (
            f"{step.prompt}  [{step.default}]" if step.default else step.prompt)
        lines.append(_kv_line(inner, _body, styler))
        if step.choices:
            lines.append(_kv_line(inner, "可选: " + " / ".join(step.choices[:8]),
                                  styler, "dim"))
        if step.help_text:
            lines.append(_kv_line(inner, step.help_text, styler, "dim"))
    if state.error:
        lines.append(_kv_line(inner, state.error, styler, "red"))
    lines.append(styler("dim", "├" + "─" * (inner + 2) + "┤"))
    lines.append(_kv_line(inner, "回车跳过（用默认值）· b 后退 · Ctrl+C 取消",
                          styler, "dim"))
    lines.append(styler("dim", "└" + "─" * (inner + 2) + "┘"))
    return lines
