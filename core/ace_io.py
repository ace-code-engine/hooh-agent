#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_io —— 终端编码的两道防线（纯逻辑 + 幂等的流加固）

## 为什么会需要这个文件

中文 Windows 的控制台默认是 **cp936（GBK）**。这件事在本项目里踩过两次，症状完全不同：

1. **崩**：往 cp936 的 stdout 写 `📁`/`🤖`/`◐` 这类字符会抛
   `UnicodeEncodeError: 'gbk' codec can't encode character ...` —— 而且**只在输出被重定向时**
   才炸（真控制台走 UTF-16 API，所以"我这儿好好的、脚本里就报错"）。
2. **乱**：把 stdout 强行改成 UTF-8（本项目 `ai_code.py` 早就这么干了）虽然不崩了，但
   **cp936 的终端会把 UTF-8 字节按 GBK 解释** —— 于是 `🤖` 显示成 `馃`、`◐` 显示成问号。

所以这里给两道防线，各治一个：

- `harden_streams()`：**不崩**。把 stdout/stderr 设成 UTF-8 + `errors="replace"`。
  这是"最坏情况下也只是显示成 `?`，不会把一次对话打断"。
- `glyph()` / `safe()`：**不乱**。当终端编不出这个字形时，主动换成 ASCII 版本
  （`◐` → `o`、`✓` → `ok`、`📁` → 文字标签）。**主动降级比让终端去猜好**。

## 判定"终端能不能显示"

判据是 **stdout 的编码**（`encoding`），而不是 `sys.platform`：Windows Terminal + `chcp 65001`
完全能显示 emoji，而老 conhost 不能。`errors="replace"` 已经兜住了崩溃，这里的判据只决定
"要不要主动换成 ASCII"，宁保守勿花屏。
"""

from __future__ import annotations

import sys
from typing import Optional

__all__ = ["harden_streams", "stream_encoding", "console_codepage",
           "display_encoding", "can_encode", "glyph", "safe", "ASCII_FALLBACK"]

#: 常用字形的 ASCII 兜底（cp936 印不出来的那些）
ASCII_FALLBACK = {
    "📁": "[]", "·": ".", "˙": ".", "•": "*",
    "◐": "o", "◓": "o", "◑": "o", "◒": "o", "◉": "O", "○": "o", "●": "*",
    # `◌` 是**工具卡 pending** 的标记（`ui/ace_cards.status_mark`）。它此前不在表里，
    # 于是 cp936 控制台上那张"执行中"的卡片显示成一个 `?` —— 而**不报任何错**。
    # 表里有 `◐`（spinner 那一套）却漏了 `◌`，正是"同一个判据两处各写一份"的老毛病。
    # `test_all [33]` 现在有一条守卫：这些模块会画的字形**一个都不能缺**。
    "◌": "o",
    "◈": "*", "◇": "*", "◆": "*",
    "▁": "-", "▃": "=", "▅": "=", "▇": "#", "▖": ".", "▘": ".", "▝": ".", "▗": ".",
    "✗": "x", "✓": "v", "✘": "x", "‼": "!!", "⚠": "!", "❯": ">", "▶": ">",
    # `ui/ace_widgets` 的小零件：状态图标 `ℹ`、进度条的子格块（八分之一块）、整块 `█`。
    # 守卫（test_all [33]）盯的就是"画得出来但没替身" ⇒ cp936 上显示一个 `?` 且不报错。
    "ℹ": "i", "█": "#",
    "▏": "|", "▎": "|", "▍": "|", "▌": "|", "▋": "|", "▊": "|", "▉": "|",
    # 方块小人（`ui/ace_widgets.BLOCK_FIGURE`）用的四分块，以及思考标记 `∴`
    "▐": "|", "▛": "#", "▜": "#", "▝": ".", "▘": ".", "▗": ".", "▖": ".",
    "▙": "#", "▟": "#", "∴": "...",
    "⚙": "*", "✨": "*", "✅": "ok", "❌": "x", "🧑": "", "🤖": "", "📋": "",
    "🔑": "", "…": "...", "—": "-",
}

_CACHE: dict = {}


def harden_streams() -> None:
    """把 stdout/stderr 加固成"绝不因为编码而崩"（幂等，可在任何入口直接调）。

    只在**能 reconfigure 且当前不是 UTF-8** 时动手；已经是 UTF-8 就只补 `errors`。
    `errors="replace"` 是关键：宁可出现一个 `?`，也不要让一次对话被一个字符打断。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            enc = (getattr(stream, "encoding", "") or "").lower()
            err = getattr(stream, "errors", "") or ""
            if not hasattr(stream, "reconfigure"):
                continue
            if enc in ("utf-8", "utf8", "cp65001"):
                if err != "replace":
                    stream.reconfigure(errors="replace")
            else:
                stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:      # noqa: BLE001 —— 加固失败不该拦住程序启动
            continue


def stream_encoding() -> str:
    """当前 stdout 的编码（小写，取不到就是空串）。"""
    try:
        return (getattr(sys.stdout, "encoding", "") or "").lower()
    except Exception:      # noqa: BLE001
        return ""


def console_codepage() -> Optional[int]:
    """Windows 控制台的**输出代码页**（非 Windows / 取不到 → None）。

    为什么不能只看 stdout 的编码：本模块的 `harden_streams()` 会把 stdout 设成 UTF-8，
    于是"流是 UTF-8"永远为真 —— 可**终端是 cp936 的**，UTF-8 字节会被按 GBK 解释，
    `▶` 照样花屏。所以判定"能不能显示"必须看**控制台自己的代码页**。
    """
    import os as _os
    if _os.name != "nt":
        return None
    try:
        import ctypes
        cp = int(ctypes.windll.kernel32.GetConsoleOutputCP())
        if cp:
            return cp
    except Exception:      # noqa: BLE001
        pass
    try:
        import ctypes
        return int(ctypes.windll.kernel32.GetACP())
    except Exception:      # noqa: BLE001
        return None


def display_encoding() -> str:
    """**实际影响显示**的编码：优先控制台代码页，其次 stdout 的编码。"""
    cp = console_codepage()
    if cp:
        return "utf-8" if cp == 65001 else f"cp{cp}"
    return stream_encoding() or "utf-8"


def can_encode(text: str, encoding: Optional[str] = None) -> bool:
    """这段文本在当前终端编码下能不能真的**显示**出来（能编码 ≈ 能显示）。"""
    enc = (encoding or display_encoding() or "utf-8").lower()
    if enc in ("utf-8", "utf8", "cp65001"):
        return True
    key = (enc, text)
    if key in _CACHE:
        return _CACHE[key]
    try:
        text.encode(enc)
        ok = True
    except (UnicodeEncodeError, LookupError):
        ok = False
    _CACHE[key] = ok
    return ok


def glyph(utf8: str, ascii_fallback: Optional[str] = None,
          encoding: Optional[str] = None) -> str:
    """要显示的字形：终端编不出来就换 ASCII 版本（没登记就查内置表，再没有就用 `?`）。

    `encoding` 可注入 —— 测试要能**确定性地**验"cp936 下会降级、UTF-8 下不降级"，
    而不是取决于跑测试的那台机器当前是什么控制台。
    """
    if can_encode(utf8, encoding):
        return utf8
    if ascii_fallback is not None:
        return ascii_fallback
    return ASCII_FALLBACK.get(utf8, "?")


def safe(text: str, encoding: Optional[str] = None) -> str:
    """整串降级：**逐个字符**看能不能显示，不能的换成 ASCII 兜底。

    用于"必须原样打出去、但可能在老终端里花屏"的场合（状态行、卡片标题等）。
    CJK 汉字在 cp936 下能编码，所以中文不会被换掉 —— 换掉的只有 emoji/特殊符号。
    """
    if can_encode(text, encoding):
        return text
    out = []
    for ch in text:
        out.append(ASCII_FALLBACK.get(ch, ch) if not can_encode(ch, encoding) else ch)
    return "".join(out)
