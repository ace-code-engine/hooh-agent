#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_render —— 三个后端：终端 / 纯文本 / SVG

同一份 `Screen`（`ui.ace_cell`）进，三种字符出：

- `render_plain`    → 无 ANSI 的行。给 golden、给 `--plain`、给无色终端看结构。
- `render_terminal` → 带 ANSI 的行。生产用。
- `render_svg`      → 一张预览图。**由真渲染器生成**，不是手画的稿子。

色深四档（truecolor / 256 / 16 / none）都在这里；`none` 档真的一点颜色都不发，
靠字形分深浅——"只给色块去色、灰阶照发"不算无色。
"""

from __future__ import annotations

import colorsys
import html
from typing import Dict, List, Optional, Tuple

from ui.ace_cell import Screen, Segment, line_width
from ui.ace_canvas import Canvas, blank_canvas, diff, encode, write_run
from ui import ace_theme

__all__ = ["profile_from_caps", "ansi256", "ansi16", "downgrade", "shade",
           "render_plain", "render_terminal", "render_svg", "render_canvas",
           "render_frame"]

# 主题色只有一个来源：`ui/ace_theme.CELL_THEMES`。这里不再自己存色号——
# 两个主题（dark / light）在那边定义，终端与 SVG 两个后端都从那儿取。

_BASE16: Tuple[Tuple[int, Tuple[int, int, int]], ...] = (
    (0, (0, 0, 0)), (1, (205, 0, 0)), (2, (0, 205, 0)), (3, (205, 205, 0)),
    (4, (0, 0, 238)), (5, (205, 0, 205)), (6, (0, 205, 205)), (7, (229, 229, 229)),
    (8, (127, 127, 127)), (9, (255, 0, 0)), (10, (0, 255, 0)), (11, (255, 255, 0)),
    (12, (92, 92, 255)), (13, (255, 0, 255)), (14, (0, 255, 255)), (15, (255, 255, 255)),
)


def _clamp(v: int) -> int:
    return 0 if v < 0 else (255 if v > 255 else int(v))


def ansi256(rgb: Tuple[int, int, int]) -> int:
    """真彩 → 256 色号。灰阶单独走 232-255（与 Rich `Color.downgrade()` 同法）。"""
    r, g, b = (_clamp(c) for c in rgb)
    _h, lightness, saturation = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
    if saturation < 0.15:
        gray = int(round(lightness * 25))
        if gray == 0:
            return 16
        if gray == 25:
            return 231
        return 231 + gray

    def cube(c: int) -> int:
        return c // 95 if c < 95 else 1 + (c - 95) // 40

    return 16 + 36 * cube(r) + 6 * cube(g) + cube(b)


def ansi16(rgb: Tuple[int, int, int]) -> int:
    """真彩 → 16 色号（加权最近邻）。"""
    r, g, b = (_clamp(c) for c in rgb)
    best, best_d = 0, None
    for idx, (cr, cg, cb) in _BASE16:
        d = (r - cr) ** 2 * 3 + (g - cg) ** 2 * 6 + (b - cb) ** 2
        if best_d is None or d < best_d:
            best, best_d = idx, d
    return best


def downgrade(rgb: Tuple[int, int, int], profile: str = "256") -> Optional[str]:
    """(r,g,b) → 背景色 SGR 参数；`profile="none"` 返回 None（交给字形兜底）。"""
    p = (profile or "256").lower()
    if p == "truecolor":
        return "48;2;{};{};{}".format(*(_clamp(c) for c in rgb))
    if p == "256":
        return "48;5;{}".format(ansi256(rgb))
    if p == "16":
        return "48;5;{}".format(ansi16(rgb))
    return None


def shade(rgb: Tuple[int, int, int]) -> str:
    """无色档兜底字形：按亮度分四档，宽度恒为 2 cell。

    诚实说明：亮度相近的两个颜色在这一档天然不可区分——所以名字/hex 必须还在旁边。
    """
    r, g, b = (_clamp(c) for c in rgb)
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
    if lum >= 0.72:
        return "░░"
    if lum >= 0.45:
        return "▒▒"
    if lum >= 0.22:
        return "▓▓"
    return "██"


def profile_from_caps(caps: Dict[str, str]) -> str:
    """能力 → 色深档。探不出来（unknown）走保守档，不假装支持真彩。"""
    c = (caps or {})
    if c.get("truecolor") == "yes":
        return "truecolor"
    if c.get("color") == "no":
        return "none"
    if c.get("color") == "yes":
        return "256"
    return "16"


def _code(role: str, theme: str) -> str:
    """角色 → SGR 参数。dim 落到瑞士 token 的 text_2（次要灰），强调色只有一个。"""
    if role == "strong":
        return "1"
    if role == "dim":
        return ace_theme.cell("text_2", theme)
    return ace_theme.cell(role if role in ace_theme.SWISS_ROLES else "text", theme)


def _cell_sgr(seg: Segment, theme: str) -> str:
    """一段的 SGR 参数（不含 ESC/m）。反显是 7 前缀，不是替换颜色。"""
    params = _code(seg.role, theme)
    return "7;" + params if (seg.inv and params) else params


def render_canvas(screen: Screen, profile: str = "256", theme: str = "dark") -> Canvas:
    """`Screen` → 帧缓冲。宽字符占两格（第二格是续格），所以行格数 == 显示列数。"""
    width = max((line_width(l) for l in screen), default=0)
    canvas = blank_canvas(width, len(screen))
    for r, line in enumerate(screen):
        x = 0
        for s in line:
            if s.role == "swatch":
                rgb = s.rgb or (0, 0, 0)
                bg = None if profile == "none" else downgrade(rgb, profile)
                if bg:
                    write_run(canvas, r, x, "  ", bg)
                else:
                    write_run(canvas, r, x, shade(rgb))
            else:
                write_run(canvas, r, x, s.text, _cell_sgr(s, theme))
            x += line_width([s])
    return canvas


def render_frame(prev: Optional[Canvas], cur: Canvas) -> str:
    """两帧之间**实际需要写出去的字节**；没变化就是空串。"""
    return encode(diff(prev or [], cur))


def render_plain(screen: Screen) -> List[str]:
    """无 ANSI。golden、测试、无色终端都用它——屏幕结构必须能脱离颜色读。"""
    return ["".join(s.text for s in line) for line in screen]


def render_terminal(screen: Screen, profile: str = "256",
                    theme: str = "dark") -> List[str]:
    """生产后端。"""
    out: List[str] = []
    for line in screen:
        parts: List[str] = []
        for s in line:
            if profile == "none":
                # 无色档：真的一点颜色都不发，全靠字形与留白
                parts.append(shade(s.rgb or (0, 0, 0))
                             if s.role == "swatch" else s.text)
                continue
            if s.role == "swatch":
                bg = downgrade(s.rgb or (0, 0, 0), profile)
                parts.append("\x1b[{}m  \x1b[49m".format(bg)
                             if bg else shade(s.rgb or (0, 0, 0)))
                continue
            pre = "\x1b[7m" if s.inv else ""
            post = "\x1b[27m" if s.inv else ""
            parts.append("{}\x1b[{}m{}{}\x1b[0m".format(pre, _code(s.role, theme),
                                                        s.text, post))
        out.append("".join(parts))
    return out


def render_svg(screen: Screen, profile: str = "truecolor", theme: str = "dark",
               cell_w: int = 10, font_size: int = 17) -> str:
    """预览后端：把同一份 Screen 画成 SVG。

    `cell_w` 与行高是 1:2（终端单元的真实比例），所以 2 格宽 × 1 行高的色块
    在图上正好是正方形——图不会骗人。
    """
    line_h = cell_w * 2
    pad = cell_w * 2
    cols = max(line_width(l) for l in screen) if screen else 0
    width = cols * cell_w + pad * 2
    height = len(screen) * line_h + pad * 2
    bg = ace_theme.cell_hex("base_bg", theme)
    fg = ace_theme.cell_hex("base_fg", theme)

    def fill_for(role: str) -> str:
        if role == "strong":
            return fg
        if role == "dim":
            return ace_theme.cell_hex("text_2", theme)
        return ace_theme.cell_hex(role, theme)

    out: List[str] = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}" '
        'viewBox="0 0 {} {}">'.format(width, height, width, height),
        '<rect width="100%" height="100%" fill="{}"/>'.format(bg),
        '<g font-family="\'Cascadia Mono\',\'Consolas\',\'DejaVu Sans Mono\','
        '\'Microsoft YaHei\',monospace" font-size="{}" '
        'xml:space="preserve">'.format(font_size),
    ]
    for r, line in enumerate(screen):
        baseline = pad + r * line_h + int(line_h * 0.72)
        x = pad
        for s in line:
            w_cells = line_width([s])
            if s.role == "swatch":
                rgb = s.rgb or (0, 0, 0)
                if profile == "none":
                    out.append('<text x="{}" y="{}" fill="{}">{}</text>'.format(
                        x, baseline, fg, html.escape(shade(rgb))))
                else:
                    out.append('<rect x="{}" y="{}" width="{}" height="{}" '
                               'fill="rgb({},{},{})"/>'.format(
                                   x, pad + r * line_h + int(line_h * 0.14),
                                   w_cells * cell_w, int(line_h * 0.72), *rgb))
            else:
                if s.inv:
                    out.append('<rect x="{}" y="{}" width="{}" height="{}" '
                               'fill="{}"/>'.format(
                                   x, pad + r * line_h + int(line_h * 0.14),
                                   w_cells * cell_w, int(line_h * 0.72), fg))
                weight = ' font-weight="700"' if s.role == "strong" else ""
                color = bg if s.inv else fill_for(s.role)
                out.append('<text x="{}" y="{}" fill="{}"{}>{}</text>'.format(
                    x, baseline, color, weight, html.escape(s.text)))
            x += w_cells * cell_w
    out += ["</g>", "</svg>"]
    return "\n".join(out)
