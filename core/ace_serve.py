#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_serve —— 双向 NDJSON 协议服务端（给独立进程的前端用）

## 为什么需要

`ace --json` 是**单向**的：一行一个事件往外吐，前端只能看。授权对话框这类交互做不了 ——
引擎需要一个答案时，那条通道没有回传的路（契约里写的是"非交互下一律 fail-close 拒绝"）。

这个模块补上双向那一半：前端发 `req`、服务端回 `resp`，同时继续把事件作为 `event` 帧吐出去。

## 为什么是 NDJSON over stdio（而不是 TCP / WebSocket / 完整 JSON-RPC）

沿用 `docs/ADR-002-executor-boundary.md` 已经论证过的那一套（Go 执行器协议）：
- **进程生命周期绑在一起**：前端一死，管道断，引擎侧读到 EOF 就收工 —— 不会留下没人认领的后台进程。
  TCP 要自己发明心跳和回收。
- **不需要端口、不需要认证**：stdio 没有"谁都能连"的问题，防火墙也不管。
- **一行一个 JSON**：分帧不需要长度头，`readline` 就是分帧器。
- **不引完整 JSON-RPC**：那要处理 batch、通知、错误对象规范一大套，而我们只有六七个方法。

帧的形体与执行器协议一致（`v` / `type` / `id` 相关 / `seq` 单调），前端作者只用学一套。

## 帧格式

```
client → server
{"v":1,"type":"req","id":"1","method":"initialize","params":{"protocol":1,"stream":true}}
{"v":1,"type":"req","id":"2","method":"user.message","params":{"text":"..."}}
{"v":1,"type":"req","id":"3","method":"permission.answer","params":{"decision":"once"}}

server → client
{"v":1,"type":"resp","id":"1","ok":true,"result":{...}}
{"v":1,"type":"resp","id":"2","ok":false,"error":{"code":"E_BUSY","message":"..."}}
{"v":1,"type":"event","seq":17,"event":{"type":"tool_result","tool":"file_write",...}}
```

## 审批往返（这个模块存在的核心理由）

引擎的审批模型是**状态码往返**：执行层返回 `PERMISSION_REQUEST` + 维护 `pending_permission`，
"谁去问用户"被推到前端。所以这里不需要任何回调魔法，只要：

1. 服务端发一条 `permission_request` **事件**；
2. 服务端**阻塞**等一条 `permission.answer` **req**（`wait_for`）；
3. 把答案交给引擎（`resolve_permission`）。

## 读帧是**嵌套**的，不是多线程的

主循环读到 `user.message` 就同步把引擎跑起来；引擎中途需要审批时，从**同一条调用栈**里
再读一帧。读操作严格嵌套（主循环此刻并没有在读），所以不需要读者线程，也就没有
"两个线程同时读 stdin 把一份 JSON 劈成两半"这类经典麻烦。

代价是一条约定：**审批悬挂期间，前端只该发 `permission.answer`**。发了别的会被回
`E_BUSY` 并且仍然继续等 —— 而不是把答案和杂音一起吞掉。

纯逻辑（帧构造与解析）与 I/O 分离：前者可单测，后者只负责读写行。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable, Dict, List, Optional

from core import ace_events

__all__ = ["PROTOCOL_VERSION", "MAX_LINE_BYTES", "ERRORS", "ERROR_HTTP_LIKE",
           "ServeError", "make_req", "make_resp", "make_event_frame",
           "parse_frame", "validate_frame", "FrameEmitter", "ServeServer",
           "ServeUIHost"]

PROTOCOL_VERSION = 1

# 与 executor/protocol.go 同量级。单行超过它就拒掉：不设上限的话，一条畸形行
# （或对面写进死循环）能把这边的内存吃光，而症状是"整个前端卡死"。
MAX_LINE_BYTES = 1 << 20

# 错误码。`http_like` 让前端能用已有的 HTTP 直觉判断"该不该重试"，
# 与执行器协议同一套写法（见 core/ace_executor.py:111）。
ERRORS: Dict[str, str] = {
    "E_BAD_REQUEST": "帧本身不合法（不是 JSON / 缺字段 / 版本不认识）",
    "E_UNKNOWN_METHOD": "方法不认识（会话继续，只有这一条被拒）",
    "E_UNKNOWN_TYPE": "type 不是 req/resp/event",
    "E_BUSY": "此刻不接受这条请求（如审批悬挂中收到了别的命令）",
    "E_NOT_READY": "还没 initialize 就发业务请求",
    "E_INTERNAL": "服务端内部失败",
    "E_NO_HANDLER": "方法已声明但当前没有注册处理函数（登记未实现）",
}

ERROR_HTTP_LIKE: Dict[str, str] = {
    "E_BAD_REQUEST": "400", "E_UNKNOWN_METHOD": "400", "E_UNKNOWN_TYPE": "400",
    "E_BUSY": "409", "E_NOT_READY": "503", "E_INTERNAL": "500",
    "E_NO_HANDLER": "501",
}


class ServeError(RuntimeError):
    """带错误码的失败。前端看到的是 `{"ok": false, "error": {"code", "message"}}`。"""

    def __init__(self, code: str, message: str = "", data: Any = None) -> None:
        super().__init__(message or code)
        self.code = code
        self.message = message or ERRORS.get(code, code)
        self.data = data

    def to_frame_error(self) -> Dict[str, Any]:
        err: Dict[str, Any] = {"code": self.code, "message": self.message,
                               "http_like": ERROR_HTTP_LIKE.get(self.code, "500")}
        if self.data is not None:
            err["data"] = self.data
        return err


# ---------------------------------------------------------------- 纯逻辑：帧构造

def make_req(id_: str, method: str, params: Optional[Dict] = None) -> Dict[str, Any]:
    """构造一个请求帧（客户端侧用；服务端侧主要用于测试与 fixtures）。"""
    return {"v": PROTOCOL_VERSION, "type": "req", "id": str(id_),
            "method": str(method), "params": dict(params or {})}


def make_resp(id_: str, ok: bool, result: Any = None,
              error: Optional[Dict] = None) -> Dict[str, Any]:
    """构造一个响应帧。失败时**不带 result**（别让前端在两种字段间猜）。"""
    frame: Dict[str, Any] = {"v": PROTOCOL_VERSION, "type": "resp",
                             "id": str(id_), "ok": bool(ok)}
    if ok:
        frame["result"] = result if result is not None else {}
    else:
        frame["error"] = error or {"code": "E_INTERNAL",
                                   "message": ERRORS["E_INTERNAL"],
                                   "http_like": "500"}
    return frame


def make_event_frame(seq: int, event: Dict[str, Any]) -> Dict[str, Any]:
    """把一条事件包进 `event` 帧。`seq` 单调递增，前端据此发现丢帧。

    为什么 `seq` 在**帧**上而不是在事件里：它是传输层的属性（"第几条"），
    事件本身不该关心自己被第几个发出去。
    """
    return {"v": PROTOCOL_VERSION, "type": "event", "seq": int(seq),
            "event": dict(event or {})}


def parse_frame(line: str) -> Dict[str, Any]:
    """一行文本 → 帧字典。纯函数，任何不合法都抛 `ServeError`（带错误码）。

    分三档报错，好让前端知道是"我写错了"还是"协议不认识"：
    - 不是 JSON / 不是对象 → `E_BAD_REQUEST`
    - 缺 `type` / `type` 不认识 → `E_UNKNOWN_TYPE`
    - 版本对不上 → `E_BAD_REQUEST`（附上支持的版本）
    """
    raw = (line or "").strip()
    if not raw:
        raise ServeError("E_BAD_REQUEST", "空行不是合法帧")
    if len(raw.encode("utf-8", "replace")) > MAX_LINE_BYTES:
        raise ServeError("E_BAD_REQUEST",
                         f"单行超过上限 {MAX_LINE_BYTES} 字节")
    try:
        frame = json.loads(raw)
    except (ValueError, TypeError) as e:
        raise ServeError("E_BAD_REQUEST", f"不是合法 JSON: {e}") from e
    if not isinstance(frame, dict):
        raise ServeError("E_BAD_REQUEST", "帧必须是 JSON 对象")
    ftype = frame.get("type")
    if ftype not in ("req", "resp", "event"):
        raise ServeError("E_UNKNOWN_TYPE", f"不认识的 type: {ftype!r}")
    # 版本字段：**必填**，且坏值一律转成 ServeError —— 不能让裸异常穿出去。
    # 修之前是 `if v is not None and int(v) != PROTOCOL_VERSION`：缺 v 直接接受、
    # v=1.9 被 int() 截断成 1 也接受，而 v="abc" 抛的是裸 ValueError，serve_forever
    # 只捕 ServeError → **一条畸形帧就能把服务进程带走**（前端发错一次，整条会话没了）。
    v = frame.get("v")
    if v is None:
        raise ServeError("E_BAD_REQUEST", "缺 v（协议版本必填；本协议不做版本推断）",
                         {"supported": [PROTOCOL_VERSION]})
    if isinstance(v, bool) or not isinstance(v, int):
        raise ServeError("E_BAD_REQUEST",
                         f"v 必须是整数版本号，收到 {v!r}",
                         {"supported": [PROTOCOL_VERSION]})
    if v != PROTOCOL_VERSION:
        raise ServeError("E_BAD_REQUEST",
                         f"协议版本 {v} 不支持（本端为 {PROTOCOL_VERSION}）",
                         {"supported": [PROTOCOL_VERSION]})
    if ftype == "req":
        if not isinstance(frame.get("method"), str) or not frame["method"]:
            raise ServeError("E_BAD_REQUEST", "req 缺少 method")
        if frame.get("id") is None:
            raise ServeError("E_BAD_REQUEST", "req 缺少 id")
        if not isinstance(frame.get("params"), (dict, type(None))):
            raise ServeError("E_BAD_REQUEST", "req 的 params 必须是对象")
    return frame


def validate_frame(frame: Any) -> List[str]:
    """校验一个帧：返回问题列表（空 = 合法）。纯函数，与 `parse_frame` 的分工是
    "这里检查已解析出来的对象"，供测试与 fixtures 自检用。"""
    problems: List[str] = []
    if not isinstance(frame, dict):
        return ["帧不是对象"]
    ftype = frame.get("type")
    if ftype not in ("req", "resp", "event"):
        return [f"不认识的 type: {ftype!r}"]
    if "v" in frame and int(frame["v"]) != PROTOCOL_VERSION:
        problems.append(f"协议版本不对: {frame['v']}")
    if ftype == "req":
        if not frame.get("method"):
            problems.append("req 缺少 method")
        if frame.get("id") is None:
            problems.append("req 缺少 id")
    elif ftype == "resp":
        if frame.get("id") is None:
            problems.append("resp 缺少 id")
        if not isinstance(frame.get("ok"), bool):
            problems.append("resp 缺少布尔 ok")
        elif frame["ok"] and "result" not in frame:
            problems.append("成功的 resp 缺少 result")
        elif not frame["ok"] and "error" not in frame:
            problems.append("失败的 resp 缺少 error")
    else:  # event
        if not isinstance(frame.get("seq"), int):
            problems.append("event 缺少整数 seq")
        if not isinstance(frame.get("event"), dict):
            problems.append("event 缺少事件对象")
        else:
            problems.extend(f"事件: {p}" for p in ace_events.validate_event(frame["event"]))
    return problems


# ---------------------------------------------------------------- I/O：帧发射器

class FrameEmitter:
    """与 `ace_events.EventEmitter` **同接口**，但把事件包进协议帧（带 seq）。

    为什么做成同接口：`ai_code.py` 里已有几十处 `self.events.emit(...)`
    （session_start / tool_call / tool_result / …）。只要在 serve 模式下把 `self.events`
    换成这个对象，那些调用**一行都不用改**就全变成了合法的协议帧。
    `NoticeProxy` 也认这个接口，于是几百处 `print` 也自动变成 `notice` 事件。
    """

    def __init__(self, writer: Callable[[Dict], None]) -> None:
        self._write = writer
        self.seq = 0
        self.count = 0
        self.by_type: Dict[str, int] = {}
        self.enabled = True

    def emit(self, type_: str, **fields: Any) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None
        ev = ace_events.make_event(type_, **fields)
        self.seq += 1
        self.count += 1
        self.by_type[type_] = self.by_type.get(type_, 0) + 1
        self._write(make_event_frame(self.seq, ev))
        return ev

    def close(self) -> None:
        return None


# ---------------------------------------------------------------- 服务端

# 处理函数：收 params，返回 result（任意可 JSON 化的值）；抛 ServeError 即错误响应。
Handler = Callable[[Dict[str, Any]], Any]


def _force_utf8_stdin() -> bool:
    """把 `sys.stdin` 固定成按 UTF-8 读，失败不抛（返回是否真的改过）。

    H-24：本协议的帧是 UTF-8 NDJSON（见本文件头部示例），**读侧也必须按 UTF-8 解**。
    但 Windows 下 `sys.stdin` 默认跟随控制台代码页（本机 cp936），于是中文帧被解成
    乱码或**孤立代理字符**（`\\udcae`），随后序列化时抛 `UnicodeEncodeError` ⇒ 前端
    只收到一条 `E_INTERNAL`，而会话还活着（表现为挂死）。

    `ace.cmd` 里的 `PYTHONUTF8=1` 一直掩盖着这一点；直接
    `python ai_code.py --serve`（正是 Ink 前端的开发路径）就踩得到。

    与 `core/ace_io.harden_streams()` 对称：那边管 stdout/stderr（只关心"别崩"），
    这边管 stdin（协议帧的读）。`errors="replace"` 取"坏字节降级成 U+FFFD 让这一帧
    解析失败并被跳过"，而不是把整个会话打断。
    """
    try:
        enc = (getattr(sys.stdin, "encoding", "") or "").lower()
        if enc in ("utf-8", "utf8", "cp65001"):
            return False
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        return True
    except Exception:  # noqa: BLE001 —— 加固失败不该拦住服务启动
        return False


class ServeServer:
    """双向 NDJSON 服务端。读写流可注入 —— 因此可以在测试里用 StringIO 驱动，
    不需要真的起一个进程。

    `req` 的派发是**同步**的：`serve_forever()` 读一帧、调一次处理函数、写一帧 resp。
    处理函数内部可以再调 `wait_for()` 去要一个答案（审批往返就是这么做的）。
    """

    def __init__(self, reader: Any = None, writer: Any = None,
                 handlers: Optional[Dict[str, Handler]] = None,
                 server_name: str = "ace") -> None:
        if reader is None:
            # 只用真实 stdin 时才加固；注入的 reader（测试的 StringIO）保持原样。
            _force_utf8_stdin()
        self._reader = reader if reader is not None else sys.stdin
        self._writer = writer if writer is not None else sys.stdout
        self._handlers: Dict[str, Handler] = dict(handlers or {})
        self.server_name = str(server_name)
        self.initialized = False
        self.stream_enabled = False          # initialize.params.stream → model_delta
        self.client_info: Dict[str, Any] = {}
        self.emitter = FrameEmitter(self._write_frame)
        self.closed = False
        self.unknown_methods: List[str] = []  # 诊断用：前端发过哪些我们不认识的方法

    # ---- 底层读写 ----

    def _write_frame(self, frame: Dict) -> None:
        """写一帧。**必须整行一次写出并 flush** —— 分行写会让前端读到半个 JSON。"""
        try:
            self._writer.write(json.dumps(frame, ensure_ascii=False, default=str) + "\n")
            self._writer.flush()
        except (OSError, ValueError):
            # 管道断了（前端退出）。不抛：让主循环在下一轮读到 EOF 自然收工，
            # 抛出去只会把栈信息打到 stderr 上，而那时没人看 stderr 了。
            self.closed = True

    def _read_line(self) -> Optional[str]:
        """读一行；EOF 返回 None。"""
        try:
            line = self._reader.readline()
        except (OSError, ValueError):
            return None
        if line == "" or line is None:
            return None
        return line

    def send_event(self, type_: str, **fields: Any) -> Optional[Dict[str, Any]]:
        """发一条事件帧（服务端 → 前端）。"""
        return self.emitter.emit(type_, **fields)

    def send_resp(self, id_: str, ok: bool, result: Any = None,
                  error: Optional[Dict] = None) -> None:
        self._write_frame(make_resp(id_, ok, result, error))

    # ---- 处理函数注册 ----

    def register(self, method: str, handler: Handler) -> None:
        self._handlers[str(method)] = handler

    def has_handler(self, method: str) -> bool:
        return method in self._handlers

    # ---- 派发 ----

    def handle_frame(self, frame: Dict) -> None:
        """处理一帧 `req` 并写出对应的 `resp`。异常一律转成错误响应，**不杀会话**。"""
        id_ = str(frame.get("id", ""))
        method = str(frame.get("method", ""))
        params = frame.get("params") or {}
        handler = self._handlers.get(method)
        if handler is None:
            self.unknown_methods.append(method)
            err = ServeError("E_UNKNOWN_METHOD", f"不认识的方法: {method}")
            self.send_resp(id_, False, error=err.to_frame_error())
            return
        try:
            result = handler(params)
        except ServeError as e:
            self.send_resp(id_, False, error=e.to_frame_error())
        except Exception as e:                 # noqa: BLE001
            # 处理函数的任何异常都不该带走整个会话：前端会看到一条 E_INTERNAL，
            # 而不是"连接莫名其妙没了"。
            err = ServeError("E_INTERNAL", f"{type(e).__name__}: {e}")
            self.send_resp(id_, False, error=err.to_frame_error())
        else:
            self.send_resp(id_, True, result=result)

    def wait_for(self, method: str, timeout: Optional[float] = None) -> Dict[str, Any]:
        """**阻塞**读到一条指定方法的 `req`，返回它的 params。

        审批往返的落点：引擎需要答案时，服务端先发 `permission_request` 事件，
        再调这个函数等 `permission.answer`。

        期间收到别的方法 → 回一条 `E_BUSY` 继续等，**不把它当答案吞掉**
        （吞掉的后果是前端以为命令发出去了，而其实石沉大海）。
        EOF / 超时 → 抛 `ServeError`，由调用方决定怎么降级（引擎侧应 fail-close 拒绝）。
        """
        import time as _time
        deadline = None if timeout is None else _time.monotonic() + float(timeout)
        while True:
            if deadline is not None and _time.monotonic() >= deadline:
                raise ServeError("E_BUSY", f"等待 {method} 超时")
            line = self._read_line()
            if line is None:
                raise ServeError("E_BUSY", "前端已断开（EOF），拿不到答案")
            try:
                frame = parse_frame(line)
            except ServeError as e:
                # 畸形行：告诉前端我们没法用它，继续等真正的答案。
                self._write_frame(make_resp("", False, error=e.to_frame_error()))
                continue
            if frame.get("type") != "req":
                continue                    # resp/event 从客户端来：忽略
            if frame.get("method") == method:
                return dict(frame.get("params") or {})
            err = ServeError("E_BUSY", f"正在等待 {method}，此刻不收 {frame.get('method')}")
            self.send_resp(str(frame.get("id", "")), False, error=err.to_frame_error())

    # ---- 主循环 ----

    def serve_forever(self) -> str:
        """读帧并派发，直到 `shutdown` 或 EOF。返回退出原因（`shutdown` / `eof`）。"""
        while not self.closed:
            line = self._read_line()
            if line is None:
                return "eof"
            if not line.strip():
                continue
            try:
                frame = parse_frame(line)
            except ServeError as e:
                self._write_frame(make_resp("", False, error=e.to_frame_error()))
                continue
            if frame.get("type") != "req":
                continue
            if frame.get("method") == "shutdown":
                self.send_resp(str(frame.get("id", "")), True, result={"ok": True})
                return "shutdown"
            self.handle_frame(frame)
        return "shutdown"


# ---------------------------------------------------------------- 界面宿主

class ServeUIHost:
    r"""把 `attach_ui` 的四个"问人"接口，实现成协议往返。

    ## 为什么是"宿主"而不是"每处加一个分支"

    `AgentCLI.attach_ui(host)` 这条通路本来就存在（组件化全屏界面用它）：引擎跑在
    别的线程里，而"要不要授权""选哪个模型"必须问人；界面一旦挂上，这些提问就走界面，
    不再去抢 stdin。

    所以协议前端**照同一个形状**实现一遍就够了 —— `_ask_permission`、`_pick_option`、
    `_select_index`、`confirm` 那十几处调用点，一行都不用改，全自动走协议。
    反过来，如果每处都加一个 `if serve:` 分支，那就等于把"界面优先级"这条规则
    抄了十几遍，其中必然有几处会被漏掉或写歪。

    ## 拿不到答案一律保守

    前端断开（EOF）或超时：授权 **fail-close 拒绝**，选择返回 `None`（= 用户取消），
    确认返回 `False`（= 否）。三条都不是"猜一个继续"—— 没人回答时，
    「不做」永远比「替他做」安全。
    """

    def __init__(self, server: ServeServer, timeout: float = 600.0,
                 on_deny_feedback: Optional[Callable[[str], None]] = None,
                 grace_hint: str = "", grace_ms: Optional[int] = None) -> None:
        self.srv = server
        self.timeout = float(timeout)
        # 拒绝理由要喂回模型，注册回调由调用方给（那是 CLI 侧的状态）
        self._on_deny_feedback = on_deny_feedback
        # 判为"飞行按键"时要说一句（**已翻译**的文本，与终端那条同一个 i18n 键）；
        # 空串 = 只丢弃、不解释（不给用户留"界面卡住了"的错觉是调用方的责任）
        self._grace_hint = str(grace_hint or "")
        # 宽限期毫秒：`None` = 读 `ACE_PERM_GRACE_MS`（与另两条路同一个来源）。
        # 允许显式传入**只为可测**：测试要能钉住"刚好过界"而不用去改环境变量。
        self._grace_ms = grace_ms
        # 「记住并写规则」意图（WP-AGENCY 刀3）：前端在 `permission.answer` 里多给的
        # `persist` 标志。这里只**收下**（`pop_persist_request` 由调用方取走）——
        # 真正写规则的是调用方（它才有工具参数、规则文件路径与 suggest 安全闸）。
        self._persist_request = False

    # ---- 四问 ----

    def ask_permission(self, tool: str, reason: str,
                       options: Any = None, persist_ok: bool = True) -> str:
        """授权：三态（once / session / deny）。拿不到答案 → deny。

        `persist_ok=False` 时事件里带 `persist_ok: false` —— 前端据此**隐藏**
        「记住并写规则」第 4 项（外发工具不能按工具名记规则；组合/危险包装命令
        的建议模式会被 `suggest_rule_safe` 拒掉）。缺省 True（= 无信号就显示，
        旧调用方行为不变；点了不适用的情况只会收到引擎的解释 notice——安全方向）。

        **防误触宽限期**（`R-2`；与终端 `agent_runner._read_answer`、TUI 的
        `ui/ace_turn.TurnController` 同一条口径，逻辑在 `ui/ace_grace`）：对话框刚弹出来
        那一瞬，用户上一个动作里敲的那一下会正好落在它上面 —— **那一下不算数**。

        判为飞行按键时：不采纳 → `notice` 说清原因 → **把请求重发一次**（多数外壳在作答
        时就把对话框收起来了，不重发它就成了"我答过了、界面却没了"）→ 重问次数用尽后
        直接采纳（`MAX_DISCARDS` 是为了别把"自动化喂输入"的场景永久挡在门外）。

        此前这条路**一道闸门都没有**，而 `ai_code._ask_permission` 的注释却写着它在这里
        —— 注释替代码承诺了（见 `WP-0` 卡的 🔴 头号发现）。
        """
        # 局部导入：`core/` 不依赖 `ui/`（仓库里同类先例见 `core/ace_todos.py`）。
        # `ace_grace` 是**纯逻辑**，放在 `ui/` 只是它的历史位置。
        from ui import ace_grace  # noqa: E402

        gate = ace_grace.GraceGate(self._grace_ms)
        while True:
            gate.arm()
            self.srv.send_event("permission_request", tool=tool, reason=reason,
                                persist_ok=bool(persist_ok))
            try:
                ans = self.srv.wait_for("permission.answer", timeout=self.timeout)
            except ServeError:
                return "deny"
            if gate.admit() or gate.exhausted:
                break
            if self._grace_hint:
                self.srv.send_event("notice", text=self._grace_hint)
        decision = str(ans.get("decision") or "deny")
        if decision not in ("once", "session", "deny"):
            return "deny"
        # 「记住并写规则」只在 session 决策上有意义（只记住一次却没有"以后"可记）。
        self._persist_request = bool(ans.get("persist")) and decision == "session"
        feedback = str(ans.get("feedback") or "")
        if feedback and self._on_deny_feedback is not None:
            try:
                self._on_deny_feedback(feedback)
            except Exception:  # noqa: BLE001 —— 登记不上不该把授权流程带崩
                pass
        return decision

    def pop_persist_request(self) -> bool:
        """取走（并清零）前端随**最近一次授权答案**带来的「记住并写规则」意图。

        放在宿主上而不是协议往返的返回值里：`ask_permission` 的返回值是三条 UI 路
        （终端 / 组件界面 / 协议前端）共用的 `str` 契约，动它就是三处一起改；意图
        只是协议前端多出的一步，收发都挂宿主，另两路自然取不到（False）。
        """
        val = self._persist_request
        self._persist_request = False
        return val

    def choose(self, title: str, options: Any,
               with_effort: bool = False) -> Optional[str]:
        """列表选择（`/model`、`/sessions`…）。返回**选中的那一条文本**，取消 → None。

        返回文本而非下标：与组件界面的 `choose` 同口径（调用方自己 index 回去）。
        """
        items = [str(o) for o in (options or [])]
        if not items:
            return None
        ans = self._ask("choose", title, options=items, with_effort=bool(with_effort))
        if ans is None:
            return None
        vals = ans.get("values")
        if isinstance(vals, list) and vals:
            picked = str(vals[0])
            # P-10：列表外的值 = 用户自填的答案（"让用户自己输入选项"）。
            # 引擎不再用 `picked in items` 主动拒绝 —— 自填值原样回传，调用方自己定夺。
            return picked
        return None

    def confirm(self, question: str) -> bool:
        """二选一确认：**默认否**（关掉 / 超时都不等于同意）。"""
        ans = self._ask("confirm", question)
        return bool(ans and ans.get("accepted"))

    def ask_text(self, prompt: str, default: str = "", *,
                 hidden: bool = False) -> Optional[str]:
        """文本输入（向导步骤、拒绝理由…）。取消 → None。

        `hidden=True`（凭据）时给事件带上 `secret`，外壳据此**不回显**（H-33）——
        此前这个信息在引擎里就到头了，前端收到的只是一句普通文本提示。
        """
        extra = {"secret": True} if hidden else {}
        ans = self._ask("text", prompt, default=str(default), **extra)
        if ans is None:
            return None
        text = ans.get("text")
        return None if text is None else str(text)

    # ---- 内部 ----

    def _ask(self, kind: str, title: str, **extra: Any) -> Optional[Dict[str, Any]]:
        """发一条 `choice_request` 事件并等 `choice.answer`。拿不到 → None。"""
        self.srv.send_event("choice_request", kind=kind, title=title, **extra)
        try:
            return self.srv.wait_for("choice.answer", timeout=self.timeout)
        except ServeError:
            return None
