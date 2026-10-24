#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ace_panel —— 宽度感知的面板 / 分栏 / 菜单排版（首屏与聊天头部共用）

为什么单独成模块：首屏此前是十几行 `print` 拼出来的，字段一多就错位，而且**中文
标签与英文值混排时 `len()` 数的是码点、终端数的是列**（一个汉字两列）。这类错位在
中文优先的工具里是每天第一眼就看到的东西，不是审美问题。这里把"框、左右分栏、
键值行、分组标题、菜单行"做成**纯函数**：返回字符串列表、不打印、不带颜色，
所以既能单测，也能被 `--preview` 与演示录制复用。

颜色由调用方加（`c("dim", ...)`）——排版与配色的职责分开，换肤不动布局。

近似边界与 `ui/ace_text` 一致（CJK 两列、Ambiguous 一列），硬保证是"按本模块口径
不超宽"，不是"在每种终端上都恰好占满"。
"""

from typing import Iterable, List, Sequence, Tuple

from ui.ace_text import ELLIPSIS, display_width, pad_width, truncate_width

__all__ = ["fit_width", "box", "row", "side_by_side", "section", "menu_rows",
           "format_when"]

# 边框：单线圆角。刻意避开双线与制表符混排 —— conhost / 不同字体的对齐更稳。
_TL, _TR, _BL, _BR, _H, _V = "╭", "╮", "╰", "╯", "─", "│"

MIN_WIDTH = 48
MAX_WIDTH = 96
# 框内左右各留一个空格
_PAD = 1


def fit_width(cols: int, margin: int = 4, min_w: int = MIN_WIDTH,
              max_w: int = MAX_WIDTH) -> int:
    """终端列数 → 面板宽度：留出边距并夹在 [min_w, max_w] 内。

    为什么要夹：太窄时框线会把内容挤成一团（不如不加框），太宽时一行字横跨整个
    4K 屏幕，眼睛要找半天。固定上限让界面在大小终端上看起来是同一个东西。
    """
    try:
        cols = int(cols)
    except (TypeError, ValueError):
        return min_w
    if cols <= 0:
        return min_w
    return max(min_w, min(max_w, cols - margin))


def box(title: str, rows: Iterable[str], width: int, title_right: str = "") -> List[str]:
    """单线圆角框，标题嵌在上边框；`title_right` 贴在上边框右侧（如版本号）。

    行内容按**列**截断到内宽，所以中文行不会把右边框顶出去（旧版按字数截断会）。
    """
    width = max(8, int(width))
    inner = max(1, width - 2 - _PAD * 2)
    if title:
        head = f"{_TL}{_H} {title} "
    else:
        head = f"{_TL}{_H}"
    tail = f" {title_right} {_H}{_TR}" if title_right else f"{_H}{_TR}"
    fill = width - display_width(head) - display_width(tail)
    top = head + _H * max(1, fill) + tail if fill >= 1 else \
        truncate_width(head, width, "") + _TR
    out = [top]
    for r in rows:
        body = truncate_width(str(r), inner)
        out.append(f"{_V} " + pad_width(body, inner) + f" {_V}")
    out.append(_BL + _H * (width - 2) + _BR)
    return out


def row(label: str, value: str, width: int, label_w: int = 6) -> str:
    """`标签  值` 一行：标签按列补齐，值超宽按列截断（都不劈双宽字符）。"""
    width = max(8, int(width))
    inner = max(1, width - 2 - _PAD * 2)
    lab = pad_width(truncate_width(str(label), label_w), label_w)
    return f"{lab}  {truncate_width(str(value), max(1, inner - label_w - 2))}"


def side_by_side(left: Sequence[str], right: Sequence[str], gap: int = 3,
                 width: int = 0) -> List[str]:
    """左右两栏并排（左边 logo、右边版本与说明），高度取两者较大者。

    右栏每一行按左栏最宽行对齐；`width > 0` 时右栏整体按列截断，防止长说明把
    行宽撑爆（首屏每多一列都可能触发终端折行，进而把整个面板推歪）。
    """
    left = list(left)
    right = list(right)
    lw = max([display_width(x) for x in left] or [0])
    out: List[str] = []
    for i in range(max(len(left), len(right))):
        l = left[i] if i < len(left) else ""
        r = right[i] if i < len(right) else ""
        pad = " " * (lw - display_width(l) + gap)
        line = f"{l}{pad}{r}" if r else l
        if width > 0:
            line = truncate_width(line, width)
        out.append(line.rstrip())
    return out


def section(title: str, width: int, fill: str = _H, right: str = "") -> str:
    """分组标题：`── 会话 ──────────`（右侧补满，给菜单分组用）。

    给了 `right` 就把它右对齐贴到行尾 —— 面板头要靠它放版本号（原来是画在圆角框的
    上边框里，现在首屏不用框了，同一个信息得有个新位置）。整行**恰好等于 width**。
    """
    w = max(0, int(width))
    head = f"{fill}{fill} {title} "
    tail = f" {right} " if right else ""
    body = fill * max(0, w - display_width(head) - display_width(tail))
    return head + body + tail


def menu_rows(entries: Sequence[Tuple[str, str]], width: int, selected: int = -1,
              first_index: int = 1) -> List[str]:
    """菜单行：`❯ 1. 进入聊天      直接开聊`。

    - 标签列按**最宽标签**对齐（中文两列，用列宽算），说明文字起点因此整齐；
    - 说明按列截断到剩余宽度，不会把终端挤到折行；
    - 选中行只换标记，不加颜色（配色由调用方决定）。
    """
    width = max(8, int(width))
    labels = [str(lbl) for lbl, _ in entries]
    label_w = max([display_width(x) for x in labels] or [0])
    out: List[str] = []
    for i, (label, desc) in enumerate(entries):
        idx = first_index + i
        marker = "❯" if i == selected else " "
        head = f"{marker} {idx}. " + pad_width(str(label), label_w)
        desc = str(desc or "")
        room = width - display_width(head) - 3
        if desc and room > 4:
            head = head + "   " + truncate_width(desc, room)
        out.append(head.rstrip())
    return out


def list_row(left: str, right: str, sub: str, width: int) -> List[str]:
    """**两行一条**的列表行：主行 = 左内容 + **右对齐**的计数，次行 = 降灰补充。

    照 dsh-TUI 会话管理屏的行设计（`▯ 名称 ………… 11 个会话`，次行是暗色路径）：

    - **计数右对齐**是为了竖着扫一眼就能比大小 —— 左对齐的计数彼此错开，比不了；
    - **次行降灰**是为了主次分明（颜色由调用方加，本模块只管排版）；
    - 次行缩进 2 格，落在主行文字的下方而不是标记列下。

    `width` 传**分区宽**（`section()` 那个宽）；行内容按 `width - 2` 收（调用方会给每行加
    2 格缩进，见 `_section_block`）。超宽按列截断，不劈双宽字符。
    """
    left, right, sub = str(left), str(right), str(sub)
    room = max(1, int(width) - 2 - display_width(left) - display_width(right))
    main = truncate_width(left + " " * room + right, max(1, int(width) - 2))
    return [main, ("  " + sub) if sub else ""]


def format_when(ts: float, now: float) -> str:
    """时间戳 → 人话（`今天 10:14` / `昨天 20:27` / `09-18 15:02`）。

    为什么不用相对时间（"3 小时前"）：看会话列表时人记的是"今天上午那次"，
    相对时间还要自己换算；而且相对时间每次都变，截图/svg 重录会一直不稳定。
    """
    import time
    try:
        t = time.localtime(float(ts))
        n = time.localtime(float(now))
    except (TypeError, ValueError, OSError):
        return "?"
    hm = time.strftime("%H:%M", t)
    if (t.tm_year, t.tm_yday) == (n.tm_year, n.tm_yday):
        return f"今天 {hm}"
    if t.tm_year == n.tm_year and t.tm_yday == n.tm_yday - 1:
        return f"昨天 {hm}"
    return time.strftime("%m-%d %H:%M", t)


# 兼容：调用方若想自己接省略号口径，直接用这个常量
_ELLIPSIS = ELLIPSIS
