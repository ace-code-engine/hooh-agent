#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ace_events —— 机器可读的事件流（`ace --json`）

为什么需要：终端界面是给人看的，脚本/CI/其它前端（DSH 这类）需要的是**结构化事实**。
此前只有"人看的输出"一条路，于是想做自动化就只能去截屏式地解析人话 —— 那种接口
改一个字就碎。这里给出第二条通道：一行一个 JSON 对象，字段有契约、有断言。

事件契约（stdout，每行一个 JSON 对象；**没有 ANSI、没有 \r 重绘、没有进度条**）：

| type | 必有字段 | 说明 |
|---|---|---|
| `session_start` | `version` `permission` `sandbox` `project_root` | 会话建立 |
| `user_message` | `text` | 用户这一轮说了什么 |
| `model_request` | `round` `messages_count` `system_len` | 每次模型请求的 envelope |
| `tool_start` | `tool` | 工具**即将**执行（另有 `target` 可选；见下方"两个时刻"） |
| `tool_call` | `tool` `params` | 工具执行**之后**的审计记录 |
| `tool_result` | `tool` `status` `elapsed` `message` | 工具结果（`data` 可能很大）；**`outcome` = 机器通道的闭集**（`denied`/`failed`/`deferred`…，见 `tools.status.OUTCOMES`）—— "被拒"与"失败"由此分开，消费者不必解析中文散文 |
| `permission_request` | `tool` `reason` | 需要审批（非交互下随后会被拒） |
| `choice_request` | `kind` `title` | 需要用户做一次选择（`kind` = choose / confirm / text）；**`secret: true` = 凭据输入，外壳不许回显**（H-33） |
| `notice` | `text` | 人看的输出被转成事件（这样"人话"也不会丢） |
| `final` | `text` | 模型的最终回复 |
| `session_end` | `rounds` `tools` `violations` `elapsed` | 会话结束 |
| `model_delta` | `text` | 流式增量（**opt-in**：serve 握手带 `stream: true` 才发） |
| `status` | `segments` | 状态行分段（`[{name, text, priority, level}]`） |
| `agent_preset` | `name` `permission` | **agent 预设切换**（`WP-6`）：`name=""` = 切回无预设；`permission` 是四维生效值（`read`/`edit`/`webfetch`/`bash` → `allow`/`ask`/`deny`），`previous`/`changed`/`warnings` 可选。四壳据此同步"现在是谁在跑、比全局严在哪" |

**两个时刻（驱动 UI 必须分清）**：`tool_call` 是**事后**发出的 —— 它在"执行层已跑完"
的分支里（`ai_code.py:5208`），是审计记录，不是意图预告。想画"工具正在跑"必须用
`tool_start`。两者按出现顺序一一对应（本引擎的工具是串行执行的）。

**`model_delta` 是 opt-in 的**：默认**不发**（一次回复可能几千条 delta，灌进只想要
结论的脚本消费者那里只会让它自己再攒一遍）。要流式渲染的前端在 `initialize` 时带
`stream: true` 打开；不开就只收 `final`。要增量也可以走 SDK 层的 `on_delta`。

> 发射点与屏幕上显示的**是同一份增量**：`ai_code.AgentCLI._make_display` 的
> `_emit_reply` 里，`reply_printed` 记账之后把那个 delta 同时喂给渲染器与这个出口
> （`on_delta_out`）。所以"用户看到的字"与"前端收到的字"逐字节一致 —— 另起一条
> 解析路径必然会与屏幕对不上。`/btw` 这类旁路提问刻意不接（它的正文走 `notice`，
> 接了会让同一句话画两遍）。

**`status` 的发射时机**（结构化输出模式，即 `--json` 与 `--serve`）：会话开始、
每轮模型请求之前、每次工具往返之后、每轮收尾。发的是**分段**不是排好版的一行 ——
去留按宽度与 `priority` 决定，而"有多宽"只有前端知道；CLI 用
`ui/ace_layout.fit_status_line`、前端用 `fitSegments`，同一份数据各自排版。
`style` 不发（那是 prompt_toolkit 的样式类名），改发折算过的 `level`
（`info`/`dim`/`warn`/`danger`/`goal`）—— 那是引擎的判断（"这一段在不在告警"），
前端按 `level` 上色、并对 `name == "permission"` 那一段用 `meta.permission` 自己决定三档颜色。

纯逻辑（事件构造、schema 校验）与输出分离：前者可单测，后者只负责写一行 JSON。
"""

from __future__ import annotations

import json
import re
import sys
import time
from typing import Any, Dict, List, Optional

__all__ = ["EVENT_TYPES", "EVENT_REQUIRED", "make_event", "validate_event",
           "EventEmitter", "NoticeProxy", "strip_ansi"]

EVENT_TYPES = ("session_start", "user_message", "model_request", "tool_start",
               "tool_call", "tool_result", "permission_request", "choice_request",
               "notice", "final", "session_end", "model_delta", "status",
               "agent_preset", "language")

# 每个事件的必需字段（校验与文档的唯一来源）
EVENT_REQUIRED: Dict[str, tuple] = {
    "session_start": ("version", "permission", "sandbox", "project_root"),
    "user_message": ("text",),
    "model_request": ("round", "messages_count", "system_len"),
    # tool_start 只要求 tool：它由"提前偷看模型原文"得出（`ai_code._peek_tool_name`），
    # 那是宽松匹配、认不出就空 —— 要求 params 等于逼调用方编一个出来。
    # 目标（路径/命令）作 `target` 附带，同样是尽力而为。
    "tool_start": ("tool",),
    "tool_call": ("tool", "params"),
    "tool_result": ("tool", "status", "elapsed", "message"),
    "permission_request": ("tool", "reason"),
    "choice_request": ("kind", "title"),
    "notice": ("text",),
    "final": ("text",),
    "session_end": ("rounds", "tools", "violations", "elapsed"),
    "model_delta": ("text",),
    "status": ("segments",),
    # WP-6：预设切换（`core/ace_agents.emit_switch`）。`name` 为空串 = 切回无预设。
    "agent_preset": ("name", "permission"),
    # 界面语言切换：外壳据此换自己的字典（引擎那份由 `ui.i18n.set_language` 负责）
    "language": ("lang",),
}

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def strip_ansi(text: str) -> str:
    """去掉 ANSI 颜色码（事件流里不该有颜色 —— 消费者不是终端）。"""
    return _ANSI.sub("", text or "")


def make_event(type_: str, **fields: Any) -> Dict[str, Any]:
    """构造一个事件（纯函数）。未知类型照样产出 —— 但 `validate_event` 会报出来。"""
    ev: Dict[str, Any] = {"type": str(type_), "ts": round(time.time(), 3)}
    for k, v in fields.items():
        ev[str(k)] = v
    return ev


def validate_event(ev: Any) -> List[str]:
    """校验一个事件：返回问题列表（空 = 合法）。纯函数，可单测。

    只查"类型对不对、必需字段在不在、值能不能 JSON 序列化"这三件**契约**的事，
    不校验业务语义 —— 后者由各自的断言盯着。
    """
    problems: List[str] = []
    if not isinstance(ev, dict):
        return ["事件不是对象"]
    t = ev.get("type")
    if not isinstance(t, str) or not t:
        problems.append("缺少 type")
        return problems
    if t not in EVENT_TYPES:
        problems.append(f"未知事件类型: {t}")
        return problems
    for field in EVENT_REQUIRED.get(t, ()):
        if field not in ev:
            problems.append(f"{t} 缺少字段 {field}")
    if not isinstance(ev.get("ts"), (int, float)):
        problems.append(f"{t} 缺少时间戳 ts")
    try:
        json.dumps(ev, ensure_ascii=False, default=str)
    except (TypeError, ValueError) as e:
        problems.append(f"{t} 不能 JSON 序列化: {e}")
    return problems


class EventEmitter:
    """写事件流：`emit(type, **fields)` → 一行 JSON。

    - 字段里出现不可序列化的对象时用 `default=str` 兜底（**不抛异常**：事件流断了
      比字段变成字符串更糟）
    - `enabled=False` 时是空操作，调用方不必到处判断
    """

    def __init__(self, stream: Any = None, enabled: bool = True) -> None:
        self.stream = stream if stream is not None else sys.stdout
        self.enabled = bool(enabled)
        self.count = 0
        self.by_type: Dict[str, int] = {}

    def emit(self, type_: str, **fields: Any) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None
        ev = make_event(type_, **fields)
        self.count += 1
        self.by_type[type_] = self.by_type.get(type_, 0) + 1
        try:
            self.stream.write(json.dumps(ev, ensure_ascii=False, default=str) + "\n")
            self.stream.flush()
        except (OSError, ValueError):
            pass
        return ev

    def close(self) -> None:
        try:
            self.stream.flush()
        except (OSError, ValueError):
            pass


class NoticeProxy:
    """把"人看的输出"转成 `notice` 事件（`--json` 模式下替换 sys.stdout）。

    为什么用代理而不是把每处 print 都改掉：这个项目的输出点有几百处，
    逐个改既改不完、也会让后来人随手又加一处裸 print。代理是**一处生效**的。

    两件必须做的事：
    - 丢掉 `\\r` 重绘（进度条/转轮）—— 事件流里那些只会变成垃圾
    - 剥掉 ANSI 颜色码 —— 消费者不是终端
    """

    def __init__(self, emitter: EventEmitter, real: Any = None) -> None:
        self.emitter = emitter
        self.real = real if real is not None else sys.__stdout__
        self._buf = ""
        self.encoding = getattr(self.real, "encoding", "utf-8")
        self.errors = getattr(self.real, "errors", "replace")

    # ---- 类文件接口（print 依赖的就是这些） ----
    def write(self, text: str) -> int:
        if not isinstance(text, str):
            text = str(text)
        if "\r" in text:
            # 转轮/进度条：整条丢掉（连同尚未落盘的半行）。
            # 为什么不是"只取 \r 之后那一段"：转轮每 0.12s 重绘一次，把最后一段留下
            # 会在结束换行时把它当 notice 发出去 —— 事件流里就多出一堆 "◈ 思考中 0s"。
            self._buf = ""
            return len(text)
        self._buf += text
        while "\n" in self._buf:
            line, _, self._buf = self._buf.partition("\n")
            self._emit_line(line)
        return len(text)

    def _emit_line(self, line: str) -> None:
        clean = strip_ansi(line).rstrip()
        if not clean.strip():
            return
        self.emitter.emit("notice", text=clean)

    def flush(self) -> None:
        if self._buf:
            self._emit_line(self._buf)
            self._buf = ""
        try:
            self.real.flush()
        except (OSError, ValueError):
            pass

    def isatty(self) -> bool:
        """恒 False：JSON 模式下不该有人以为自己在跟终端说话。"""
        return False

    def fileno(self) -> int:
        return self.real.fileno()

    def close(self) -> None:
        self.flush()
