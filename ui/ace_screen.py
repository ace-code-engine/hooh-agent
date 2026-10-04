#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_screen —— 主屏两车道会话屏（定稿内容只写一次，可变区只画脏格子）

这是 `docs/TUI-ENGINE.md` 第 4 步的落地，也是 Claude Code 那套结构的对应物：

- **车道一（不可变）**：转录定稿后**直接写进终端真 scrollback**，从此不再参与渲染循环。
  滚上去就是历史、选中就能复制、终端自带的搜索直接可用——这些都不是我们实现的，是白送的。
- **车道二（可变）**：屏幕底部保留 `region_rows` 行（状态行 / 输入提示 / 看板），
  走 `ui/ace_canvas` 的帧缓冲 + 脏矩形，只重画**真正变了的格子**；空转一帧写 0 字节。

进出 alt-screen 不是这个模块的事：它也可以在备用屏幕里用，只是默认走在主屏。

写出去的东西**全部经过注入的 `write`**，所以整条链路能在没有终端的情况下断言字节流
（与 `ui/ace_prompt` 的"按键来源可注入"是同一个套路）。
"""

from __future__ import annotations

import re
import shutil
import sys
import threading
from typing import Callable, List, Optional, Sequence, Union

from ui.ace_cell import Screen, Segment, fit_row
from ui.ace_canvas import Canvas, Patch, diff
from ui.ace_render import render_canvas, render_terminal
from ui.ace_text import char_width

__all__ = ["SessionScreen", "QuestionPump", "run_session", "check"]

Push = Union[Screen, Sequence[str]]

_CONT = "\x00"          # 模拟器里的宽字符续格占位（与输出无关，只为列号对齐）


class SessionScreen:
    """主屏两车道。`write` 是注入的写出函数（生产里是 `sys.stdout.write`）。"""

    def __init__(self, write: Callable[[str], object], width: int = 120,
                 region_rows: int = 2, profile: str = "256",
                 theme: str = "dark", max_region_rows: int = 12) -> None:
        self._write = write
        self.width = int(width)
        self.region_rows = max(1, int(region_rows))      # 最少保留几行
        self.max_region_rows = max(self.region_rows, int(max_region_rows))
        self.profile = profile
        self.theme = theme
        self.bytes_written = 0
        self.frames = 0
        # 待写的定稿转录：("line", [Segment]) 或 ("raw", "已经带 ANSI 的整行")
        self._pending: List[tuple] = []
        self._region: Optional[Screen] = None   # 当前底部区内容
        self._painted: Optional[Canvas] = None  # 已经画在屏幕上的底部区
        self._painted_rows = 0                  # 已画区的行数（收回时要用它）

    # ---------------- 输入侧（都是攒着，flush 才写） ----------------
    def push(self, lines: Push) -> None:
        """追加**定稿**的转录行（Segment 行；字符串会被包成默认角色的 Segment）。"""
        for ln in lines:
            segs = list(ln) if isinstance(ln, (list, tuple)) else [Segment(str(ln))]
            self._pending.append(("line", segs))

    def push_raw(self, lines: Sequence[str]) -> None:
        """追加**已经渲染好**的定稿行（自带 ANSI 的原文）。

        为什么需要两条路：ace 现有的输出层（卡片、diff、状态提示）自己就会上色，
        让它们经过 `Segment` 只会把颜色信息丢掉重来。车道一的职责是"原样、有序、只写一次"，
        所以这里不解析、不改写——`ui/ace_render` 只负责车道二（可变区）。
        """
        for ln in lines:
            text = str(ln)
            if text:
                self._pending.append(("raw", text))

    def set_region(self, screen: Optional[Screen]) -> None:
        """设置底部保留区。

        与上一版的关键差别：**高度是动态的**（输入菜单弹出来时区域会变高），所以这里
        不再截到固定行数，而是逐行 `fit_row` 规整到终端宽度、最多留 `max_region_rows`
        行。高度一变，`flush` 会自动改成"收回旧区 + 整块重画"。
        """
        if screen is None:
            self._region = None
            return
        rows = [fit_row(list(r), self.width) for r in screen]
        self._region = rows[-self.max_region_rows:]

    # ---------------- 输出侧 ----------------
    def _emit(self, text: str) -> None:
        if not text:
            return
        self._write(text)
        self.bytes_written += len(text)

    def _unpaint(self, rows: Optional[int] = None) -> str:
        """把底部区从屏幕上收回：光标回到区域首行，清到屏幕末尾。"""
        up = (rows if rows is not None else self._painted_rows) - 1
        return ("\x1b[{}A".format(up) if up else "") + "\r\x1b[J"

    def _paint_full(self) -> str:
        assert self._region is not None
        lines = render_terminal(self._region, self.profile, self.theme)
        out: List[str] = []
        for i, ln in enumerate(lines):
            out.append(ln)
            if i != len(lines) - 1:
                out.append("\r\n")
        out.append("\r")
        self._painted = self._to_canvas(self._region)
        self._painted_rows = len(self._region)
        return "".join(out)

    def _to_canvas(self, screen: Screen) -> Canvas:
        return render_canvas(screen, self.profile, self.theme)

    def _encode_region(self, patches: Sequence[Patch], rows: int) -> str:
        """脏补丁 → 相对光标移动。光标停在区域**最后一行**，所以向上 = rows-1-row。"""
        if not patches:
            return ""
        out: List[str] = []
        for p in patches:
            up = rows - 1 - p.row
            if up:
                out.append("\x1b[{}A".format(up))
            out.append("\r")
            if p.col:
                out.append("\x1b[{}C".format(p.col))
            out.append("\x1b[{}m".format(p.sgr) if p.sgr else "\x1b[0m")
            out.append(p.text)
            out.append("\x1b[0m")
            if up:
                out.append("\x1b[{}B".format(up))
                out.append("\r")
        return "".join(out)

    def flush(self) -> int:
        """把攒下的东西写出去。返回本次写出的字节数（测试与统计用）。"""
        before = self.bytes_written
        self.frames += 1

        if self._pending:
            # 车道一：先把底部区收回（腾出位置），再一次性写定稿转录
            if self._painted is not None:
                self._emit(self._unpaint())
                self._painted = None
                self._painted_rows = 0
            for kind, payload in self._pending:
                if kind == "raw":
                    self._emit(payload + "\r\n")          # 原样：颜色是上游的
                else:
                    self._emit(render_terminal([payload], self.profile,
                                               self.theme)[0] + "\r\n")
            self._pending = []
            if self._region is not None:
                self._emit(self._paint_full())
            return self.bytes_written - before

        # 车道二：只重画脏格子
        if self._region is None:
            # 区域被撤掉了（问答结束）：把画在屏幕上的那一块**收回**，
            # 不能只是"不再更新"——否则问题会永远留在屏幕上。
            if self._painted is not None:
                self._emit(self._unpaint())
                self._painted = None
                self._painted_rows = 0
            return self.bytes_written - before
        cur = self._to_canvas(self._region)
        rows = len(self._region)
        if self._painted is None or self._painted_rows != rows:
            # 高度变了（菜单弹出来 / 收起）：整块重画，别硬套旧几何
            if self._painted is not None:
                self._emit(self._unpaint())
                self._painted = None
            self._emit(self._paint_full())
        else:
            self._emit(self._encode_region(diff(self._painted, cur), rows))
            self._painted = cur
        return self.bytes_written - before

    def close(self) -> None:
        """退出前把底部区擦掉，别把状态行留在用户屏幕上。"""
        if self._painted is not None:
            self._emit(self._unpaint())
            self._painted = None
            self._painted_rows = 0


class QuestionPump:
    """把"引擎要问用户"从 worker 线程交接到主循环。

    没有它会怎样：worker 线程直接在终端上读键，主循环同时也在读键——两个线程抢一个
    键盘，症状是"偶尔按一下没反应"或"答案被吃掉"，而且只在真机上偶发，测试永远抓不到。

    所以键盘与渲染**只有一个线程**（主循环），worker 只在这里等答案。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._q = None
        self._ans = None
        self._ev = threading.Event()

    def ask(self, question) -> object:
        """worker 线程调用：挂上问题，阻塞到主循环回答。"""
        with self._lock:
            self._q = question
            self._ans = None
            self._ev.clear()
        self._ev.wait()
        with self._lock:
            ans = self._ans
            self._q = None
            self._ans = None
        return ans

    def pending(self):
        with self._lock:
            return self._q

    def resolve(self, answer) -> None:
        """主循环回答。**必须在这里就把问题清掉**：只设答案的话，worker 还没被调度
        醒来之前主循环会看到同一个问题、再驱动一次——那一次会把用户的下一个按键吃掉，
        再用 `None` 覆盖正确答案（症状是"权限问答莫名变成拒绝"，而且是偶发的）。
        重复 resolve 一律忽略。
        """
        with self._lock:
            if self._q is None:
                return
            self._ans = answer
            self._q = None
        self._ev.set()


def run_session(editor, screen: "SessionScreen", keys, drain, on_submit,
                running=None, status=None, on_menu=None, tick: float = 0.05,
                pump: Optional[QuestionPump] = None, on_key=None) -> str:
    """引擎主循环：一帧 = 排空引擎输出 → 画底部区 → 读一个键（带超时）。

    - `drain()`：返回**已定稿**的转录行（`Screen` 或字符串行），没有就返回空；
    - `status()`：返回状态行的 `Line`，可以不提供；
    - `on_submit(text)`：用户回车后交给上层（起一轮 / 入队）；
    - `on_key(key)`：返回真表示这个键被上层吃掉了（如忙时 Esc = 请求中断）；
    - `pump`：引擎在别的线程提问时的交接点（见 `QuestionPump`）；
    - `keys.read(timeout=tick)`：超时返回 `None`（继续推帧），EOF 返回 `""`。

    返回退出原因：`"eof"` / `"interrupt"` / `"stopped"`。
    """
    from ui.ace_host import drive                 # 延迟导入：避免模块级环依赖

    while True:
        if running is not None and not running():
            screen.close()
            return "stopped"
        pending = drain() if callable(drain) else None
        if pending:
            screen.push(pending)
        region: Screen = []
        if callable(status):
            head = status()
            if head:
                region.append(list(head))
        for i, row in enumerate(editor.render()):
            # 第 0 行是输入行（正文），其余是菜单/提示（弱化）——层级只靠灰阶，不用颜色
            region.append([Segment(row, "text" if i == 0 else "dim")])
        screen.set_region(region)
        screen.flush()

        # 引擎在 worker 线程里问的问题：在这里问（键盘与渲染都留在这个线程）
        if pump is not None:
            q = pump.pending()
            if q is not None:
                pump.resolve(drive(q, keys.read, screen))
                continue

        key = keys.read(timeout=tick)
        if key is None:                     # 没输入：继续推帧（动画/引擎输出都在这儿出）
            continue
        if pump is not None:
            q = pump.pending()
            if q is not None:
                # 问题恰好在这 50ms 里到达：把这个键交给问题，别丢掉
                pump.resolve(drive(q, keys.read, screen, first=key))
                continue
        if callable(on_key) and on_key(key):
            continue
        act = editor.step(key)
        if act == "submit":
            text = editor.text
            editor.set_text("")
            on_submit(text)
        elif act == "eof":
            screen.close()
            return "eof"
        elif act == "interrupt":
            screen.close()
            return "interrupt"
        elif act.startswith("menu:") and callable(on_menu):
            on_menu(act[5:])


class _Term:
    """够用的终端模拟器：只认我们真会发出去的那几个序列。

    为什么检查里要写它：底部区的光标数学（相对上移 / 回列 / 清行）人眼看不出来，
    只有把字节流喂进去**重建屏幕**才能证明"历史没被状态行覆盖"。
    认的序列：CSI A/B/C/H/J/K，`\\r`、`\\n`；SGR 一律忽略（这里只验排版，不验颜色）。
    """

    _CSI = re.compile(r"\x1b\[([0-9;]*)([A-Za-z])")

    def __init__(self, width: int = 80, height: int = 24) -> None:
        self.w, self.h = int(width), int(height)
        self.grid = [[" "] * self.w for _ in range(self.h)]
        self.cx = self.cy = 0

    def _nl(self) -> None:
        self.cy += 1
        if self.cy >= self.h:
            self.grid.pop(0)
            self.grid.append([" "] * self.w)
            self.cy = self.h - 1

    def feed(self, s: str) -> None:
        i = 0
        while i < len(s):
            ch = s[i]
            if ch == "\x1b":
                m = self._CSI.match(s, i)
                if not m:
                    i += 1
                    continue
                head = m.group(1).split(";")[0]
                n = int(head) if head.isdigit() else 0
                cmd = m.group(2)
                if cmd == "A":
                    self.cy = max(0, self.cy - max(1, n))
                elif cmd == "B":
                    self.cy = min(self.h - 1, self.cy + max(1, n))
                elif cmd == "C":
                    self.cx = min(self.w - 1, self.cx + max(1, n))
                elif cmd == "H":
                    parts = [int(p) if p.isdigit() else 1
                             for p in (m.group(1).split(";") + ["1", "1"])[:2]]
                    self.cy = max(0, min(self.h - 1, parts[0] - 1))
                    self.cx = max(0, min(self.w - 1, parts[1] - 1))
                elif cmd == "J":
                    for y in range(self.cy, self.h):
                        self.grid[y] = [" "] * self.w
                elif cmd == "K":
                    for x in range(self.cx, self.w):
                        self.grid[self.cy][x] = " "
                i = m.end()
                continue
            if ch == "\r":
                self.cx = 0
            elif ch == "\n":
                self._nl()
            else:
                # 关键：按**显示列数**推进，CJK 占两格（续格留占位）。
                # 模拟器要是按"一字符一格"记，列号会整体偏，测试就成了假的。
                w = char_width(ch) or 1
                if self.cx + w > self.w:
                    self.cx = 0
                    self._nl()
                self.grid[self.cy][self.cx] = ch
                if w == 2 and self.cx + 1 < self.w:
                    self.grid[self.cy][self.cx + 1] = _CONT
                self.cx = min(self.w - 1, self.cx + w)
            i += 1

    def text(self) -> List[str]:
        return ["".join(r).replace(_CONT, "").rstrip() for r in self.grid]


def check(width: int = 60, height: int = 14) -> List[str]:
    """两车道的行为验收：空转 0 字节、状态变化不重写转录、每条转录只写一次。"""
    bad: List[str] = []
    chunks: List[str] = []
    term = _Term(width, height)
    scr = SessionScreen(chunks.append, width=width, region_rows=2, profile="none")

    def region(label: str) -> Screen:
        return [[Segment("状态：" + label)], [Segment("-" * width)]]

    def tail(n: int = 2) -> List[str]:
        """主屏模式下底部区跟着光标走（不是钉在屏幕最底下），所以取最后几个**非空**行。"""
        rows = [t for t in term.text() if t.strip()]
        return rows[-n:] if len(rows) >= n else rows

    # 1. 首帧：3 行定稿 + 2 行底部区
    scr.push(["alpha", "beta", "gamma"])
    scr.set_region(region("A"))
    scr.flush()
    term.feed("".join(chunks))
    last2 = tail()
    if not (last2 and last2[0].startswith("状态：A")):
        bad.append("首帧底部区第一行不对：{!r}".format(last2))
    if not (len(last2) > 1 and last2[1].startswith("-")):
        bad.append("首帧底部区第二行不对：{!r}".format(last2))
    if "gamma" not in "\n".join(term.text()):
        bad.append("首帧转录没写出去")

    # 2. 空转一帧：0 字节
    chunks.clear()
    if scr.flush() != 0 or chunks:
        bad.append("空转帧写了 {} 字节（应为 0）".format(len("".join(chunks))))

    # 3. 只改底部区：**不许重写转录**
    chunks.clear()
    scr.set_region(region("B"))
    scr.flush()
    body = "".join(chunks)
    if "alpha" in body or "beta" in body:
        bad.append("改状态行时重写了转录（两车道破了）")
    term.feed(body)
    joined = "\n".join(term.text())
    last2 = tail()
    if not (last2 and last2[0].startswith("状态：B")):
        bad.append("状态行没更新：{!r}".format(last2))
    if "状态：A" in joined:
        bad.append("旧状态行没被覆盖（光标数学错了）")
    if "gamma" not in joined:
        bad.append("增量重画把转录吃掉了")

    # 4. 再来一轮：老转录不重写、新转录只写一次、旧内容仍在屏上
    chunks.clear()
    scr.push(["delta"])
    scr.set_region(region("C"))
    scr.flush()
    body = "".join(chunks)
    if body.count("delta") != 1:
        bad.append("新转录写了 {} 次（应为 1）".format(body.count("delta")))
    if "alpha" in body or "gamma" in body:
        bad.append("第二次 flush 重写了老转录")
    term.feed(body)
    joined = "\n".join(term.text())
    if "gamma" not in joined or "状态：C" not in joined:
        bad.append("第二轮之后屏幕内容不对")

    # 5. 字符级脏矩形：只动一个字符，写出的字节应远小于整区
    chunks.clear()
    scr.set_region([[Segment("状态：D")], [Segment("-" * width)]])
    small = scr.flush()
    chunks.clear()
    scr2 = SessionScreen(chunks.append, width=width, region_rows=2, profile="none")
    scr2.set_region([[Segment("状态：D")], [Segment("-" * width)]])
    full = scr2.flush()
    if not (0 < small < full):
        bad.append("单字符更新的字节数不合法（{} / {}）".format(small, full))

    # 6. 引擎主循环：脚本化按键（注入 KeySource）驱动输入行 + 提交
    bad += _check_loop(width)
    return bad


def _check_loop(width: int = 60) -> List[str]:
    """主循环端到端：按键注入 → 输入行渲染 → 回车提交 → EOF 退出。

    注意断言的时点：`close()` 会正确地把底部区擦掉，所以**不能**在循环结束后看屏幕——
    要在写出过程中**快照**。而 `drain()` 是每帧都调的，计数只能数"真的推了内容的那几帧"。
    """
    import io

    from ui.ace_prompt import KeySource, LineEditor

    bad: List[str] = []
    term = _Term(width, 14)
    snaps: List[List[str]] = []
    writes: List[str] = []
    pushed: List[str] = []

    def sink(text: str) -> None:
        writes.append(text)
        term.feed(text)
        snaps.append(term.text())

    screen = SessionScreen(sink, width=width, profile="none")
    editor = LineEditor(styler=lambda _k, x: x, width=width, draw=False,
                        keys=KeySource(stream=io.StringIO("hi")))
    sub: List[str] = []

    def drain():
        if not pushed:
            pushed.append("引擎输出：第一行")
            return list(pushed)
        return []

    reason = run_session(editor, screen, editor.keys, drain, sub.append,
                         status=lambda: [Segment("状态：就绪")], tick=0.0)
    if reason != "eof":
        bad.append("主循环退出原因应为 eof，实为 {!r}".format(reason))
    if len(pushed) != 1:
        bad.append("引擎输出被推出 {} 次（应为 1）".format(len(pushed)))
    if "".join(writes).count("引擎输出：第一行") != 1:
        bad.append("转录被写了不止一次（两车道破了）")
    if not any("状态：就绪" in "\n".join(s) for s in snaps):
        bad.append("过程中状态行没出现过")
    if not any("▊ hi" in "\n".join(s) for s in snaps):
        bad.append("过程中输入行没反映按键（注入的按键没进编辑器）")

    # 回车提交
    stream2 = SessionScreen(lambda _t: None, width=width, profile="none")
    editor2 = LineEditor(styler=lambda _k, x: x, width=width, draw=False,
                         keys=KeySource(stream=io.StringIO("hi\r")))
    sub2: List[str] = []
    run_session(editor2, stream2, editor2.keys, lambda: [], sub2.append,
                status=lambda: [Segment("状态：就绪")], tick=0.0)
    if sub2 != ["hi"]:
        bad.append("回车没提交出正确的文本：{!r}".format(sub2))
    if editor2.text != "":
        bad.append("提交后输入行没清空")

    # 退出时不许把状态行留在屏幕上
    leftover: List[str] = []
    tail = SessionScreen(leftover.append, width=width, profile="none")
    tail.set_region([[Segment("状态：就绪")]])
    tail.flush()
    leftover.clear()
    tail.close()
    if "".join(leftover).strip() == "":
        bad.append("close() 没有擦掉底部区（退出后状态行会留在屏幕上）")
    return bad


def _demo() -> int:
    """脚本化跑一遍：打印每次 flush 的字节数与是否重写了转录。"""
    chunks: List[str] = []

    def sink(text: str) -> None:
        chunks.append(text)

    width = shutil.get_terminal_size((100, 30)).columns
    scr = SessionScreen(sink, width=width, region_rows=2, profile="none")
    from ui.ace_cell import Segment

    def region(n: int, busy: bool) -> Screen:
        return [
            [Segment("Nº {:02d} · {}".format(n, "运行中" if busy else "就绪"))],
            [Segment("-" * width)],
        ]

    print("flush# 字节  转录重写  说明")
    plan = [(1, True, 3), (1, True, 0), (1, False, 0), (2, True, 2), (2, True, 0)]
    for i, (turn, busy, new_lines) in enumerate(plan, 1):
        chunks.clear()
        for k in range(new_lines):
            scr.push(["第 {} 轮 第 {} 行定稿".format(turn, k + 1)])
        scr.set_region(region(turn, busy))
        n = scr.flush()
        body = "".join(chunks)
        rewrite = "是" if "定稿" in body else "否"
        print("{:>5}  {:>4}  {:^8}  {}".format(i, n, rewrite,
                                               "状态行变化" if not busy else "运行中"))
    scr.close()
    return 0


if __name__ == "__main__":
    if "--demo" in sys.argv[1:]:
        raise SystemExit(_demo())
    print(__doc__)
