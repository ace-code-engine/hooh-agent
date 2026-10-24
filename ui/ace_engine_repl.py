#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_engine_repl —— 把 ace 的 REPL 接到引擎上（`--engine` 走这条路）

分工（`docs/TUI-ENGINE.md`）：

- **车道一**：`print` 出来的整行原样写进终端 scrollback，只写一次。现有的卡片/diff/
  状态提示自己会上色，所以这里不解析、不改写（`push_raw`）。
- **车道二**：状态行 + 输入行走帧缓冲 + 脏矩形，只重画变了的格子。
- **问答**：引擎问权限/确认/文本时走 `ui/ace_host` 的内联面板，**不抢 stdin**。

线程模型（这一版的重点）：

```
主线程（唯一碰终端的人）           worker 线程（跑一轮）
  drain 引擎输出队列  ←──────────── _LineSink: print → 队列
  画底部区 / 读键
  引擎要问问题 ──→ QuestionPump.ask() 阻塞等答案
  渲染问题 + 读键 ──→ resolve(答案) ──→ 拿到答案继续
```

键盘只有一个，渲染也只有一个线程：worker 想画什么、想问什么，都经过队列或泵交回主线程。
不这么做的话，就是两个线程抢同一个终端——那种 bug 只在真机上偶发，测试永远抓不到。
"""

from __future__ import annotations

import os
import queue
import shutil
import sys
import threading
import time
from typing import Any, Callable, List, Optional

from ui import ace_prompt
from ui.ace_cell import Segment
from ui.ace_host import EngineHost
from ui.ace_render import profile_from_caps
from ui.ace_screen import QuestionPump, SessionScreen, run_session

__all__ = ["run_engine_repl", "SPINNER", "SPIN_MS", "load_history", "append_history",
           "check"]

# 帧表用 braille 八帧：点数相邻（无空白跳变），80ms 一拍（研究里 8Hz 太躁、5Hz 刚好，
# 这里取 80ms≈12Hz 只在"忙"时跑，且用时钟取模取帧——不累加、不漂移、后台不空转）。
SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
SPIN_MS = 80
HISTORY_FILE = ".ace_history"
HISTORY_LIMIT = 200


def history_path():
    from pathlib import Path
    return Path.home() / HISTORY_FILE


def _history_off() -> bool:
    """`ACE_NO_HISTORY=1` 关掉历史：历史里可能有用户粘贴过的密钥，得有开关。"""
    return os.environ.get("ACE_NO_HISTORY", "").strip().lower() in ("1", "true", "yes", "on")


def load_history(limit: int = HISTORY_LIMIT) -> List[str]:
    """读跨会话输入历史（顶多 `limit` 条）。读不到就当没有——历史不该拦着启动。"""
    if _history_off():
        return []
    try:
        with open(history_path(), "r", encoding="utf-8", errors="replace") as fh:
            return [ln.rstrip("\n") for ln in fh if ln.strip()][-limit:]
    except Exception:                              # noqa: BLE001
        return []


def append_history(line: str, limit: int = HISTORY_LIMIT) -> None:
    """追加一条历史；文件超过 `limit` 就截断（不然会无限长）。"""
    text = str(line or "").strip()
    if not text or _history_off():
        return
    try:
        rows = load_history(limit) + [text]
        with open(history_path(), "w", encoding="utf-8") as fh:
            fh.write("\n".join(rows[-limit:]) + "\n")
    except Exception:                              # noqa: BLE001 —— 写不了历史不是致命错误
        pass


class _LineSink:
    """顶替 `sys.stdout`：整行进队列，带 `\\r` 的帧丢掉。

    `\\r` 是"此刻"的画面（spinner 重绘、进度行），不是定稿内容——写进 scrollback
    就是脏历史。这条判断与 `ui/ace_fullscreen.TranscriptSink` 同源，不要改回去。
    """

    def __init__(self, out: "queue.Queue") -> None:
        self.q = out
        self._buf = ""

    def write(self, text: str) -> int:
        self._buf += str(text)
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            line = line.rstrip("\r")
            if line.strip():
                self.q.put(line)               # 跨线程：队列是线程安全的
        if "\r" in self._buf:
            self._buf = ""                     # 没换行的重绘帧：丢
        return len(text)

    def flush(self) -> None:
        return None

    def isatty(self) -> bool:
        return False

    def writable(self) -> bool:
        return True


# 底栏样式类 → 引擎屏的语义角色（瑞士 token 只有 `ace_cell.ROLES` 那 7 个）。
#
# 为什么需要这张表：`cli._footer()` 返回的是 `(样式类, 文本)`，而**样式类里就带着状态**
# （只读 / 可写 / 全权 / 目标）。此前这里把 `item[0]` 当**字段名**去比 `== "permission"`，
# 而它实际是 `"class:footer-w"` —— 分支永远不命中，于是引擎屏把每个字段都画成次要灰：
# "当前是写权限"这个最该看见的事实反而没有颜色。规范要的是"状态由颜色区分好坏"，
# 只读（安全）不上色、可写黄、全权红、目标绿，正好落在已有的语义色上。
_FOOTER_ROLE = {
    "class:footer-ro": "dim",      # 只读＝安全：不上色
    "class:footer-w": "warn",
    "class:footer-f": "err",
    "class:footer-goal": "ok",
    "class:footer-dim": "dim",
    "class:footer": "dim",
}


def _status_line(cli, width: int, busy: float) -> List[Segment]:
    """状态行 = **整宽反显条**（照 dsh-TUI 的底栏）。

    三条都是从对方实机截图上读出来的，不是口味：

    ① **反显**（`Segment.inv`）：它的底栏是"选中态"的一整条，所以一眼就能和转录分开。
       规范 §3 把"反显"列进五种层级手段，§1.5 禁的是**铺底色** —— 反显用的是终端
       自己的前后景（不抢用户主题），两者不是一回事。
    ② **整宽**：这一行按**终端宽**返回，`SessionScreen.set_region` 的出血判据会原样放行，
       所以条子直通左右边缘，而不是缩在页边距里。
    ③ **左右分组**：右边的 `上下文 N%` 是"这轮还能写多少"的答案，位置固定才好扫；
       其余信息留在左边按优先级丢（`fit_status_line`，`/statusline` 的配置照旧生效）。

    颜色只表达状态：权限档是唯一会因为"危险"变色的字段，其余一律次要灰。
    """
    from ui import ace_cell, ace_layout, ace_text  # noqa: PLC0415

    def inv(text: str, role: str = "dim") -> Segment:
        return Segment(text, role, None, True)

    parts: List[Segment] = []
    if busy > 0:
        idx = int(busy * 1000 / SPIN_MS) % len(SPINNER)
        parts.append(inv("{} {:.0f}s ".format(SPINNER[idx], busy), "text"))

    def used() -> int:
        return sum(ace_text.display_width(p.text) for p in parts)

    left: List = []
    right = ""
    segs = None
    try:                                   # 真 CLI：走权威分段（含 /statusline 的顺序配置）
        segs = list(cli._status_segments())
    except Exception:                      # noqa: BLE001 —— 测试桩只实现了 _footer
        segs = None
    if segs:
        order, _unknown = ace_layout.parse_statusline(
            (getattr(cli, "cfg", None) or {}).get("statusline"))
        ctx = next((s for s in segs if s.name == "context"), None)
        rest = [s for s in segs if s.name != "context"]
        keep = [n for n in order if n != "context" and any(s.name == n for s in rest)]
        right = (" " + str(ctx.text).strip()) if ctx is not None else ""
        room = max(8, width - used() - ace_text.display_width(right) - 1)
        left = ace_layout.fit_status_line(rest, room, order=keep)
    else:
        try:
            left = list(cli._footer(width) or [])
        except Exception:                  # noqa: BLE001 —— 画不出来不该拦着会话
            left = []

    for i, item in enumerate(left):
        if isinstance(item, (tuple, list)) and len(item) > 1:
            style, text = str(item[0]), str(item[1])
        else:
            style, text = "class:footer", str(item)
        if i:
            parts.append(inv(" · "))
        parts.append(inv(text, _FOOTER_ROLE.get(style, "dim")))

    # 右组只在**放得下**时才加：放不下宁可只显示左组，也不许把条子挤出行外
    if right and used() + ace_text.display_width(right) + 1 <= width:
        parts.append(inv(" " * (width - used() - ace_text.display_width(right))))
        parts.append(inv(right))

    # 收口：恰好 = 终端宽（不够用反显空格补齐，超了按列截断）。末尾补的那段是 fit_row
    # 加的，默认不带反显 —— 不补这一下，条子尾巴会缺一块。
    parts = ace_cell.fit_row(parts, width)
    if parts and not parts[-1].inv:
        parts[-1] = parts[-1]._replace(inv=True)
    return parts or [inv(" " * max(1, int(width)))]


def _activity_line(cli, width: int, busy: float) -> List[Segment]:
    """**本轮在干什么**（照 dsh-TUI 的 `ActivityLine`）：阶段字形 + 文案 + 用时（+ 当前工具）。

    为什么单列一行、而不是把这几项塞进底栏：底栏回答"这个会话的**环境**是什么"
    （模型 / 权限 / 目录 / 上下文），活动行回答"**此刻**在干什么"（思考 / 调用工具 X / 排队 N）——
    两件事的更新频率、寿命、收尾时要怎么处理都不一样。上游同样是分开的两块：
    `ActivityLine` 在输入簇**之上**（`Chat.tsx:5954` 一带），`StatusLine` 在输入簇之**下**。

    引擎屏此前把这条信息**整个丢了**：经典 REPL 那句 `\\r◈ 思考中 3s` 带 `\\r`，被
    `_LineSink` 按"带 \\r 的重绘不是定稿"整条丢掉（那条规矩本身没错：写进 scrollback
    只会变成残影），于是工作期间屏幕上只剩底栏里一个 `⠋ 3s` —— 看不出在思考还是在调工具。
    """
    if busy <= 0:
        return []
    from ui import ace_spinner  # noqa: PLC0415

    phase, label, stalled = "reasoning", _t(cli, "thinking"), False
    sp = getattr(cli, "_spinner", None)
    if sp is not None:                      # 阶段与文案都在 `_Spinner` 上（它本来就是为这个存的）
        phase = str(getattr(sp, "phase", phase) or phase)
        label = str(getattr(sp, "_label", "") or label)
        stalled = bool(getattr(sp, "soft_stalled", False))
    frame = ace_spinner.frame_at(phase, busy, os.environ.get("ACE_REDUCE_MOTION") == "1")
    board = getattr(cli, "_board", None)
    try:
        rows = list(getattr(board, "rows", []) or []) if board is not None else []
        # 有**具名**的工具就用具名的：`正在调用 file_write` 比笼统的「正在调用工具」有信息量
        # （`calling_tool_named` 这个键本来就在，一直是没人用）。
        running = [r for r in rows if str(getattr(r, "state", "")) == "running"]
        if len(running) == 1:
            phase = "tool_running"
            label = _t(cli, "calling_tool_named", tool=str(getattr(running[0], "name", "")))
        head = board.headline() if board is not None else ""
    except Exception:                       # noqa: BLE001 —— 活动行画不出来不该拦着会话
        head = ""
    segs = [Segment(frame + " ", "text"),
            Segment(label, "warn" if stalled else "dim"),
            Segment(" {:.0f}s".format(busy), "dim")]
    if head and len(rows) != 1:             # 多个工具/排队时再补一行摘要（单个时上面已经说了名字）
        segs.append(Segment(" · " + str(head), "dim"))
    return segs


def run_engine_repl(cli, out: Optional[Any] = None,
                    keys: Optional[ace_prompt.KeySource] = None,
                    turn: Optional[Callable[[str], None]] = None,
                    on_exit: Optional[Callable[[str], None]] = None) -> int:
    """跑引擎会话屏，直到 EOF / Ctrl+C 双击确认。返回 0。

    `turn` 可以换掉"跑一轮"的实现（测试用）；默认是 `cli._process_line`。
    """
    real_out = out if out is not None else sys.stdout
    cols = shutil.get_terminal_size((100, 30)).columns
    try:
        from ui.ace_term import detect_capabilities
        caps = detect_capabilities(dict(os.environ), real_out.isatty(),
                                   sys.platform, os.environ.get("TERM", ""))
    except Exception:                          # noqa: BLE001
        caps = {"color": "unknown"}
    profile = profile_from_caps(caps)
    # 色板名由 ace_theme 单点决定（ACE_THEME 认全部色板名，不只是 dark/light），
    # 这样 `--color mist-dark` 与自定义主题才能同时管到引擎屏。
    from ui import ace_theme
    theme = ace_theme.detect_theme()

    screen = SessionScreen(real_out.write, width=cols, profile=profile, theme=theme,
                           region_rows=2)
    keys = keys or ace_prompt.KeySource()
    raw_q: "queue.Queue[str]" = queue.Queue()
    pump = QuestionPump()
    host = EngineHost(screen, keys, translate=lambda k, **kw: _t(cli, k, **kw),
                      width=cols, pump=pump)

    editor = ace_prompt.LineEditor(
        prompt="▊ ", completer=cli._menu_state, width=cols,
        history=load_history(),                    # 跨会话历史（~/.ace_history）
        styler=lambda _k, x: x,                    # 颜色归引擎，输入行不要自带 ANSI
        translate=lambda k, **kw: _t(cli, k, **kw),
        draw=False, keys=keys,
        hotkeys={"c-o": "/expand", "c-e": "/expandall", "c-t": "/tasks",
                 "f1": "/permission", "f2": "/sandbox", "f3": "/net"})

    try:
        cli.attach_ui(host)                        # 权限/确认/文本问答都走内联宿主
    except Exception:                              # noqa: BLE001
        pass

    # busy 只被"开始一轮"和"这一轮结束"改；CPython 下读写单个值是原子的，
    # 状态本身还有一把锁：worker 只写 started/finished，主线程只读。
    state = {"busy": False, "t0": 0.0}
    lock = threading.Lock()
    run_turn = turn or (lambda line: cli._process_line(line))

    def start_turn(text: str) -> None:
        screen.push_raw(["> " + text])             # 用户输入进转录（车道一）
        with lock:
            state["busy"] = True
            state["t0"] = time.monotonic()

        def work() -> None:
            try:
                run_turn(text)
            except KeyboardInterrupt:
                raw_q.put("（已中断）")
            except Exception as e:                 # noqa: BLE001
                raw_q.put("✗ {}".format(e))
            finally:
                with lock:
                    state["busy"] = False

        t = threading.Thread(target=work, daemon=True, name="ace-turn")
        with lock:
            state["thread"] = t
        t.start()

    def on_submit(text: str) -> None:
        line = str(text or "")
        if not line.strip():
            return
        append_history(line)                       # 跨会话历史：只有真的提交了才记
        with lock:
            busy = state["busy"]
        if busy:
            # 忙时回车 = 排队（不打断当前轮），与 REPL 那条 `_queued` 同义
            try:
                cli._queued.append(line)
                screen.push_raw(["· 已排队：{}".format(line)])
            except Exception:                      # noqa: BLE001
                screen.push_raw(["· 正在运行，请稍候"])
            return
        start_turn(line)

    def on_key(key: str) -> bool:
        with lock:
            busy = state["busy"]
        if busy and key == "esc":                  # 忙时 Esc = 请求中断
            try:
                cli.request_stop()
                screen.push_raw(["· 已请求中断"])
            except Exception:                      # noqa: BLE001
                pass
            return True
        return False

    def drain() -> list:
        # 引擎输出（worker 线程放进来的）在这里落到车道一；顺手把排队的一轮起起来
        while True:
            try:
                screen.push_raw([raw_q.get_nowait()])
            except queue.Empty:
                break
        with lock:
            busy = state["busy"]
        if not busy:
            try:
                if getattr(cli, "_queued", None):
                    nxt = cli._queued[0]
                    cli._queued = cli._queued[1:]
                    start_turn(nxt)
            except Exception:                      # noqa: BLE001
                pass
        return []

    def _elapsed() -> float:
        with lock:
            return (time.monotonic() - state["t0"]) if state["busy"] else 0.0

    def status() -> List[Segment]:
        return _status_line(cli, cols, _elapsed())

    def activity() -> List[Segment]:
        """活动行（输入区之上）：只说"此刻在干什么"，干完了就自己消失。"""
        return _activity_line(cli, cols, _elapsed())

    def on_menu(cmd: str) -> None:
        on_submit(cmd)

    sink = _LineSink(raw_q)
    saved = sys.stdout
    sys.stdout = sink                                # type: ignore[assignment]
    try:
        reason = run_session(editor, screen, keys, drain, on_submit,
                             status=status, activity=activity, on_menu=on_menu, tick=0.05,
                             pump=pump, on_key=on_key)
    finally:
        # 收尾：先请 worker 停、等它把话说完，再把最后的输出落盘，最后才交还 stdout。
        # 不这么做的话，退出的瞬间 worker 还在打印，那些字会写到"已经不属于它"的
        # 终端上（或者和 shell 的下一条提示符缠在一起）。
        with lock:
            th = state.get("thread")
        if th is not None and th.is_alive():
            try:
                cli.request_stop()
            except Exception:                      # noqa: BLE001
                pass
            th.join(1.0)
        while True:
            try:
                screen.push_raw([raw_q.get_nowait()])
            except queue.Empty:
                break
        try:
            screen.flush()
        except Exception:                          # noqa: BLE001
            pass
        sys.stdout = saved
        screen.close()
    if callable(on_exit):
        on_exit(reason)
    return 0


def _t(cli, key: str, **kw: Any) -> str:
    """借用 CLI 的翻译函数（没有就原样返回键名）。"""
    for name in ("tr", "t", "_t"):
        fn = getattr(cli, name, None)
        if callable(fn):
            try:
                return str(fn(key, **kw)) if kw else str(fn(key))
            except Exception:                      # noqa: BLE001
                break
    return key


def check(width: int = 60) -> List[str]:
    """端到端（不需要终端）：假 CLI + 注入按键 + 内存输出。

    这一步存在的意义：`--engine` 的真机验证只能靠人跑一次，但**接线本身**（谁调谁、
    输出进不进转录、worker 线程里问的权限会不会被主线程渲染并回答、忙时 Esc 能不能中断）
    可以在这里断言掉。
    """
    import io
    import time as _time

    from ui import ace_menu

    class _SeqKeys:
        """按序给键，但**允许等一个条件**——模拟"用户看到问题才回答"。

        为什么不能一次性把 "hi\\r1" 全灌进去：worker 线程起来要几毫秒，在那之前主循环
        会把 "1" 当成普通输入吃掉，问题只好读到 EOF 判拒绝。这不是测试写法问题，
        是真实存在的时序：**问题出现之前按的键，本来就不该算作答案**。
        """

        def __init__(self, head: str, tail: str, cond) -> None:
            self._head = list(head)
            self._tail = list(tail)
            self._cond = cond
            self._ready = False

        @staticmethod
        def _key(ch: str) -> str:
            # 原始字符要过 parse_key：`"\r"` 不是 `"enter"`，`"\x1b"` 不是 `"esc"`。
            # 少了这一步，回车永远提交不了、主循环空转到天荒地老（已经踩过一次）。
            return ace_prompt.parse_key(ch) if len(ch) == 1 else ch

        def read(self, timeout=None):
            if self._head:
                return self._key(self._head.pop(0))
            if not self._ready:
                if not self._cond():
                    return None                    # 还没到时候：让主循环继续推帧
                self._ready = True
            return self._key(self._tail.pop(0)) if self._tail else ""

    class _FakeCLI:
        def __init__(self) -> None:
            self.seen: List[str] = []
            self.answers: List[str] = []
            self.host = None
            self._queued: List[str] = []
            self.stopped = False

        def _footer(self, width: int = 0):
            return [("model", "test-model"), ("permission", "write")]

        def _menu_state(self, text, cursor):
            return ace_menu.MenuState()

        def attach_ui(self, host) -> None:
            self.host = host

        def request_stop(self) -> None:
            self.stopped = True

    bad: List[str] = []

    # 1. worker 线程里问权限 → 主循环渲染并回答
    out = io.StringIO()
    cli = _FakeCLI()

    def turn(cli) -> Callable[[str], None]:
        def run(line: str) -> None:
            cli.seen.append(line)
            print("引擎输出：" + line)
            cli.answers.append(cli.host.ask_permission(
                "file_write", "要改文件",
                [("once", "就这一次", False), ("session", "本会话允许", True),
                 ("deny", "拒绝", False)]))
        return run

    keys = _SeqKeys("hi\r", "1", lambda: cli.host is not None
                    and cli.host.pump.pending() is not None)
    run_engine_repl(cli, out=out, keys=keys, turn=turn(cli))
    text = out.getvalue()
    if cli.seen != ["hi"]:
        bad.append("提交没送到引擎：{!r}".format(cli.seen))
    if "> hi" not in text:
        bad.append("用户输入没进转录")
    if "引擎输出：hi" not in text:
        bad.append("引擎输出没进转录（车道一没接上）")
    if cli.host is None:
        bad.append("宿主没挂上（权限问答会去抢 stdin）")
    if cli.answers != ["once"]:
        bad.append("跨线程问答答案不对：{!r}".format(cli.answers))
    if "要改文件" not in text:
        bad.append("问题没被主循环画出来")

    # 2. 忙时 Esc = 请求中断（worker 还在跑）
    out2 = io.StringIO()
    cli2 = _FakeCLI()

    def turn_slow(line: str) -> None:
        cli2.seen.append(line)
        print("跑起来了：" + line)
        _time.sleep(0.4)                            # 给主循环时间去读那个 Esc
        print("跑完了")

    keys2 = _SeqKeys("go\r", "\x1b", lambda: bool(cli2.seen))
    run_engine_repl(cli2, out=out2, keys=keys2, turn=turn_slow)
    text2 = out2.getvalue()
    if cli2.seen != ["go"]:
        bad.append("异步提交没送到引擎：{!r}".format(cli2.seen))
    if not cli2.stopped:
        bad.append("忙时按 Esc 没有请求中断")
    if "跑起来了：go" not in text2:
        bad.append("worker 线程的输出没进转录")

    # 3. 跨会话历史：写进去读得回来；ACE_NO_HISTORY=1 时两边都不碰
    #    （落点用仓库根下的临时文件，不用系统临时目录：沙箱里那边建得出来、清理不掉）
    import os as _os
    from pathlib import Path as _Path

    p = _Path(__file__).resolve().parent.parent / ".ace_hist_check.tmp"
    old_path = history_path
    try:
        globals()["history_path"] = lambda: p              # 只改本次检查的落点
        _os.environ.pop("ACE_NO_HISTORY", None)
        append_history("第一条")
        append_history("第二条")
        if load_history() != ["第一条", "第二条"]:
            bad.append("历史写读不一致：{!r}".format(load_history()))
        append_history("")                                  # 空行不该记
        if len(load_history()) != 2:
            bad.append("空行被写进历史了")
        _os.environ["ACE_NO_HISTORY"] = "1"
        if load_history() != []:
            bad.append("ACE_NO_HISTORY=1 时不该读历史")
        append_history("不该被记")
        p.unlink(missing_ok=True)
        append_history("仍然不该被记")
        if p.exists():
            bad.append("ACE_NO_HISTORY=1 时不该写历史")
    finally:
        globals()["history_path"] = old_path
        _os.environ.pop("ACE_NO_HISTORY", None)
        try:
            p.unlink(missing_ok=True)
        except Exception:                                   # noqa: BLE001
            pass

    # 4. 状态行 = **整宽反显条**（照 dsh-TUI 的底栏）。三条一起钉：
    #    ① 恰好等于终端宽（出血线判据靠它，宽一列就会折行）；
    #    ② 每一段都 `inv`（"反显"是它与转录分开的手段，缺一段就断条）；
    #    ③ 右端固定放上下文占用，且**窄终端下也不许被挤掉**。
    class _Bar:
        cfg: dict = {}

        def _status_segments(self) -> list:
            from ui import ace_layout
            return [ace_layout.StatusSegment("model", " deepseek-v4-flash ", "class:footer", 10),
                    ace_layout.StatusSegment("permission", " 权限:write ", "class:footer-w", 10),
                    ace_layout.StatusSegment("turns", " 轮0 工具0 ", "class:footer-dim", 70),
                    ace_layout.StatusSegment("context", " 上下文 12% ", "class:footer", 20)]

    from ui.ace_cell import line_width as _lw
    for _w in (60, 88, 120):
        _bar = _status_line(_Bar(), _w, 0.0)
        if _lw(_bar) != _w:
            bad.append("状态条宽度 {} != 终端宽 {}".format(_lw(_bar), _w))
        if not all(s.inv for s in _bar):
            _no = [s.text for s in _bar if not s.inv][:2]
            bad.append("状态条不是整条反显（这几段没反显：{!r}）".format(_no))
        if not "".join(s.text for s in _bar).rstrip().endswith("上下文 12%"):
            bad.append("状态条右端不是上下文占用：{!r}".format(
                "".join(s.text for s in _bar)[-20:]))
    _narrow = "".join(s.text for s in _status_line(_Bar(), 34, 0.0))
    if "上下文 12%" not in _narrow:
        bad.append("窄终端下上下文被挤掉了（它是右端固定的那一段）：{!r}".format(_narrow))

    # 5. **活动行**（输入区之上）：忙时必须说出"在干什么"，闲时必须为空
    #    （它就是"本轮在干什么"——留着一个空的框只会占掉一行）。
    class _Act:
        cfg: dict = {}
        _spinner: Any = None
        _board: Any = None

    if _activity_line(_Act(), 80, 0.0):
        bad.append("闲时活动行该是空的")
    _Act._spinner = type("_S", (), {"phase": "tool_running", "_label": "调用工具",
                                    "soft_stalled": False})()
    _a = _activity_line(_Act(), 80, 2.0)
    _txt = "".join(s.text for s in _a)
    if "调用工具" not in _txt or "2s" not in _txt:
        bad.append("活动行没说清在干什么：{!r}".format(_txt))
    if _lw(_a) > 80:
        bad.append("活动行超出终端宽：{}".format(_lw(_a)))
    return bad
