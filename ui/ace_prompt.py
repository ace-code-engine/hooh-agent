#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_prompt —— 无依赖的交互输入行：补全菜单 + 历史 + 行编辑

为什么要有它：此前补全菜单**只**活在 prompt_toolkit 里 —— 依赖没装（或装在了另一个
解释器上），用户看到的就是一个光秃秃的 `input()`：没有菜单、没有历史、没有提示。用户
的原话是"菜单不好用、没安装"。让一个功能取决于可选依赖，等于把它交给运气。

这个模块用**标准库**把该有的东西补齐（Windows `msvcrt` / POSIX `termios`），并且
关键一点：**按键来源可注入**（真终端走原始终端，管道走字节流），所以整条交互链路能被
端到端测试 —— `printf '/he\t\r' | ace --mock` 就是一次真实的菜单操作，CI 里也能跑。

行为（与 `ui/ace_menu` 的契约一致）：
- 输入 `/`、`@` 或"命令 + 空格"即弹菜单，候选来自 `ui/ace_menu`（与装了依赖时同一份）；
- ↑↓ 选，Tab 补全，回车：候选与已输入不同 → **先补全**；已经一致 → 发送；
- Esc：菜单开着先关菜单，否则清空输入；Ctrl+C 清空（空输入时抛 KeyboardInterrupt）；
- ↑↓（菜单关着）翻历史；Ctrl+R 反向搜索历史；Ctrl+L 清屏；Ctrl+O = /expand。

不做的：多行编辑（普通 REPL 用 prompt_toolkit；这里只做"一行输入 + 菜单"，
把没有依赖时的短板补齐，而不是重写一个编辑器）。
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Sequence

from ui import ace_menu
from ui.ace_text import display_width, truncate_width

__all__ = ["KeySource", "LineEditor", "read_line", "parse_key", "ESCAPES"]

# 转义序列 → 键名（管道里按键就是字节；真终端上 POSIX 侧也走这套）
ESCAPES: Dict[str, str] = {
    "\x1b[A": "up", "\x1b[B": "down", "\x1b[C": "right", "\x1b[D": "left",
    "\x1b[H": "home", "\x1b[F": "end", "\x1b[1~": "home", "\x1b[4~": "end",
    "\x1b[3~": "delete", "\x1bOA": "up", "\x1bOB": "down",
    "\x1bOC": "right", "\x1bOD": "left",
}
_CONTROLS: Dict[str, str] = {
    "\r": "enter", "\n": "enter", "\t": "tab", "\x7f": "backspace",
    "\x08": "backspace", "\x03": "c-c", "\x04": "c-d", "\x0c": "c-l",
    "\x12": "c-r", "\x0f": "c-o", "\x1b": "esc",
}


def parse_key(seq: str) -> str:
    """字节序列 → 键名（认不出就返回原字符；空串返回空串）。

    `Ctrl+字母`统一映射成 `c-x` 名字（1..26 → a..z）—— 否则热键表里写 `c-e` 永远
    匹配不上（键源只会给出 `\\x05` 这个裸控制字符）。
    """
    s = str(seq or "")
    if not s:
        return ""
    if s in ESCAPES:
        return ESCAPES[s]
    if s in _CONTROLS:
        return _CONTROLS[s]
    if s.startswith("\x1b["):
        return ESCAPES.get(s, "esc")
    if len(s) == 1 and 1 <= ord(s) <= 26:
        return "c-" + chr(ord(s) + 96)
    return s


class KeySource:
    """按键来源：真终端（原始终端读单键）或字节流（管道/测试）。

    `stream` 给了就按字节流读（测试注入 StringIO 即可驱动整条交互）；否则真终端优先
    `msvcrt`（Windows）再 `termios`（POSIX），都拿不到就退回 `stream`/`sys.stdin`。
    """

    def __init__(self, stream: Any = None, tty: Optional[bool] = None) -> None:
        self.stream = stream
        self._isatty = (bool(sys.stdin.isatty()) if tty is None else bool(tty))
        self._restore: Optional[Callable[[], None]] = None
        self._pushback: List[str] = []      # 已经读出来但不该被这一键吃掉的字符

    # ---- 真终端 ----
    def _enter_raw(self) -> None:
        if not self._isatty or os.name == "nt":
            return
        try:
            import termios
            import tty
            fd = sys.stdin.fileno()
            old = termios.tcgetattr(fd)
            tty.setcbreak(fd)
            self._restore = lambda: termios.tcsetattr(fd, termios.TCSADRAIN, old)
        except Exception:  # noqa: BLE001 —— 拿不到原始终端就按普通字节流读
            self._restore = None

    def _exit_raw(self) -> None:
        if self._restore is not None:
            try:
                self._restore()
            except Exception:  # noqa: BLE001
                pass
            self._restore = None

    def _read_raw_char(self) -> str:
        """读一个字符；没有任何输入时返回空串（EOF 也返回空串，由调用方判 EOF）。

        **注入了 `stream` 就以流为准**，不再走 `msvcrt`：不然在真终端里跑测试时，
        `msvcrt.getwch()` 会越过注入的流去等真键盘，整个测试当场挂死（实测踩到过，
        症状是"检查跑了两分钟没输出"）。
        """
        if self._pushback:
            return self._pushback.pop(0)
        if self.stream is None and self._isatty and os.name == "nt":
            try:
                import msvcrt
                ch = msvcrt.getwch()
                if ch in ("\x00", "\xe0"):
                    nxt = msvcrt.getwch()
                    return {"H": "\x1b[A", "P": "\x1b[B", "K": "\x1b[D",
                            "M": "\x1b[C", "S": "\x1b[3~",
                            # F1–F5：与浮层路径的热键同义（大写字母 = 无 Shift）
                            ";": "f1", "<": "f2", "=": "f3", ">": "f4",
                            "?": "f5"}.get(nxt, "")
                return ch
            except Exception:  # noqa: BLE001 —— 非真控制台（重定向）时退回字节流
                pass
        src = self.stream if self.stream is not None else sys.stdin
        try:
            ch = src.read(1)
        except Exception:  # noqa: BLE001
            return ""
        return "" if ch is None else str(ch)

    def _pending(self) -> bool:
        """真终端上"现在有没有键可读"（不消费）。注入流与管道不适用——那边 read 立刻返回。"""
        if self._pushback:
            return True
        if self._isatty and os.name == "nt":
            try:
                import msvcrt
                return bool(msvcrt.kbhit())
            except Exception:  # noqa: BLE001 —— 问不出来就当有，交给读去阻塞
                return True
        return False

    def _read_key(self) -> str:
        """读一个键（已解析成键名/字符）；返回空串表示 EOF。**不管原始模式**。

        转义序列的读法要小心：**不能盲读第三个字符**。旧写法在"单独一个 Esc 后面紧跟
        回车"时会把回车吃掉，于是用户按 Esc 关菜单、再按回车，界面却当成了 EOF
        （探针里当场复现）。现在的规则是：ESC 后面只有 `[`/`O` 才继续往后读，
        否则把多读的那个字符**放回缓冲**，按单独的 Esc 处理。
        """
        first = self._read_raw_char()
        if not first:
            return ""
        if first != "\x1b":
            return parse_key(first)
        nxt = self._read_raw_char()
        if not nxt:
            return "esc"
        if nxt not in ("[", "O"):
            self._pushback.insert(0, nxt)     # 不是转义序列：字符还给下一键
            return "esc"
        third = self._read_raw_char()
        seq = "\x1b" + nxt + third
        if seq in ESCAPES:
            return parse_key(seq)
        fourth = self._read_raw_char()
        seq2 = seq + fourth
        if seq2 in ESCAPES:
            return parse_key(seq2)
        return "esc"

    def read(self, timeout: Optional[float] = None) -> Optional[str]:
        """读一个键。`timeout=None` 阻塞（老行为）；给了秒数就等这么久。

        超时**返回 None**，而 EOF 仍然返回空串——两者必须分得开：引擎的主循环
        （`ui/ace_screen.run_session`）要在"没有输入"时继续推帧，在"输入断了"时退出。

        注入的 `stream` 永远走阻塞分支：管道/测试流里没有"等待"这回事。
        """
        if timeout is None or self.stream is not None or not self._isatty:
            self._enter_raw()
            try:
                return self._read_key()
            finally:
                self._exit_raw()
        if os.name == "nt":
            deadline = time.monotonic() + max(0.0, float(timeout))
            while True:
                if self._pending():
                    return self.read()
                if time.monotonic() >= deadline:
                    return None
                time.sleep(0.01)
        self._enter_raw()
        try:
            import select
            fd = sys.stdin.fileno()
            deadline = time.monotonic() + max(0.0, float(timeout))
            while True:
                left = max(0.0, deadline - time.monotonic())
                if self._pushback or select.select([fd], [], [], left)[0]:
                    return self._read_key()
                if time.monotonic() >= deadline:
                    return None
        finally:
            self._exit_raw()


class LineEditor:
    """一行输入 + 菜单 + 历史（渲染可关，逻辑与渲染分离）。"""

    def __init__(self, prompt: str = "▊ ",
                 completer: Optional[Callable[[str, int], ace_menu.MenuState]] = None,
                 history: Optional[Sequence[str]] = None,
                 styler: Optional[Callable[[str, str], str]] = None,
                 translate: Optional[Callable[[str], str]] = None,
                 width: Optional[int] = None,
                 max_menu_rows: int = 8,
                 draw: Optional[bool] = None,
                 keys: Optional[KeySource] = None,
                 on_ctrl_l: Optional[Callable[[], None]] = None,
                 hotkeys: Optional[Dict[str, str]] = None) -> None:
        self.prompt = prompt
        self.completer = completer or (lambda t, c: ace_menu.MenuState())
        self.history = list(history or [])
        self.styler = styler or (lambda _k, x: x)
        self.translate = translate or (lambda k: k)
        self.width = int(width or 80)
        self.max_menu_rows = int(max_menu_rows)
        # 只在真终端上自绘（管道里画出来只会污染给机器读的输出）
        self.draw = bool(sys.stdout.isatty()) if draw is None else bool(draw)
        self.keys = keys or KeySource()
        self.on_ctrl_l = on_ctrl_l
        self.hotkeys = dict(hotkeys or {"c-o": "/expand"})
        self.text = ""
        self.cursor = 0
        self.menu = ace_menu.MenuState()
        self._menu_suppressed = False
        self._hist_idx = 0
        self._search = ""
        self._drawn_lines = 0
        self.notes: List[str] = []          # 供测试/上层读取（如"已清空"）
        self._hint = ""                     # 临时提示（如"再按一次 Ctrl+C 退出"）
        self._last_ctrl_c = 0.0
        self._last_esc = 0.0                # Esc 双击判定（空输入时打开历史选择器）
        self._history_pick = False          # 当前菜单是不是"历史选择器"

    # ---- 文本操作 ----
    def set_text(self, text: str, cursor: Optional[int] = None) -> None:
        self.text = str(text or "")
        self.cursor = len(self.text) if cursor is None else max(0, min(int(cursor),
                                                                       len(self.text)))
        self._refresh_menu()

    def insert(self, s: str) -> None:
        if not s:
            return
        self.text = self.text[:self.cursor] + s + self.text[self.cursor:]
        self.cursor += len(s)
        self._refresh_menu()

    def backspace(self) -> None:
        if self.cursor <= 0:
            return
        self.text = self.text[:self.cursor - 1] + self.text[self.cursor:]
        self.cursor -= 1
        self._refresh_menu()

    def delete(self) -> None:
        if self.cursor >= len(self.text):
            return
        self.text = self.text[:self.cursor] + self.text[self.cursor + 1:]
        self._refresh_menu()

    def _refresh_menu(self) -> None:
        if self._history_pick and self.menu.open:
            return                       # 历史选择器由 Esc Esc 维护，不按输入重建
        if self._menu_suppressed:
            self.menu = ace_menu.MenuState()
            return
        self.menu = self.completer(self.text, self.cursor)

    def accept_menu(self) -> None:
        """把当前候选填进文本（回车/Tab 的"补全"语义）。"""
        new_text = self.menu.accepted_text(self.text)
        self.text = new_text
        self.cursor = len(self.text)
        self._refresh_menu()

    def open_history_menu(self, limit: int = 8) -> bool:
        """Esc Esc（空输入）：把最近的历史打开成**可选列表**（再回车即填入，不发送）。

        为什么把它放在 Esc 上：终端里"我想改刚才那句话"是高频动作，而 Esc 本来
        就是"退一层"的键 —— 空输入时它没有别的事可做（菜单开着时先关菜单，有输入时
        清空输入），所以这里是最顺的落点。填入而不是直接发送：历史那句话是当时的
        上下文，不该被原样再发一次。
        """
        items = [h for h in self.history if str(h).strip()][-max(1, int(limit)):]
        if not items:
            return False
        menu_items = [ace_menu.MenuItem(str(h)[:120], str(h), "", "",
                                       "history") for h in reversed(items)]
        self.menu = ace_menu.MenuState(menu_items, 0, True, "history", "",
                                       (0, len(self.text)))
        self._menu_suppressed = False
        self._history_pick = True
        return True

    def history_move(self, delta: int) -> None:
        """历史上下翻：`_hist_idx` = 往回走了几条（0 = 当前正在输入的内容）。

        之前这里把"已经在最新一条、再按↓"也算成"取出最后一条"，于是**↓ 会莫名其妙
        把历史灌进输入框**（探针里当场看到）。现在到底就不动。
        """
        if not self.history:
            return
        idx = max(0, min(len(self.history), self._hist_idx + int(delta)))
        if idx == self._hist_idx:
            return
        self._hist_idx = idx
        self.text = "" if idx == 0 else self.history[len(self.history) - idx]
        self.cursor = len(self.text)
        self._menu_suppressed = True
        self.menu = ace_menu.MenuState()

    def history_search(self) -> None:
        """Ctrl+R：进入反向搜索（随后输入的字符作为过滤词，回车采用）。"""
        self._search = ""
        self.notes.append("search")

    # ---- 渲染 ----
    def _erase(self) -> None:
        if not self.draw or self._drawn_lines <= 0:
            return
        out = sys.stdout
        for _ in range(self._drawn_lines):
            out.write("\r\x1b[2K")
            if _ < self._drawn_lines - 1:
                out.write("\x1b[1A")
        out.write("\r")
        out.flush()
        self._drawn_lines = 0

    def render(self) -> List[str]:
        """当前画面（纯数据：第一行是输入行，其余是菜单）——便于断言。"""
        left = self.prompt + self.text[:self.cursor]
        right = self.text[self.cursor:]
        head = left + (self.styler("cyan", "│") if False else "") + right
        rows = [head]
        if self.menu.open:
            rows.extend(ace_menu.render_menu(
                self.menu, width=self.width, max_rows=self.max_menu_rows,
                styler=self.styler, translate=self.translate))
        if self._search:
            rows.append(self.styler("dim", self.translate("search_hint")))
        if self._hint:
            rows.append(self.styler("yellow", "  " + self._hint))
        return rows

    def _paint(self) -> None:
        if not self.draw:
            return
        self._erase()
        rows = [truncate_width(r, max(20, self.width - 1)) for r in self.render()]
        sys.stdout.write("\r\x1b[2K" + rows[0])
        for r in rows[1:]:
            sys.stdout.write("\n\r\x1b[2K" + r)
        # 光标回到输入行上、且落在光标位置（菜单行数已知）
        back = len(rows) - 1
        if back:
            sys.stdout.write(f"\x1b[{back}A")
        col = display_width(self.prompt + self.text[:self.cursor])
        sys.stdout.write(f"\r\x1b[{col + 1}C")
        sys.stdout.flush()
        self._drawn_lines = len(rows)

    # ---- 主循环 ----
    def read_line(self) -> Optional[str]:
        """读一行；EOF 返回 None，Ctrl+C（空输入）抛 KeyboardInterrupt。"""
        self.text, self.cursor = "", 0
        self._hist_idx = 0
        self._menu_suppressed = False
        self._search = ""
        self._refresh_menu()
        self._paint()
        while True:
            act = self.step(self.keys.read())
            if act == "submit":
                self._erase()
                if self.draw:
                    sys.stdout.write("\r\x1b[2K" + self.prompt + self.text + "\n")
                    sys.stdout.flush()
                return self.text
            if act == "eof":
                self._erase()
                return None
            if act == "interrupt":
                self._erase()
                raise KeyboardInterrupt
            if act.startswith("menu:"):
                self._erase()
                return "\x00MENU:" + act[5:]
            self._paint()

    # ---- 单步：按键 → 动作（不读、不画；两条路共用这一份分派） ----
    def step(self, key: str) -> str:
        """处理一个按键，返回动作：

        - `"continue"`：状态已改，继续；
        - `"submit"`：提交（文本在 `self.text`）；
        - `"eof"` / `"interrupt"`：Ctrl+D / Ctrl+C 双击确认；
        - `"menu:<命令>"`：热键，交上层执行。

        **这里不画任何东西**，也不读键：浮层路径（`read_line`）自己重画，引擎路径
        （`ui/ace_screen`）由底部区重画。分派只有这一份，两条路不会两套脾气。
        """
        if key == "":
            return "eof"
        if self._search and key not in ("enter", "esc", "c-c", "backspace"):
            if len(key) == 1:
                self._search += key
                hits = [h for h in self.history if self._search.lower() in h.lower()]
                if hits:
                    self.text = hits[-1]
                    self.cursor = len(self.text)
            return "continue"
        if key in ("enter",):
            if self.menu.open and self._history_pick:
                # 历史选择器：回车=填入输入行（不发送），再回车才是发送
                self.text = str(self.menu.current.insert if self.menu.current else "")
                self.cursor = len(self.text)
                self._history_pick = False
                self._menu_suppressed = True
                self.menu = ace_menu.MenuState()
                return "continue"
            if self.menu.open and ace_menu.accepts_on_enter(self.menu, self.text):
                self.accept_menu()
                return "continue"
            return "submit"
        if key == "tab":
            if self.menu.open:
                self.accept_menu()
            elif not self.text:
                self.insert("/")            # 空输入按 Tab：直接起个命令（少打一个字符）
            return "continue"
        if key == "esc":
            if self.menu.open:
                self._menu_suppressed = True
                self._history_pick = False
                self.menu = ace_menu.MenuState()
            elif self.text:
                self.text, self.cursor = "", 0
                self.notes.append("cleared")
            elif self._last_esc and (time.monotonic() - self._last_esc) < 0.8:
                # 空输入下双击 Esc：打开历史选择器（Esc 的第四层语义）
                if self.open_history_menu():
                    self.notes.append("history-menu")
                self._last_esc = 0.0
            else:
                self._last_esc = time.monotonic()
            return "continue"
        if key == "c-c":
            if self.text:
                self.text, self.cursor = "", 0
                self.notes.append("cleared")
                self._refresh_menu()
                return "continue"
            # 空输入：**双击确认**才退出（与浮层路径同一条纪律）。
            # 一次误按就杀掉一个跑了十分钟的会话，比"多按一次"贵得多。
            now = time.monotonic()
            if now - self._last_ctrl_c < 1.0:
                return "interrupt"
            self._last_ctrl_c = now
            self.notes.append("ctrl-c-once")
            self._hint = self.translate("exit_again_hint")
            return "continue"
        if key == "c-d":
            if not self.text:
                return "eof"
            self.delete()
        elif key == "backspace":
            self.backspace()
        elif key == "delete":
            self.delete()
        elif key == "left":
            self.cursor = max(0, self.cursor - 1)
        elif key == "right":
            self.cursor = min(len(self.text), self.cursor + 1)
        elif key == "home":
            self.cursor = 0
        elif key == "end":
            self.cursor = len(self.text)
        elif key == "up":
            if self.menu.open:
                self.menu.move(-1)
            else:
                self.history_move(+1)
        elif key == "down":
            if self.menu.open:
                self.menu.move(+1)
            else:
                self.history_move(-1)
        elif key == "c-r":
            self.history_search()
        elif key == "c-l":
            self._erase()
            if self.on_ctrl_l is not None:
                self.on_ctrl_l()
        elif key in self.hotkeys:
            self._erase()
            return "menu:" + self.hotkeys[key]
        elif len(key) == 1 and key.isprintable():
            self.insert(key)
            self._menu_suppressed = False   # 打字 = 重新开始给建议
        else:
            return "continue"
        self._refresh_menu()
        return "continue"


def read_line(prompt: str = "▊ ", **kw: Any) -> Optional[str]:
    """便捷入口：`read_line(prompt, completer=..., history=...)`。"""
    return LineEditor(prompt=prompt, **kw).read_line()
