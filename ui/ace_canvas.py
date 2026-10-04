#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_canvas —— 帧缓冲 + 脏矩形（纯数据：无 IO、无 ANSI 拼接、不看时钟）

Claude Code 的渲染层就是这套东西的内嵌版（`docs/CLAUDE-CODE-TUI-AND-SWATCH-PLAN.md` §2.5）：
`screen` / `prevScreen` 两块缓冲、`blit` 队列、按 `(x, y, width, height, background)` 判脏、
`charPool` + `stylePool` 管字形与样式。这里做的是同一件事的最小可用版：

- `Cell(ch, sgr)` —— 一个格子自己带"画什么字"和"什么样式"；
- `Canvas` —— 二维格子，宽高都必须等于终端列数；
- `diff(prev, cur)` —— **脏矩形**：只回报真正变了的格子，相邻同风格的合并成一段；
- `encode(patches)` —— 把补丁编成最小的光标移动 + SGR + 文本；**没变化就是空串**。

宽字符用"续格"表示：一个汉字占 `Cell("汉", sgr)` + `Cell("", sgr)`，所以**一行的格子数
永远等于显示列数**——这是后面所有对齐断言能成立的前提。

两车道怎么用这套：主屏模式下转录区**直接 print 进终端 scrollback**（定稿内容一次性推出
渲染循环），只有底部保留区（状态行 / 输入行）走 `Canvas` + `diff` 增量重画。这样"history
只写一次、可变区只重画脏格子"两件事同时成立。
"""

from __future__ import annotations

from typing import List, NamedTuple, Optional, Sequence, Tuple

from ui.ace_text import char_width

__all__ = ["Cell", "Canvas", "CONT", "blank_canvas", "canvas_size", "canvas_lines",
           "write_run", "diff", "apply_patches", "Patch", "encode"]

CONT = ""                      # 宽字符的续格标记（它不占列，但不删掉会对不齐）


class Cell(NamedTuple):
    ch: str = " "
    sgr: str = ""              # SGR 参数（不含 ESC 与 m）；"" = 默认样式


class Patch(NamedTuple):
    row: int                   # 0 基
    col: int                   # 0 基
    text: str                  # 要写入的文本（等宽；宽度 = 这段占的列数）
    sgr: str = ""


Canvas = List[List[Cell]]


def blank_canvas(width: int, height: int) -> Canvas:
    return [[Cell() for _ in range(max(0, width))] for _ in range(max(0, height))]


def canvas_size(canvas: Canvas) -> Tuple[int, int]:
    """(宽, 高)。宽按第一行算；空 canvas 得到 (0, 0)。"""
    if not canvas:
        return 0, 0
    return len(canvas[0]), len(canvas)


def canvas_lines(canvas: Canvas) -> List[str]:
    """拼成纯文本行（测试与 golden 用；不含任何 ANSI）。"""
    return ["".join(c.ch for c in row) for row in canvas]


def write_run(canvas: Canvas, row: int, col: int, text: str, sgr: str = "") -> None:
    """把一段文本写进 canvas（就地修改）。宽字符自动占两个格子（第二格是续格）。"""
    if row < 0 or row >= len(canvas):
        return
    line = canvas[row]
    x = col
    for ch in text:
        w = char_width(ch)
        if w <= 0:
            continue                      # 组合符/零宽：不占格
        if x >= len(line):
            break
        line[x] = Cell(ch, sgr)
        if w == 2:
            if x + 1 < len(line):
                line[x + 1] = Cell(CONT, sgr)
            x += 2
        else:
            x += 1


def diff(prev: Canvas, cur: Canvas) -> List[Patch]:
    """脏矩形：只回报变了的格子，同一行相邻且同 SGR 的合并成一段。

    两个不变量（都在 `--check` 里被断言）：
    - `diff(c, c) == []` —— 没变化就一个字节都不发；
    - `apply_patches(prev, diff(prev, cur)) == cur` —— 补丁能精确复原。

    `prev` 缺行/缺列时按**默认空格格**处理：`diff([], cur)` 就是一次整帧重画，
    不能因为没有旧帧就当作"无事发生"（这是个真踩过的坑）。
    """
    patches: List[Patch] = []
    for r, crow in enumerate(cur):
        prow: Sequence[Cell] = prev[r] if r < len(prev) else ()
        n = len(crow)
        c = 0

        def old(i: int) -> Cell:
            return prow[i] if i < len(prow) else Cell()

        while c < n:
            if old(c) == crow[c]:
                c += 1
                continue
            sgr = crow[c].sgr
            start = c
            buf: List[str] = []
            while c < n and crow[c].sgr == sgr and old(c) != crow[c]:
                if crow[c].ch != CONT:
                    buf.append(crow[c].ch)
                c += 1
            patches.append(Patch(r, start, "".join(buf), sgr))
    return patches


def apply_patches(canvas: Canvas, patches: Sequence[Patch]) -> Canvas:
    """把补丁打到一份新的 canvas 上（`diff` 的逆；测试与"先算后画"两处都用）。"""
    out = [list(row) for row in canvas]
    for p in patches:
        write_run(out, p.row, p.col, p.text, p.sgr)
    return out


def encode(patches: Sequence[Patch]) -> str:
    """补丁 → 最小 ANSI：光标定位（1 基）+ SGR + 文本。空补丁集 → 空串。

    刻意不做"光标相对移动"的优化（省几十字节但多一堆边界情况）：脏补丁本来就少，
    真正的成本在 diff 之后，不在编码。
    """
    if not patches:
        return ""
    out: List[str] = []
    last: Optional[Tuple[int, int, str]] = None
    for p in patches:
        pos = (p.row, p.col, p.sgr)
        if pos != last:
            out.append("\x1b[{};{}H".format(p.row + 1, p.col + 1))
            out.append("\x1b[{}m".format(p.sgr) if p.sgr else "\x1b[0m")
            last = pos
        out.append(p.text)
    out.append("\x1b[0m")
    return "".join(out)
