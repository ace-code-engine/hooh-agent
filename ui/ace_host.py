#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_host —— 引擎路径的界面宿主：把"引擎问用户"变成底部区的一次内联问答

契约与 `tui/app.py` 的 `AceTuiApp` 一致（`choose` / `ask_permission` /
`ask_question` / `ask_text` / `confirm`），引擎侧那几处 `hasattr(ui, ...)` 不用改就能挂上。

两处刻意的不同：

1. **内联，不弹模态框**——面板顶替输入行。层级靠反显与灰阶，弹窗是最后一招。
2. **按键来自注入的 `KeySource`**，所以整条问答链路能在没有终端的情况下被断言。

分成三个东西，是因为**跨线程**：

- `Question`：纯状态机（`render()` 出画面，`feed(key)` 收键）；
- `_drive()`：读键 + 重画，直到问出答案——**只在主线程跑**；
- `EngineHost`：引擎看到的那张脸。给了 `pump` 就交给主循环去问（worker 线程只等），
  没给就自己驱动（测试/单线程场景）。

这么分的原因很实在：键盘只有一个，渲染也只有一个线程。让 worker 线程直接读键，
就是让两个线程抢同一个终端——这类 bug 只在真机上偶发，测试永远抓不到。
"""

from __future__ import annotations

from typing import Any, Callable, List, Optional, Sequence, Tuple

from ui.ace_cell import Screen, Segment
from ui.ace_text import truncate_width

__all__ = ["Question", "EngineHost", "check"]

_HINT = "↑↓ 选 · 回车确认 · Esc 拒绝"
_HINT_TEXT = "回车确认 · Esc 取消 · 退格删除"
_UNSET = Ellipsis          # "没指定拒绝值"的哨兵：None 本身可能是合法的拒绝值


class Question:
    """一次内联问答的状态机。`feed(key)` 返回 `(是否问完, 答案)`。"""

    def __init__(self, title: str, options: Sequence[Any] = (),
                 default: str = "", allow_text: bool = False, hidden: bool = False,
                 deny: Any = _UNSET, width: int = 80) -> None:
        self.title = str(title)
        self.default = str(default or "")
        self.allow_text = bool(allow_text)
        self.hidden = bool(hidden)
        self.deny = deny
        self.width = int(width)
        # 选项统一成 (值, 文案, 危险)：choose 给 2 元组、ask_permission 给 3 元组
        self.options: List[Tuple[Any, str, bool]] = [
            (o[0], str(o[1]) if len(o) > 1 else str(o[0]),
             bool(o[2]) if len(o) > 2 else False) for o in options]
        self.sel = 0
        self.buf = ""

    # ---- 画面 ----
    def render(self) -> Screen:
        rows: Screen = [[Segment(truncate_width(self.title, self.width), "text")]]
        for i, (_v, label, danger) in enumerate(self.options):
            mark = "▸ " if i == self.sel else "  "
            text = truncate_width("{}{}) {}".format(mark, i + 1, label), self.width)
            rows.append([Segment(text, "err" if danger else "text", None, i == self.sel)])
        if self.allow_text or self.buf:
            shown = "*" * len(self.buf) if self.hidden else self.buf
            rows.append([Segment("  ▊ " + shown, "text")])
        rows.append([Segment("  " + (_HINT_TEXT if self.allow_text else _HINT), "dim")])
        return rows

    # ---- 按键 ----
    def deny_value(self) -> Any:
        return None if self.deny is _UNSET else self.deny

    def feed(self, key: str) -> Tuple[bool, Any]:
        if self.options:
            if key in ("up", "k"):
                self.sel = (self.sel - 1) % len(self.options)
                return False, None
            if key in ("down", "j"):
                self.sel = (self.sel + 1) % len(self.options)
                return False, None
            if len(key) == 1 and key.isdigit():
                idx = int(key) - 1
                if 0 <= idx < len(self.options):
                    self.sel = idx
                    return True, self.options[idx][0]
        if self.allow_text:
            if key == "backspace":
                self.buf = self.buf[:-1]
                return False, None
            if len(key) == 1 and key.isprintable():
                self.buf += key
                return False, None
        return False, None

    def submit(self) -> Tuple[bool, Any]:
        """回车 / EOF 时的结论。"""
        if self.allow_text:
            return True, (self.buf or self.default)
        if self.options:
            return True, self.options[self.sel][0]
        return True, None


def drive(q: Question, read: Callable[[], Optional[str]], screen,
          first: Optional[str] = None) -> Any:
    """把一个问题问到底（主线程专用）：画 → 读键 → 更新，直到有答案。

    `first` 用来把"刚在主循环里读到的那一个键"交给问题——不问就丢掉的话，用户按的
    第一下会莫名其妙不见（问题恰好在这 50ms 里到达时最容易撞上）。

    EOF 按**拒绝**处理：这是引擎那条"拿不到答案就拒绝"的口径在界面上的样子。
    """
    key: Optional[str] = first
    while True:
        screen.set_region(q.render())
        screen.flush()
        if key is None:
            key = read()
        if key == "":
            screen.set_region(None)
            return q.deny_value()
        if key is None:                     # read() 超时：接着等
            continue
        if key == "esc":
            screen.set_region(None)
            return q.deny_value()
        if key == "enter":
            screen.set_region(None)
            return q.submit()[1]
        done, ans = q.feed(key)
        key = None
        if done:
            screen.set_region(None)
            return ans


class EngineHost:
    """挂在 `cli.attach_ui(host)` 上的宿主；所有提问都走 `_ask` 这一个原语。"""

    def __init__(self, screen, keys, translate: Optional[Callable[..., str]] = None,
                 width: Optional[int] = None, pump: Any = None) -> None:
        self.screen = screen
        self.keys = keys
        self.t = translate or (lambda k, **kw: k)
        self.width = int(width or screen.width)
        self.pump = pump
        self.answers: List[str] = []          # 每次问答的结论（审计/测试用）

    # ---------------- 对引擎的契约 ----------------
    def choose(self, title: str, items: Sequence[Any], with_effort: bool = False
               ) -> Optional[Any]:
        opts = [(it, self._label(it)) for it in items]
        return self._ask(str(title), opts)

    def ask_permission(self, tool: str, reason: str, options: Sequence[Sequence[Any]]
                       ) -> str:
        """`options` 是 `[(value, i18n_key, danger), ...]`（见 `ui/ace_turn.PERMISSION_OPTIONS`）。

        默认停在第一项（"就这一次"），危险的"本会话允许"用 error 色标出来——
        它不是"就这一次"的变体，是一次权力扩张。拿不到答案一律当拒绝。
        """
        opts: List[Tuple[Any, str, bool]] = []
        for opt in options:
            val = opt[0]
            key = opt[1] if len(opt) > 1 else str(val)
            danger = bool(opt[2]) if len(opt) > 2 else False
            opts.append((val, self.t(key), danger))
        title = self.t("perm_request_title", tool=tool)
        if reason:
            title += "　" + str(reason)
        picked = self._ask(title, opts)
        answer = "deny" if picked is None else str(picked)
        self.answers.append("perm:" + answer)
        return answer

    def confirm(self, question: str) -> bool:
        picked = self._ask(str(question), [(True, self._tr("yes", "是")),
                                           (False, self._tr("no", "否"))])
        self.answers.append("confirm:" + ("yes" if picked else "no"))
        return bool(picked)

    def ask_text(self, prompt: str, default: str = "", hidden: bool = False
                 ) -> Optional[str]:
        out = self._ask(str(prompt), [], default=str(default or ""), allow_text=True,
                        hidden=bool(hidden))
        self.answers.append("text:" + ("<hidden>" if hidden else str(out)))
        return None if out is None else str(out)

    def ask_question(self, question: str) -> Optional[str]:
        return self.ask_text(str(question))

    def _tr(self, key: str, fallback: str) -> str:
        """取翻译；没有这个键就回退到给定文案（宿主不能因为缺词条就崩）。"""
        try:
            got = self.t(key)
        except Exception:          # noqa: BLE001
            return fallback
        return fallback if got == key else str(got)

    def _label(self, item: Any) -> str:
        if isinstance(item, (tuple, list)) and len(item) > 1:
            return str(item[1])
        return str(item)

    # ---------------- 一个原语 ----------------
    def _ask(self, title: str, options: Sequence[Any], default: str = "",
             allow_text: bool = False, hidden: bool = False, deny: Any = _UNSET) -> Any:
        q = Question(title, options, default, allow_text, hidden, deny, self.width)
        if self.pump is not None:
            return self.pump.ask(q)            # 交主循环问（worker 线程在这里等）
        return drive(q, self.keys.read, self.screen)


def check(width: int = 60) -> List[str]:
    """宿主契约验收：默认项、数字直选、方向键、Esc=拒绝、文本输入、答完清屏。"""
    import io

    from ui.ace_prompt import KeySource
    from ui.ace_screen import SessionScreen

    bad: List[str] = []
    OPTS = [("once", "就这一次", False), ("session", "本会话允许", True),
            ("deny", "拒绝", False)]

    def host(keys_text: str):
        writes: List[str] = []
        screen = SessionScreen(writes.append, width=width, profile="none")
        h = EngineHost(screen, KeySource(stream=io.StringIO(keys_text)),
                       translate=lambda k, **kw: k)
        return h, screen, writes

    h, _s, _w = host("\r")
    if h.ask_permission("file_write", "要改文件", OPTS) != "once":
        bad.append("权限默认项应为 once")

    h, _s, _w = host("2")
    if h.ask_permission("file_write", "", OPTS) != "session":
        bad.append("数字 2 应直选 session")

    h, _s, _w = host("\x1b")
    if h.ask_permission("file_write", "", OPTS) != "deny":
        bad.append("Esc 应等价于拒绝")

    h, _s, _w = host("\x1b[A\r")
    if h.ask_permission("file_write", "", OPTS) != "deny":
        bad.append("上箭头应绕到拒绝项")

    h, _s, writes = host("\r")
    h.ask_permission("file_write", "", OPTS)
    if "本会话允许" not in "".join(writes):
        bad.append("选项文案没画出来")

    h, _s, _w = host("\r")
    if h.confirm("确定要跑吗") is not True:
        bad.append("confirm 回车应为真")
    h, _s, _w = host("2")
    if h.choose("选一个", ["a", "b"]) != "b":
        bad.append("choose 数字选择失败")
    h, _s, _w = host("abc\r")
    if h.ask_text("名字", default="x") != "abc":
        bad.append("ask_text 读不到输入")
    h, _s, _w = host("\r")
    if h.ask_text("名字", default="x") != "x":
        bad.append("ask_text 空输入应回退默认值")

    h, screen, writes = host("\r")
    h.confirm("确定要跑吗")
    writes.clear()
    if screen.flush() <= 0:
        bad.append("答完没有收回问题区（问题会留在屏幕上）")
    if screen.flush() != 0:
        bad.append("收回之后还在写（应该安静下来）")
    return bad
