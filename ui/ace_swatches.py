#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_swatches —— 风格词典屏（瑞士风格试点）

规范：`docs/TUI-SWISS-SPEC.md`；引擎分层：`docs/TUI-ENGINE.md`。

本屏只负责**排版**：产出 `Screen`（`ui.ace_cell`），上色与预览交给 `ui.ace_render`
的三个后端。屏本身不打印、不看时钟、不读文件（`main()` 除外）。

用法：
    python -m ui.ace_swatches                    # 按终端宽度打印
    python -m ui.ace_swatches --width 60 --plain
    python -m ui.ace_swatches --svg out.svg      # 由真渲染器生成预览图
    python -m ui.ace_swatches --check            # 自检（不需要终端）
"""

from __future__ import annotations

import os
import shutil
import sys
from typing import List, NamedTuple, Optional, Sequence, Tuple

from ui.ace_cell import (MARGIN, Screen, Segment, blank_line, line_width, margin,
                         problems, rule)
from ui.ace_render import (ansi256, downgrade, profile_from_caps, render_plain,
                           render_svg, render_terminal, shade)

__all__ = ["Item", "Segment", "ITEMS", "MARGIN", "GUTTER", "LABEL_W", "SWATCH_W",
           "profile_from_caps", "ansi256", "downgrade", "shade", "rule",
           "render_segments", "render_lines", "render_plain", "render_svg", "main"]

GUTTER = 4        # 两列之间：纯留白
LABEL_W = 6       # 编号列：右对齐定宽
SWATCH_W = 2      # 色块：2 cell（cell 是 1:2，所以 2 格宽才是正方形）
COL_MIN = 30      # 单列最小宽度，低于这个数就不排两列


class Item(NamedTuple):
    cn: str
    en: str
    rgb: Tuple[int, int, int]


ITEMS: Tuple[Item, ...] = (
    Item("瑞士风格", "Swiss Style", (226, 59, 34)),
    Item("包豪斯", "Bauhaus", (31, 79, 180)),
    Item("孟菲斯", "Memphis", (246, 168, 192)),
    Item("卡带未来主义", "Cassette Futurism", (232, 163, 61)),
    Item("Y2K", "Y2K Aesthetic", (168, 200, 240)),
    Item("新野兽派", "Neubrutalism", (198, 232, 74)),
    Item("装饰艺术", "Art Deco", (168, 117, 46)),
    Item("蒸汽波", "Vaporwave", (192, 139, 240)),
    Item("玻璃拟态", "Glassmorphism", (127, 209, 222)),
    Item("赛博朋克", "Cyberpunk", (18, 208, 232)),
    Item("极简主义", "Minimalism", (201, 201, 201)),
    Item("像素艺术", "Pixel Art", (111, 217, 138)),
)


# ---------------------------------------------------------------------------
# 排版（纯函数 → Screen）
# ---------------------------------------------------------------------------
def _columns(width: int) -> Tuple[int, int]:
    content = max(0, width - 2 * MARGIN)
    if content >= 2 * COL_MIN + GUTTER:
        return 2, (content - GUTTER) // 2
    return 1, content


def _label(n: int, unicode_ok: bool) -> str:
    return ("Nº {:02d}" if unicode_ok else "No.{:02d}").format(n)


def _track(s: str) -> str:
    """字距：瑞士风格的标签体（全大写 + 拉开）。"""
    return " ".join(s)


def _row(item: Item, idx: int, colw: int, selected: bool,
         unicode_ok: bool) -> List[Segment]:
    from ui.ace_cell import pad_line
    head = [
        Segment(_label(idx + 1, unicode_ok).rjust(LABEL_W),
                "accent" if selected else "dim"),
        Segment(" ", "dim"),
        Segment(" " * SWATCH_W, "swatch", item.rgb),
        Segment(" ", "dim"),
    ]
    avail = colw - line_width(head)
    cn, en = item.cn, item.en
    if line_width([Segment(cn + " " + en)]) > avail:
        from ui.ace_text import truncate_width
        room = avail - line_width([Segment(cn)]) - 1
        if room >= 3:
            en = truncate_width(en, room)
        else:
            cn, en = truncate_width(cn, avail), ""
    body = [Segment(cn, "strong" if selected else "text")]
    if en:
        body += [Segment(" ", "dim"), Segment(en, "dim")]
    out = pad_line(head + body, colw)
    if selected:
        # 只反显本词条的段（色块除外，否则背景色会被反掉）；同一行的另一列不受影响
        out = [s if s.role == "swatch" else s._replace(inv=True) for s in out]
    return out


def render_segments(items: Sequence[Item] = ITEMS, width: int = 120,
                    selected: int = 7, unicode_ok: bool = True) -> Screen:
    """一屏的纯数据形态。断言与快照都打在这里，不打在 ANSI 上。"""
    width = max(20, int(width))
    cols, colw = _columns(width)
    cw = width - 2 * MARGIN
    screen: Screen = []

    # 标题行：编号 · 图书馆标签 · 中文名 …… 右侧范围
    right = (_label(1, unicode_ok) + " — " + "{:02d}".format(len(items))
             if unicode_ok else
             _label(1, unicode_ok) + " - " + "{:02d}".format(len(items)))
    left = [Segment(_label(0, unicode_ok), "dim"), Segment("  ", "dim"),
            Segment(_track("STYLE DICTIONARY"), "text")]
    zh = [Segment("    ", "dim"), Segment("风格词典", "dim")]
    head = left + (zh if line_width(left + zh) + line_width([Segment(right)]) + 2 <= cw
                   else [])
    gap = cw - line_width(head) - line_width([Segment(right)])
    screen.append(margin(head + [Segment(" " * max(1, gap), "dim"),
                                 Segment(right, "dim")], width))
    screen.append([Segment(rule(width), "dim")])

    # 词条网格：行间 1 空行（规范第二节）
    rows = (len(items) + cols - 1) // cols
    for r in range(rows):
        segs: List[Segment] = []
        for c in range(cols):
            i = r * cols + c
            segs += ([Segment(" " * colw, "dim")] if i >= len(items)
                     else _row(items[i], i, colw, i == selected, unicode_ok))
            if c != cols - 1:
                segs.append(Segment(" " * GUTTER, "dim"))
        screen.append(margin(segs, width))
        if r != rows - 1:
            screen.append(blank_line(width))

    # 页脚：细线 · 提示 · 状态（右对齐）
    screen.append([Segment(rule(width), "dim")])
    hint = ("↑↓ 选 · ↵ 应用 · / 过滤 · Esc 取消" if unicode_ok else
            "j/k 选 · Enter 应用 · / 过滤 · Esc 取消")
    status = "{} 项 · {} 列".format(len(items), cols)
    gap = cw - line_width([Segment(hint)]) - line_width([Segment(status)])
    screen.append(margin([Segment(hint, "dim"),
                          Segment(" " * max(1, gap), "dim"),
                          Segment(status, "dim")], width))
    return screen


def render_lines(screen: Screen, profile: str = "256", theme: str = "dark") -> List[str]:
    """兼容别名：终端后端。屏 → 行。"""
    return render_terminal(screen, profile, theme)


# ---------------------------------------------------------------------------
# 自检 + 演示
# ---------------------------------------------------------------------------
def _selfcheck() -> int:
    fails: List[str] = []

    def ok(cond: bool, what: str) -> None:
        if not cond:
            fails.append(what)

    # 1-3. 共享验收：宽度 / 色块 2 格 / 非角色合法 / 一屏一个强调色
    for w in (60, 80, 120):
        for p in problems(render_segments(width=w), w):
            fails.append("width={} {}".format(w, p))

    # 4. 反显只覆盖选中的那一个词条：同行另一列不能跟着反显
    wide = render_segments(width=120, selected=7)
    inv_lines = [line for line in wide if any(s.inv for s in line)]
    ok(len(inv_lines) == 1, "反显行数 {} != 1（应只有选中项所在行）".format(len(inv_lines)))
    if inv_lines:
        labels = {s.text.strip(): s.inv for s in inv_lines[0] if s.text.strip()}
        ok(labels.get("Nº 08") is True, "选中项（Nº 08）未反显")
        ok(labels.get("Nº 07") is False, "同行另一列（Nº 07）被误反显")

    # 5. 窄屏退单列，宽屏两列
    ok(_columns(60)[0] == 1, "60 列应退单列")
    ok(_columns(120)[0] == 2, "120 列应两列")

    # 6. 无色档：宽度不变，且真的没有 ANSI
    plain = render_plain(render_segments(width=80))
    ok(all(line_width([Segment(t)]) == 80 for t in plain), "无色档行宽 != 80")
    ok(not any("\x1b[" in t for t in render_terminal(
        render_segments(width=80), profile="none")), "无色档不应有 ANSI")

    # 7. 三后端宽度一致（engine 的核心契约）
    scr = render_segments(width=80)
    ok([line_width([Segment(t)]) for t in plain] == [80] * len(scr),
       "plain 后端宽度不一致")
    ok([line_width([Segment(t)]) for t in render_terminal(scr)] == [80] * len(scr),
       "terminal 后端宽度不一致")
    svg = render_svg(scr)
    ok('width="{}"'.format(80 * 10 + 40) in svg.split("\n")[0],
       "svg 宽度与 Screen 不一致")
    ok(svg.rstrip().endswith("</svg>"), "svg 未闭合")

    # 8. downgrade 表驱动 + 能力档
    ok(ansi256((255, 0, 0)) == 196, "ansi256(#FF0000) != 196")
    ok(232 <= ansi256((128, 128, 128)) <= 255, "灰色应落 232-255")
    ok(downgrade((255, 0, 0), "256") == "48;5;196", "downgrade 256 错")
    ok(downgrade((1, 2, 3), "truecolor") == "48;2;1;2;3", "downgrade 真彩错")
    ok(downgrade((1, 2, 3), "none") is None, "none 档应返回 None")
    ok(line_width([Segment(shade((255, 255, 255)))]) == 2, "shade 宽度 != 2")
    ok(profile_from_caps({"truecolor": "yes"}) == "truecolor", "真彩档判定错")
    ok(profile_from_caps({"color": "unknown"}) == "16", "unknown 应走保守档")

    # 9. 两个主题：色号来自同一张表，且渲染后宽度一致
    from ui import ace_theme
    ok(set(ace_theme.CELL_THEMES) == {"dark", "light"}, "主题应恰好两个")
    for t in ("dark", "light"):
        for role in ace_theme.SWISS_ROLES:
            ok(bool(ace_theme.cell(role, t)), "{}/{} 取不到色".format(t, role))
        ok(ace_theme.cell("accent", t) != ace_theme.cell("text_2", t),
           "{} 强调色与次要灰撞了".format(t))
        term_t = render_terminal(scr, theme=t)
        ok([line_width([Segment(x)]) for x in term_t] == [80] * len(scr),
           "{} 主题终端后端宽度不一致".format(t))
        ok(render_svg(scr, theme=t).rstrip().endswith("</svg>"),
           "{} 主题 SVG 未闭合".format(t))
    ok(ace_theme.cell_hex("base_bg", "dark") != ace_theme.cell_hex("base_bg", "light"),
       "两个主题的底色应不同")

    # 10. 帧缓冲：格数 == 列数、脏矩形能精确复原、没变化就一个字节都不发
    from ui.ace_canvas import apply_patches, canvas_lines, diff, encode
    from ui.ace_render import render_canvas, render_frame
    c7 = render_canvas(render_segments(width=80, selected=7), theme="dark")
    c8 = render_canvas(render_segments(width=80, selected=8), theme="dark")
    ok(canvas_lines(c7) == render_plain(render_segments(width=80)),
       "帧缓冲的文本与 Screen 不一致")
    ok(all(len(row) == 80 for row in c7), "帧缓冲行格数 != 80（宽字符续格没算对）")
    ok(diff(c7, c7) == [], "相同两帧 diff 不为空（会白发字节）")
    ok(apply_patches(c7, diff(c7, c8)) == c8, "补丁无法精确复原目标帧")
    ok(encode([]) == "", "空补丁集应产出空串")
    moved = render_frame(c7, c8)
    full = render_frame(None, c8)
    ok(0 < len(moved) < len(full), "只移动选中项时应当只写一小部分（{} / {}）".format(
        len(moved), len(full)))

    # 11. 两车道会话屏：字节流喂进终端模拟器，验证历史不被状态行覆盖
    from ui.ace_screen import check as screen_check
    for b in screen_check():
        fails.append("ace_screen: " + b)

    # 12. 引擎宿主（内联问答）+ 引擎 REPL 接线（假 CLI + 注入按键，不需要终端）
    from ui.ace_host import check as host_check
    for b in host_check():
        fails.append("ace_host: " + b)
    from ui.ace_engine_repl import check as repl_check
    for b in repl_check():
        fails.append("ace_engine_repl: " + b)

    # 13. golden（三个宽度）+ 四档色深一致性 + 单帧预算
    import hashlib
    import time
    from ui.ace_render import render_canvas, render_frame
    from ui.ace_canvas import diff as _diff
    GOLDEN = {60: "dedfd0b3cad1", 80: "5c5ad20a0248", 120: "3d16d0fb4ff0"}
    for w, want in GOLDEN.items():
        scr_w = render_segments(width=w)
        for prof in ("truecolor", "256", "16", "none"):
            term_w = render_terminal(scr_w, profile=prof)
            ok(all(line_width([Segment(t)]) == w for t in term_w),
               "width={} profile={} 行宽不一致".format(w, prof))
            if prof == "none":
                ok(not any("\x1b[" in t for t in term_w),
                   "width={} 无色档仍有 ANSI".format(w))
        digest = hashlib.sha256("\n".join(render_plain(scr_w)).encode()).hexdigest()[:12]
        ok(digest == want,
           "width={} 版式变了（golden {} → {}）——确认是有意改的再更新常量".format(w, want, digest))

    scr_w = render_segments(width=120)
    samples: List[float] = []
    prev = None
    for _ in range(5):
        t0 = time.perf_counter()
        for _ in range(20):
            cur = render_canvas(scr_w, profile="truecolor")
            render_frame(prev, cur)
            prev = cur
        samples.append((time.perf_counter() - t0) / 20 * 1000.0)
    frame_ms = sorted(samples)[len(samples) // 2]
    ok(frame_ms <= 8.0, "单帧（整屏重排+diff）{:.2f}ms 超过 8ms 预算".format(frame_ms))
    idle_ms = 0.0
    t0 = time.perf_counter()
    for _ in range(100):
        _diff(prev, prev)
    idle_ms = (time.perf_counter() - t0) / 100 * 1000.0
    ok(idle_ms <= 1.0, "空转帧 {:.3f}ms 不该超过 1ms".format(idle_ms))

    if fails:
        for f in fails:
            print("FAIL: " + f)
        print("{} 项失败".format(len(fails)))
        return 1
    print("OK: 13 组断言通过（共享验收/反显范围/列数/无色档/三后端一致/降级/能力档/"
          "双主题/帧缓冲/两车道/宿主问答/引擎接线/golden+性能）")
    print("    帧预算：整帧 {} 字节 → 只移动选中项 {} 字节；"
          "重排 {:.2f}ms · 空转 {:.3f}ms".format(len(full), len(moved), frame_ms, idle_ms))
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--check" in args:
        return _selfcheck()
    width = int(args[args.index("--width") + 1]) if "--width" in args else \
        shutil.get_terminal_size((120, 40)).columns
    try:
        from ui.ace_term import detect_capabilities
        caps = detect_capabilities(dict(os.environ), sys.stdout.isatty(),
                                   sys.platform, os.environ.get("TERM", ""))
    except Exception:          # noqa: BLE001 —— 探测不了就走保守档
        caps = {"color": "unknown"}
    plain = "--plain" in args
    profile = "none" if plain else profile_from_caps(caps)
    theme = "dark"
    if "--theme" in args:
        theme = args[args.index("--theme") + 1].strip().lower()
    elif os.environ.get("ACE_THEME", "").strip().lower() == "light":
        theme = "light"
    screen = render_segments(width=width,
                             unicode_ok=caps.get("unicode") != "no")
    if "--svg" in args:
        path = args[args.index("--svg") + 1]
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(render_svg(screen, profile=profile or "truecolor", theme=theme))
        print(path)
        return 0
    lines = render_plain(screen) if plain else render_terminal(screen, profile, theme)
    for line in lines:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
