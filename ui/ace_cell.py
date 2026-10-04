#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_cell —— 唯一的渲染目标（纯数据：无 ANSI、无 IO、不看时钟）

为什么要有这一层：此前每个前端各自决定"怎么把数据变成字符"，于是同一个状态行有两份
实现（`ui/ace_layout.fit_status_line` 有优先级，`tui/app.py:821` 是字符串拼接）、转录
上限只有一边有。引擎的核心就是这个中间层——**所有屏都产出 `Screen`，所有后端都只吃
`Screen`**。

这样切还有个直接好处：瑞士风格规范（`docs/TUI-SWISS-SPEC.md`）里的硬规则
——"每行宽度 == 终端宽""色块恰好 2 格""一屏只有一个强调色"——全都变成**对数据的断言**
（`problems()`），而不是对样式的祈祷。
"""

from __future__ import annotations

from typing import List, NamedTuple, Optional, Sequence, Tuple

from ui.ace_text import display_width, truncate_width

__all__ = ["MARGIN", "ROLES", "Segment", "Line", "Screen", "line_width",
           "pad_line", "fit_row", "blank_line", "margin", "rule", "problems"]

MARGIN = 2          # 页边距：左右各 2 cell（规范第二节）
ROLES = ("dim", "text", "strong", "accent", "swatch", "ok", "warn", "err")


class Segment(NamedTuple):
    """一段文本 + 语义角色。ANSI 由后端决定，这里只描述"它是什么"。

    `inv` = 反显，**按段标记**而不是按行——一行里可能有左右两列，只有选中的那一列该反显。
    """
    text: str
    role: str = "text"          # dim | text | strong | accent | swatch
    rgb: Optional[Tuple[int, int, int]] = None   # 仅 swatch 用
    inv: bool = False


Line = List[Segment]
Screen = List[Line]


def line_width(line: Sequence[Segment]) -> int:
    """一行的显示宽度（CJK 双宽、ANSI 零宽，由 `ui.ace_text` 负责）。"""
    return sum(display_width(s.text) for s in line)


def pad_line(line: Sequence[Segment], width: int, role: str = "dim") -> Line:
    """补空格到 width；已经够宽就原样返回（截断是调用方的决定）。"""
    out = list(line)
    used = line_width(out)
    if used < width:
        out.append(Segment(" " * (width - used), role))
    return out


def fit_row(line: Sequence[Segment], width: int, role: str = "dim") -> Line:
    """**强制**规整到恰好 width：超了按段截断，短了补空格。

    与 `pad_line` 的分工：`pad_line` 只补不截（截断是调用方的决定）；`fit_row` 是
    渲染前的最后一道归一化——底部保留区必须走它，否则一行超宽就会把画布撑成
    非矩形，脏矩形的列号全废。
    """
    out: List[Segment] = []
    used = 0
    for s in line:
        w = display_width(s.text)
        if used + w <= width:
            out.append(s)
            used += w
            continue
        room = width - used
        if room > 0:
            out.append(s._replace(text=truncate_width(s.text, room)))
            used = width
        break
    if used < width:
        out.append(Segment(" " * (width - used), role))
    return out


def blank_line(width: int) -> Line:
    return [Segment(" " * max(0, int(width)), "dim")]


def margin(line: Sequence[Segment], width: int) -> Line:
    """左右各 MARGIN 格页边距：内容刚好 width-2*MARGIN，加上两边就是终端宽度。"""
    content = max(0, int(width) - 2 * MARGIN)
    return ([Segment(" " * MARGIN, "dim")] + pad_line(line, content)
            + [Segment(" " * MARGIN, "dim")])


def rule(width: int, mode: str = "ascii") -> str:
    """整宽细线。默认 ASCII `-`：`─` 在 GBK 下是双宽，DEC 线绘 ace_text 又不认识。"""
    w = max(0, int(width))
    return ("─" if mode == "unicode" else "-") * w


def problems(screen: Sequence[Line], width: int) -> List[str]:
    """共享验收：返回违反规范的条目（空列表 = 通过）。

    所有屏共用这一份——规范不该每个屏各写一遍。返回字符串而不是抛异常，
    是为了让调用方把它直接打印成人能读的清单。
    """
    bad: List[str] = []
    accents = 0
    for i, line in enumerate(screen):
        w = line_width(line)
        if w != width:
            bad.append("第 {} 行宽度 {} != {}".format(i, w, width))
        for s in line:
            if s.role not in ROLES:
                bad.append("第 {} 行有非法角色 {!r}".format(i, s.role))
            if s.role == "swatch":
                if display_width(s.text) != 2:
                    bad.append("第 {} 行色块宽度 != 2".format(i))
                if not s.rgb:
                    bad.append("第 {} 行色块没有 rgb".format(i))
            if s.role == "accent":
                accents += 1
    if accents != 1:
        bad.append("强调色出现 {} 次（规范要求恰好 1 次）".format(accents))
    return bad
