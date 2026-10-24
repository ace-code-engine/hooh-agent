#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_fullscreen —— 备用屏幕全屏会话：头部 + 会话滚动区 + 状态行 + 输入行

为什么需要：普通 REPL 是"命令行式的流水账" —— 输出一直往上滚，模型一轮跑几十条工具
之后，想回看刚才那张卡片只能翻终端回滚缓冲；状态行挤在 prompt_toolbar 一行里。全屏
（备用屏幕）把它们分成固定四块：头部一行、**会话滚动区**（可以用 PageUp/滚轮回看，
不乱屏）、状态行（`ui/ace_layout` 的可配置分段）、输入行。

设计取舍（写在这里，免得下一版又纠结一遍）：
- 会话滚动区直接复用 `ui/ace_chatscroll.ChatScroll` 的纯滚动数学（贴底/回看/翻页），
  这里只负责把它的视口画进窗口 —— 滚动逻辑一份，两个前端不会漂。
- 输出进滚动区靠**替换 sys.stdout**（`TranscriptSink`）：CLI 照常 `print`，字节被按行
  收进缓冲。带 `\r` 的写（spinner 重绘、进度行）整条丢掉 —— 那些是"此刻"的画面，
  收进滚动区只会变成一屏残影。
- 全屏期间**不开嵌套的浮层选择框**（prompt_toolkit 的 Application 不能安全嵌套）：
  `_interactive_tty()` 在全屏里返回 False，选择类命令退化成"打印列表/取默认"，要弹框
  按 F5 退出全屏即可。这是刻意取舍，不是漏做。
- 不做鼠标命中测试/虚拟滚动条：那是 React-Ink 那套渲染器的活，命令行里没有对应物，
  硬做只会得到一个更慢的假货。
"""

from __future__ import annotations

import sys
from typing import Any, Callable, Dict, List, Optional

from ui import ace_chatscroll as chatscroll
from ui import ace_theme
from ui import ace_vim
from ui.ace_text import truncate_width

__all__ = ["TranscriptSink", "FullScreenSession", "run_fullscreen",
           "MIN_ROWS", "MIN_COLS"]

MIN_ROWS = 8        # 低于这个高度不进全屏（挤出来的"全屏"比普通 REPL 更难用）
MIN_COLS = 40


class TranscriptSink:
    """把 stdout 变成"会话滚动区的一行行文本"。

    - 只有完整行才进缓冲（`\\n` 到达才算一行），最后一段留着等下一批；
    - 含 `\\r` 的写整条丢掉：那是重绘当前行（spinner / 进度），收进来就是残影；
    - `isatty()` 恒为 False：让 CLI 里"要不要弹框/上色"的判断在全屏里走非交互分支
      （嵌套 Application 不安全，见模块说明）。
    """

    def __init__(self, scroll: chatscroll.ChatScroll,
                 on_change: Optional[Callable[[], None]] = None) -> None:
        self.scroll = scroll
        self.on_change = on_change
        self._buf = ""
        self.dropped = 0          # 丢掉的 \r 重绘次数（调试/断言用）

    # ---- stdout 协议 ----
    def write(self, text: str) -> int:
        s = "" if text is None else str(text)
        if not s:
            return 0
        if "\r" in s:
            self.dropped += 1
            # 重绘里可能既有 \r 又有真内容（"\r◈ 思考中 3s   "）—— 整条丢掉，
            # 因为它的语义是"覆盖当前行"，拆开反而把半句话塞进历史。
            return len(s)
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            self.scroll.append(line)
        if self.on_change is not None:
            self.on_change()
        return len(s)

    def flush(self) -> None:
        if self._buf:                     # 没有换行的尾巴：不丢，作为"当前行"先显示
            self.scroll.append(self._buf)
            self._buf = ""
            if self.on_change is not None:
                self.on_change()

    def isatty(self) -> bool:
        return False

    def fileno(self) -> int:
        raise OSError("全屏会话的 stdout 是内存缓冲，没有文件描述符")

    def __getattr__(self, name: str) -> Any:
        # encoding/errors 之类的查询：给一份"看起来像文本流"的默认值，
        # 免得第三方库在写日志时因为拿不到属性而崩
        if name in ("encoding", "errors"):
            return "utf-8" if name == "encoding" else "replace"
        raise AttributeError(name)


class FullScreenSession:
    """全屏会话的状态与渲染（不依赖 prompt_toolkit 即可构造与断言）。"""

    def __init__(self, title: str = "HooH", status_fn: Optional[Callable[[], List]] = None,
                 header_fn: Optional[Callable[[], str]] = None,
                 view_height: int = 12) -> None:
        self.title = str(title)
        self.status_fn = status_fn
        self.header_fn = header_fn
        self.scroll = chatscroll.ChatScroll(view_height=view_height)
        self.sink = TranscriptSink(self.scroll)
        self.last_error = ""

    # ---- 会话内容 ----
    def feed(self, text: str) -> None:
        self.sink.write(text)

    def viewport(self) -> List[str]:
        """当前视口行（贴底时是最新内容；回看时是旧内容）。"""
        _s, _e, lines = self.scroll.view()
        return lines

    def header(self) -> str:
        return self.header_fn() if self.header_fn else self.title

    def status_parts(self) -> List:
        return list(self.status_fn() if self.status_fn else [])

    def scroll_by(self, delta: int) -> None:
        self.scroll.scroll_line(delta)

    def page(self, direction: int) -> None:
        self.scroll.page(direction)

    def to_bottom(self) -> None:
        self.scroll.scroll = 0

    @property
    def at_bottom(self) -> bool:
        return self.scroll.at_bottom()

    def scroll_indicator(self, width: int = 0) -> str:
        """滚动位置提示：贴底时给空串（没回看就不占位置）。"""
        if self.at_bottom:
            return ""
        total = len(self.scroll.lines)
        first, last, _v = self.scroll.view()
        text = f"↑{first + 1}-{last}/{total}（End/↓ 回到底部）"
        return truncate_width(text, width) if width and width > 0 else text


def _compose_transcript_lines(session: FullScreenSession, height: int) -> List[str]:
    """视口行 → 固定 `height` 行（不足补空行，多了截断）—— 窗口高度必须稳定，
    否则每来一行内容整个界面都会上下抖。"""
    lines = session.viewport()[-height:] if height > 0 else []
    if len(lines) < height:
        lines = [""] * (height - len(lines)) + lines
    return lines


def _terminal_size() -> tuple:
    import shutil
    try:
        size = shutil.get_terminal_size((100, 30))
        return int(size.columns), int(size.rows)
    except Exception:  # noqa: BLE001
        return 100, 30


def run_fullscreen(session: FullScreenSession,
                   on_submit: Callable[[str], Any],
                   overlay: Optional[Callable[[], str]] = None,
                   vim: bool = False) -> Optional[str]:
    """进备用屏幕跑一轮交互会话；返回退出原因，`None` = 环境不支持（没跑起来）。

    `on_submit(line)` 由调用方处理一行输入（命令/对话），**期间 `sys.stdout` 已被换成
    `session.sink`**，所以它 print 出来的东西会自动落进会话滚动区；返回 `False` 表示
    该结束会话（如 `/exit`），全屏随即退出。
    `overlay()` 可选：返回一行"临时提示"（如粘贴折叠提示），贴在最下面提示行上。

    退出原因：`exit`（Ctrl+D/正常结束）/ `ctrl-c` / `leave-fullscreen`（F5）/
    `interrupt`。prompt_toolkit 缺失或终端太小 → 返回 None，调用方回退普通 REPL。
    """
    cols, rows = _terminal_size()
    if rows < MIN_ROWS or cols < MIN_COLS:
        return None
    try:
        from prompt_toolkit.application import Application
        from prompt_toolkit.buffer import Buffer
        from prompt_toolkit.filters import Condition
        from prompt_toolkit.key_binding import KeyBindings
        from prompt_toolkit.keys import Keys
        from prompt_toolkit.layout import HSplit, Layout, VSplit, Window
        from prompt_toolkit.layout.controls import BufferControl, FormattedTextControl
        from prompt_toolkit.styles import Style
    except ImportError:
        return None
    def _body_height() -> int:
        return max(3, _terminal_size()[1] - 5)

    session.scroll.set_view_height(_body_height())
    state: Dict[str, Any] = {"overlay": "", "reason": "exit"}

    def _run_with_sink(text: str) -> Any:
        """把一行交给命令层，期间的 print 全部收进滚动区（spinner 的 \\r 会被丢掉）。"""
        _old = sys.stdout
        sys.stdout = session.sink          # type: ignore[assignment]
        try:
            return on_submit(text)
        finally:
            sys.stdout = _old
            session.sink.flush()

    def _dispatch(event, text: str) -> None:
        """交给命令层；返回 False = 该结束会话（`/exit`），于是退出全屏。"""
        if _run_with_sink(text) is False:
            state["reason"] = "exit"
            event.app.exit()

    def _transcript() -> List:
        lines = _compose_transcript_lines(session, _body_height())
        out: List = []
        for ln in lines:
            if out:
                out.append(("", "\n"))
            out.append(("class:fs.text", ln))
        return out

    def _status() -> List:
        parts = []
        for style, text in session.status_parts():
            parts.append((style.replace("class:footer", "class:fs.status"), text))
        ind = session.scroll_indicator(0)
        if ind:
            parts.append(("class:fs.scroll", " " + ind + " "))
        return parts or [("class:fs.status", " ")]

    buf = Buffer(multiline=False)
    kb = KeyBindings()
    browse = Condition(lambda: not buf.text)
    # vim 子集（`ui/ace_vim`）：全屏输入行自己的 vi 键位。为什么这里需要自己的引擎 ——
    # 普通 REPL 的 vi 模式是 prompt_toolkit 给的，而全屏的输入框是我们自己搭的，
    # 没有那套绑定；操作符 + 文本对象（`ciw`/`da"`/`d2w`）本来就是纯文本变换，
    # 所以直接用纯函数实现，顺带能被断言。
    editor = ace_vim.VimLineEditor(enabled=bool(vim))

    def _sync_from_buf() -> None:
        editor.set_text(buf.text, buf.cursor_position)

    def _sync_to_buf() -> None:
        buf.text = editor.text
        buf.cursor_position = min(editor.cursor, len(buf.text))

    @kb.add(Keys.Any)
    def _vim_key(event):
        """普通模式：按键先进 vim 引擎；插入模式：交给输入框自己。"""
        key = event.data or ""
        if not editor.enabled:
            buf.insert_text(key)
            return
        if editor.mode == "insert" and key != "\x1b":
            buf.insert_text(key)
            editor.insert(key)
            return
        if editor.feed("\x1b" if key == "\x1b" else key):
            _sync_to_buf()
        event.app.invalidate()

    @kb.add("backspace")
    def _vim_backspace(event):
        if editor.enabled and editor.mode == "insert":
            if editor.backspace():
                _sync_to_buf()
            return
        if editor.enabled:
            editor.feed("x")
            _sync_to_buf()
        else:
            buf.delete_before_cursor()
        event.app.invalidate()

    def _submit(event) -> None:
        text = buf.text
        buf.reset()
        if not text.strip():
            return
        session.feed(f"❯ {text}\n")
        state["overlay"] = ""
        try:
            _dispatch(event, text)
        except Exception as e:          # noqa: BLE001 —— 单行出错不该把全屏打崩
            session.feed(f"✗ {type(e).__name__}: {e}\n")
        event.app.invalidate()

    kb.add("enter")(_submit)

    @kb.add("c-c")
    def _quit(event):
        if buf.text:
            buf.reset()                  # 有输入先清空，与普通 REPL 一致
            return
        state["reason"] = "ctrl-c"
        event.app.exit()

    @kb.add("c-d")
    def _eof(event):
        state["reason"] = "eof"
        event.app.exit()

    @kb.add("c-l")
    def _clear(event):
        session.scroll.lines.clear()
        session.to_bottom()
        event.app.invalidate()

    @kb.add("c-o")
    def _expand(event):
        try:
            _dispatch(event, "/expand")
        except Exception:                 # noqa: BLE001
            pass
        event.app.invalidate()

    @kb.add("pageup")
    def _pgup(event):
        session.page(1)
        event.app.invalidate()

    @kb.add("pagedown")
    def _pgdn(event):
        session.page(-1)
        event.app.invalidate()

    @kb.add("up", filter=browse)
    def _up(event):
        session.scroll_by(-1)
        event.app.invalidate()

    @kb.add("down", filter=browse)
    def _down(event):
        session.scroll_by(1)
        event.app.invalidate()

    @kb.add("end", filter=browse)
    def _end(event):
        session.to_bottom()
        event.app.invalidate()

    @kb.add("f5")
    def _leave(event):
        state["reason"] = "leave-fullscreen"
        event.app.exit()

    # F1–F4 与普通 REPL 同义（走命令层），在全屏里就是把结果写进滚动区
    for _key, _cmd in (("f1", "/permission"), ("f2", "/sandbox"),
                       ("f3", "/net"), ("f4", "/thinking")):
        def _hot(event, _c=_cmd):
            try:
                _dispatch(event, _c)
            except Exception:             # noqa: BLE001
                pass
            event.app.invalidate()

        kb.add(_key)(_hot)

    def _on_text_changed(_b) -> None:
        if overlay is not None:
            try:
                state["overlay"] = str(overlay() or "")
            except Exception:             # noqa: BLE001
                state["overlay"] = ""
        try:
            from prompt_toolkit.application.current import get_app
            get_app().invalidate()
        except Exception:                 # noqa: BLE001
            pass

    buf.on_text_changed = _on_text_changed

    def _overlay_line() -> List:
        if state["overlay"]:
            return [("class:fs.notice", " " + state["overlay"])]
        if session.at_bottom:
            return [("class:fs.hint",
                     " Enter 发送 · PageUp/↑ 回看 · Ctrl+O 展开 · F5 退出全屏 · Ctrl+C 取消")]
        return [("class:fs.scroll", " 回看中（End 或 ↓ 回到底部）")]

    root = HSplit([
        Window(FormattedTextControl(text=lambda: [("class:fs.header",
                                                   " " + session.header())]),
               height=1, style="class:fs.header"),
        Window(FormattedTextControl(text=_transcript),
               height=_body_height, style="class:fs.body", wrap_lines=True),
        Window(FormattedTextControl(text=_status), height=1, style="class:fs.status"),
        Window(FormattedTextControl(text=_overlay_line), height=1,
               style="class:fs.hint"),
        VSplit([
            Window(FormattedTextControl(text=lambda: [("class:fs.prompt", "❯ ")]),
                   height=1, dont_extend_width=True),
            Window(BufferControl(buffer=buf), height=1, style="class:fs.input"),
        ]),
    ])

    app = Application(
        layout=Layout(root, focused_element=None),
        key_bindings=kb,
        full_screen=True,                 # 备用屏幕：退出后原终端画面原样恢复
        mouse_support=False,
        # 外壳配色来自色板（dark/light 与改造前逐字相同；雾蓝跟着走）
        style=Style.from_dict(ace_theme.ptk_styles()),
    )
    try:
        app.run()
    except (KeyboardInterrupt, EOFError):
        state["reason"] = "interrupt"
    return str(state["reason"])
