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


def _status_line(cli, width: int, busy: float) -> List[Segment]:
    """状态行 = （忙时的）spinner + 宿主现成的 `_footer()`（`[(key, text), ...]`）。

    颜色只表达状态：权限档是唯一会因为"危险"变色的字段，其余一律次要灰。
    """
    segs: List[Segment] = []
    if busy > 0:
        idx = int(busy * 1000 / SPIN_MS) % len(SPINNER)
        segs.append(Segment("{} {:.0f}s ".format(SPINNER[idx], busy), "text"))
    try:
        parts = list(cli._footer(width) or [])
    except Exception:                          # noqa: BLE001 —— 画不出来不该拦着会话
        parts = []
    for i, item in enumerate(parts):
        key = str(item[0]) if isinstance(item, (tuple, list)) else ""
        text = str(item[1]) if isinstance(item, (tuple, list)) and len(item) > 1 \
            else str(item)
        role = "warn" if (key == "permission" and "readonly" not in text) else "dim"
        if i or segs:
            segs.append(Segment(" · ", "dim"))
        segs.append(Segment(text, role))
    return segs or [Segment(" ", "dim")]


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
    theme = "light" if os.environ.get("ACE_THEME", "").strip().lower() == "light" \
        else "dark"

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

    def status() -> List[Segment]:
        with lock:
            busy = state["busy"]
            elapsed = (time.monotonic() - state["t0"]) if busy else 0.0
        return _status_line(cli, cols, elapsed)

    def on_menu(cmd: str) -> None:
        on_submit(cmd)

    sink = _LineSink(raw_q)
    saved = sys.stdout
    sys.stdout = sink                                # type: ignore[assignment]
    try:
        reason = run_session(editor, screen, keys, drain, on_submit,
                             status=status, on_menu=on_menu, tick=0.05,
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
    return bad
