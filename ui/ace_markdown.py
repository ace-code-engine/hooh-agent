#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_markdown —— 终端 Markdown 渲染（受控子集）

为什么需要：模型的回答天然带 Markdown —— 标题、列表、行内代码、代码块、表格。直接
原样打印出来，用户看到的是满屏 `**` 和 `|`；而只做"把星号去掉"又会把代码块和表格
搞坏。这一层做的是**受控子集**：认得的语法渲染，认不出的原样保留（绝不吞内容）。

支持的语法（其余一律按原文输出，宁可少渲染也不猜）：

| 语法 | 渲染 |
|---|---|
| `# ~ ######` 标题 | 加粗 + 上色，层级越深越暗 |
| `- ` / `* ` / `+ ` 无序列表 | `• `，按层缩进 |
| `1. ` 有序列表 | 保留编号并对齐 |
| `> ` 引用 | 暗色 `│ ` 前缀 |
| ```` ``` ```` 围栏代码块 | 暗色缩进 + 语言标注，**内部不做任何行内解析** |
| `\| a \| b \|` 表格 | 按**显示列宽**重排（中文两列），超宽按列截断 |
| `---` 分隔线 | 一条暗色横线 |
| `**粗**` `*斜*` `` `码` `` | ANSI 加粗 / 斜体 / 青色 |
| `[文字](链接)` | `文字 (链接)` —— 终端里不假装能点 |

两条纪律：
- **纯函数**：`render(text, width, styler)` 只依赖入参，`styler` 可注入（测试传 no-op
  就能断言纯文本），所以排版能被单测钉住。
- **不吞内容**：宽度不够就按列截断并给省略号；代码块、表格里的中文按两列算（复用
  `ui/ace_text`），不会把内容挤没。
"""

from __future__ import annotations

import re
from typing import Callable, List, Optional, Tuple

from ui import ace_widgets
from ui.ace_text import display_width, pad_width, truncate_width

__all__ = ["render", "render_inline", "split_blocks", "BlockStreamer",
           "StreamRenderer", "is_table_row", "DEFAULT_WIDTH", "PARTIAL_EMIT_MIN"]

DEFAULT_WIDTH = 100
PARTIAL_EMIT_MIN = 160   # 未完结的行忍到这么多字符就先显示一截（见 StreamRenderer）

# ---- 语法 ----
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET = re.compile(r"^(\s*)([-*+])\s+(.*)$")
_ORDERED = re.compile(r"^(\s*)(\d{1,3})[.)]\s+(.*)$")
_QUOTE = re.compile(r"^>\s?(.*)$")
_FENCE = re.compile(r"^\s*```\s*([A-Za-z0-9_+-]*)\s*$")
_RULE = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$")
_TABLE_SEP = re.compile(r"^\s*\|?[\s:|-]+\|[\s:|-]*$")
_INLINE_CODE = re.compile(r"`([^`]+)`")
_BOLD = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")


def _plain(kind: str, text: str) -> str:
    """no-op styler（测试与无颜色终端用）。签名与真 styler 一致：`(kind, text)`。"""
    return text


def render_inline(text: str, styler: Callable[[str, str], str] = _plain) -> str:
    """行内语法：`**粗**` / `*斜*` / `` `码` `` / `[文字](链接)`。

    先切出代码片段（代码里的 `*` 不该变斜体），其余部分再做替换 —— 顺序反了就会把
    `a **b** c` 里的星号当成列表符。
    """
    out: List[str] = []
    pos = 0
    for m in _INLINE_CODE.finditer(text or ""):
        out.append(_render_plain_inline(text[pos:m.start()], styler))
        out.append(styler("cyan", m.group(1)))
        pos = m.end()
    out.append(_render_plain_inline((text or "")[pos:], styler))
    return "".join(out)


def _render_plain_inline(text: str, styler: Callable[[str, str], str]) -> str:
    s = _LINK.sub(lambda m: f"{m.group(1)} ({m.group(2)})", text)
    s = _BOLD.sub(lambda m: styler("bold", m.group(1)), s)
    s = _ITALIC.sub(lambda m: styler("italic", m.group(1)), s)
    return s


def is_table_row(line: str) -> bool:
    """像表格行吗？（至少两个 `|`，且不是围栏）"""
    t = (line or "").strip()
    return t.count("|") >= 2 and not t.startswith("```")


def _split_cells(line: str) -> List[str]:
    t = (line or "").strip()
    if t.startswith("|"):
        t = t[1:]
    if t.endswith("|"):
        t = t[:-1]
    return [c.strip() for c in t.split("|")]


def _render_table(rows: List[str], width: int,
                  styler: Callable[[str, str], str]) -> List[str]:
    """表格：按**显示列宽**重排并补空格（中文两列，所以列一定对齐）。

    列宽按内容算，总宽超出 `width` 时按比例压缩每一列（而不是把最后一列挤没）。
    """
    grid = [_split_cells(r) for r in rows if not _TABLE_SEP.match(r)]
    if not grid:
        return []
    cols = max(len(r) for r in grid)
    grid = [r + [""] * (cols - len(r)) for r in grid]
    widths = [max(display_width(r[i]) for r in grid) for i in range(cols)]
    # 3 = "| " + " " 两侧最小间隔
    room = max(12, int(width) - (cols * 3 + 1))
    total = sum(widths)
    if total > room and total > 0:
        widths = [max(4, int(w * room / total)) for w in widths]
    out: List[str] = []
    for i, r in enumerate(grid):
        cells = [pad_width(truncate_width(c, widths[j]), widths[j])
                 for j, c in enumerate(r)]
        out.append(styler("dim", "│ ") + styler("dim", " │ ".join(cells))
                   + styler("dim", " │"))
        if i == 0:
            out.append(styler("dim", "├" + "┼".join("─" * (w + 2) for w in widths)
                              + "┤"))
    return out


def render(text: str, width: int = DEFAULT_WIDTH,
           styler: Callable[[str, str], str] = _plain) -> List[str]:
    """Markdown 文本 → 待打印行（含样式，宽度已按显示列算）。

    `styler(kind, text)` 的 kind 取：bold / italic / cyan / dim / head1…head6。
    """
    w = max(20, int(width or DEFAULT_WIDTH))
    lines = str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: List[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        fence = _FENCE.match(line)
        if fence:
            lang = fence.group(1)
            body: List[str] = []
            i += 1
            while i < len(lines) and not _FENCE.match(lines[i]):
                body.append(lines[i])
                i += 1
            i += 1
            label = f" {lang} " if lang else ""
            out.append(styler("dim", "  ┌─" + (label or "─" * 2)))
            for b in body:
                out.append(styler("dim", "  │ ") + truncate_width(b, w - 4))
            out.append(styler("dim", "  └─"))
            continue
        heading = _HEADING.match(line)
        if heading:
            level = len(heading.group(1))
            kind = f"head{min(level, 6)}"
            prefix = "#" * level + " "
            out.append(styler(kind, prefix + _strip_md(heading.group(2))))
            i += 1
            continue
        if _RULE.match(line):
            # 分隔线走**整宽**（此前是 `"─" * min(w, 60)`：宽终端上只有半截，
            # 看起来像"没画完"）。零件与观感照 Claude Code 的 `Divider`：整宽细线。
            out.append(styler("dim", ace_widgets.divider(w)))
            i += 1
            continue
        if is_table_row(line):
            block = [line]
            j = i + 1
            while j < len(lines) and is_table_row(lines[j]):
                block.append(lines[j])
                j += 1
            if len(block) >= 2:
                out.extend(_render_table(block, w, styler))
                i = j
                continue
        quote = _QUOTE.match(line)
        if quote:
            out.append(styler("dim", "│ ") + render_inline(quote.group(1), styler))
            i += 1
            continue
        bullet = _BULLET.match(line)
        if bullet:
            indent = " " * (len(bullet.group(1)) // 2 * 2)
            out.append(indent + styler("cyan", "• ") + render_inline(bullet.group(3),
                                                                    styler))
            i += 1
            continue
        ordered = _ORDERED.match(line)
        if ordered:
            indent = " " * (len(ordered.group(1)) // 2 * 2)
            out.append(indent + styler("cyan", ordered.group(2) + ". ")
                       + render_inline(ordered.group(3), styler))
            i += 1
            continue
        out.append(render_inline(line, styler))
        i += 1
    return [truncate_width(x, w) if display_width(x) > w else x for x in out]


def _strip_md(text: str) -> str:
    """取纯文本（标题里不该留星号/反引号）。"""
    s = _INLINE_CODE.sub(lambda m: m.group(1), text or "")
    s = _BOLD.sub(lambda m: m.group(1), s)
    s = _ITALIC.sub(lambda m: m.group(1), s)
    return _LINK.sub(lambda m: f"{m.group(1)} ({m.group(2)})", s)


def split_blocks(text: str) -> List[Tuple[str, List[str]]]:
    """把文本切成 [(类型, 行)]，类型取 code / text。围栏里的内容不做行内解析。"""
    blocks: List[Tuple[str, List[str]]] = []
    cur_kind = "text"
    cur: List[str] = []
    for line in str(text or "").replace("\r\n", "\n").split("\n"):
        if _FENCE.match(line):
            if cur:
                blocks.append((cur_kind, cur))
                cur = []
            cur_kind = "code" if cur_kind == "text" else "text"
            continue
        cur.append(line)
    if cur:
        blocks.append((cur_kind, cur))
    return blocks


class BlockStreamer:
    """流式 Markdown：攒够一个**完整块**才交给渲染器。

    为什么不能边收边渲染：表格要等所有行才知道列宽，代码围栏要等收尾才知道该不该
    做行内解析。所以按块 flush —— 段落遇到空行、围栏遇到收尾就交付。未完成的留在
    `pending` 里，行数上限兜底（免得一个超长段落把内存堆住）。
    """

    def __init__(self, max_pending_lines: int = 400) -> None:
        self.pending: List[str] = []
        self.max_pending_lines = int(max_pending_lines)
        self._in_code = False
        self._partial = ""          # 还没收到换行的最后一段

    def feed(self, text: str) -> List[str]:
        """追加文本，返回**已经可以渲染的完整行**（调用方负责渲染）。

        关键细节：流式增量以 `\\n` 结尾表示"这一行写完了"，**不代表空行**。
        所以先把最后一段未完结的留在 `_partial` 里，只用完整行做块判定 ——
        第一版直接把 `split("\\n")` 的结果全当行用，于是每个 delta 末尾的空串都被
        当成空行、每收一小段就 flush 一次（纯函数探针当场打出来了）。
        """
        ready: List[str] = []
        data = self._partial + str(text or "")
        parts = data.split("\n")
        self._partial = parts[-1]
        for line in parts[:-1]:
            if _FENCE.match(line):
                self._in_code = not self._in_code
                self.pending.append(line)
                if not self._in_code:        # 围栏收尾：整块交付
                    ready.extend(self.pending)
                    self.pending = []
                continue
            if not self._in_code and not line.strip() and self.pending:
                ready.extend(self.pending)
                ready.append("")
                self.pending = []
                continue
            self.pending.append(line)
            if len(self.pending) >= self.max_pending_lines:
                ready.extend(self.pending)
                self.pending = []
        return ready

    def flush(self) -> List[str]:
        """收尾：把剩下的（含未完结的最后一行）交出来。"""
        if self._partial:
            self.pending.append(self._partial)
            self._partial = ""
        rest = self.pending
        self.pending = []
        self._in_code = False
        return rest


def _sink_print(lines: List[str], final: bool = True) -> None:
    """默认出口：逐行打印。`final=False` 表示最后一段是**还没写完的行片段**（不换行）。"""
    for i, ln in enumerate(lines):
        _last = i == len(lines) - 1
        print(ln, end=("\n" if (final or not _last) else ""), flush=True)


class StreamRenderer:
    r"""流式渲染：**完整行一到就渲染**，只有需要前瞻的结构才等。

    与 `BlockStreamer` 的分工：`BlockStreamer` 攒整块（等空行/围栏收尾）再交付，
    用在"先全后有"的场景；本类是"边收边显示"的场景（模型正在吐字），所以策略不同：

    - 普通行：立刻渲染并交给出口 —— 等一整段才显示，用户会以为程序卡住。
    - 表格：列宽要等所有行，所以把连续表格行攒起来，遇到非表格行/收尾才一次渲染。
      只攒表格，不攒段落 —— 攒段落是 `BlockStreamer` 的活。
    - 代码围栏：围栏行一到就画边框，块内每行直出（内部不做行内解析），收尾画下边框。
    - 未完结的最后一段（没有 `\n` 的部分）留在 `_partial`，不提前渲染成整行 ——
      否则"**粗"会被拆成两半，星号直接漏给用户。

    但**不能一直不显示**：模型写长段时可能几十秒不换行，屏幕上一个字都不动和卡死没
    区别。所以还有一条"忍到 160 字就先给一截"的路（`PARTIAL_EMIT_MIN`）：在**空白处**
    切开、且这一截里的行内标记已经闭合（星号/反引号成对）才交出去 —— 交给出口时标成
    `final=False`（不换行，后面的字接着写在同一行上）。整行到齐后只补渲染剩下的部分，
    不重打前面已经显示过的字。

    出口可注入（`sink`），所以整条链路能被单测钉住，不用真终端。
    """

    def __init__(self, width: int = DEFAULT_WIDTH,
                 styler: Callable[[str, str], str] = _plain,
                 sink: Optional[Callable[..., None]] = None) -> None:
        self.width = max(20, int(width or DEFAULT_WIDTH))
        self.styler = styler
        self._sink = sink or _sink_print
        self._partial = ""
        self._table: List[str] = []
        self._in_code = False
        self._shown = 0           # 当前未完结行里已经显示过的字符数
        self.emitted = 0          # 已经交出去的行数（测试与记账用）

    # ---- 出口 ----
    def _emit(self, lines: List[str], final: bool = True) -> None:
        lines = [x for x in (lines or [])]
        if not lines:
            return
        self.emitted += len(lines)
        self._sink(lines, final)

    def _flush_table(self) -> None:
        if not self._table:
            return
        rows, self._table = self._table, []
        self._emit(render("\n".join(rows), self.width, self.styler))

    # ---- 行处理 ----
    def _line(self, line: str) -> None:
        if self._shown:
            # 这一行的前半截已经作为片段显示过了：只补渲染剩下的部分（不重打）
            rest, self._shown = line[self._shown:], 0
            self._emit([render_inline(rest, self.styler)])
            return
        fence = _FENCE.match(line)
        if self._in_code:
            if fence:
                self._in_code = False
                self._emit([self.styler("dim", "  └─")])
            else:
                self._emit([self.styler("dim", "  │ ")
                            + truncate_width(line, self.width - 4)])
            return
        if fence:
            self._flush_table()
            self._in_code = True
            lang = fence.group(1)
            label = f" {lang} " if lang else ""
            self._emit([self.styler("dim", "  ┌─" + (label or "─" * 2))])
            return
        if is_table_row(line):
            self._table.append(line)
            return
        self._flush_table()
        self._emit(render(line, self.width, self.styler))

    def _maybe_show_partial(self) -> None:
        """忍到 `PARTIAL_EMIT_MIN` 字就先显示一截（否则长段落期间屏幕上什么都不动）。

        切开的条件刻意保守：**只能在空白处切**（不把一个词/中文字切两半）、切开处
        的行内标记必须已经闭合（星号/反引号成对）、结构性行（标题/表格/引用/围栏/
        列表）整行等 —— 它们要整体判断，先显示半行反而是错的。
        """
        line = self._partial
        if self._in_code or self._table or len(line) - self._shown < PARTIAL_EMIT_MIN:
            return
        head_from = self._shown
        cut = line.rfind(" ", head_from, head_from + PARTIAL_EMIT_MIN)
        if cut <= head_from:
            return
        head = line[head_from:cut + 1]
        if head.count("*") % 2 or head.count("`") % 2:
            return                                  # 标记还没闭合，再等等才安全
        if _HEADING.match(head) or _QUOTE.match(head) or _BULLET.match(head) \
                or _ORDERED.match(head) or _FENCE.match(head) or is_table_row(head):
            return
        self._shown = cut + 1
        self._emit([render_inline(self._partial[head_from:cut + 1], self.styler)],
                   final=False)

    def feed(self, text: str) -> None:
        """追加一段流式文本（deltas 以 `\n` 收尾表示"这行写完了"）。"""
        data = self._partial + str(text or "")
        parts = data.split("\n")
        self._partial = parts[-1]
        for line in parts[:-1]:
            self._line(line)
        self._maybe_show_partial()

    def flush(self) -> None:
        """收尾：把未完结的最后一行与攒着的表格交出去。必须调用。"""
        if self._partial:
            tail, self._partial = self._partial, ""
            self._line(tail)
        self._flush_table()
        self._in_code = False
