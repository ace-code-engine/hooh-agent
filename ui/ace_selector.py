#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ace_selector —— 搜索式选择器（借鉴 OpenClaw 的 SearchableSelectList）

给 REPL 的 /model /provider /goal 等切换命令提供「居中浮层选择器」：

- 输入即过滤：顶部输入框键入即按子串过滤列表，命中词高亮
- ↑↓ / j k 导航（j/k 在过滤框为空时生效，避免与打字冲突），Enter 确认
- Esc 分级取消：先清空过滤词回到全量列表，再按一次才真正取消
- v 展开/收起预览（提供 preview_fn 时），底部显示滚动位置（如 12/50）
- 非 TTY（sys.stdin / sys.stdout 非 isatty）不进入交互、不阻塞：
  直接返回第一个匹配（空过滤 = 全部项 → 下标 0）或 None（无选项时）

实现说明
--------
为什么不用 PromptSession 直接承载列表：PromptSession（及其底层的
create_prompt_application）只能渲染「单行输入 + 单行 bottom_toolbar」，
放不下「输入 + 列表」双窗格，completer 弹窗菜单也不是整页列表。因此本模块
采用 prompt_toolkit 官方对话框（input_dialog / message_dialog）同款写法：
Application + Layout + Float，把面板做成居中浮层（FloatContainer 覆盖在
当前屏幕之上）。交互模型与需求一致——一个 Buffer 接收过滤词，
on_text_changed 每次输入变化重绘列表窗格（invalidate），Enter 确认当前
高亮项，Esc 分级处理，v 预览，j/k 导航。

可测性：匹配 / 过滤 / 高亮抽成纯函数（match_positions / match_score /
filter_items / highlight_match），不依赖 prompt_toolkit，test_all.py 直接测试。

匹配是**子序列 + 加权**，不是子串：命令面板一类界面的常规做法（fzf / VSCode 同源
思路）。打 "dsk" 能命中 "deepseek"，打 "glm4" 能命中 "glm-4.6" —— 子串匹配下这两个
最常用的输入都是 0 命中，用户只能一个字不差地打全。评分与高亮同源（都从
match_positions 出来），不会出现"排上来了但没高亮"这种两套逻辑打架的情况。

依赖：prompt_toolkit 为可选依赖，仅在交互路径内延迟导入；缺失或运行异常时
run_selector 返回 None（降级不阻塞，绝不拖垮 REPL）。
"""

from __future__ import annotations

import sys
from typing import Callable, List, Optional, Tuple, Union

from ui import ace_theme
from ui.ace_text import SEPARATORS

__all__ = ["run_selector", "run_multiselect", "match_positions", "match_score",
           "filter_items", "highlight_match"]


# ============================================================
# 纯逻辑（不依赖 prompt_toolkit，可直接单测）
# ============================================================

def match_positions(item: str, query: str) -> Optional[List[int]]:
    """子序列匹配：返回命中字符的下标（升序、去重）；不命中返回 None。

    空查询返回 `[]`（表示"全部命中"，由上层等权处理 —— 与"不命中 None"是两件事，
    调用方必须分开处理）。

    多词查询按空格拆分，**每个词都必须命中**（AND 语义）；各词下标合并。
    每个词内部按"逐字符向后找"匹配，因此 `dsk` 能命中 `deepseek`。
    """
    q = query.strip().lower()
    if not q:
        return []
    text = item.lower()
    hits: List[int] = []
    for term in q.split():
        start = 0
        for ch in term:
            idx = text.find(ch, start)
            if idx < 0:
                return None
            hits.append(idx)
            start = idx + 1
    return sorted(set(hits))


def match_score(item: str, query: str) -> int:
    """匹配评分；0 = 不匹配，分数越高越靠前。

    沿用原来那套排序直觉（前缀 > 中间、完全相等置顶），只是把"子串"放宽成"子序列"：

    - 空查询：全部项等权（1）
    - 完全相等：+5000（置顶）
    - 每个命中字符基础 10 分
    - **连续命中**每个 +8：`deep` 命中 `deepseek` 比命中 `d_e_e_p` 更该排前面
    - **词边界命中**每个 +6（前一个字符是分隔符或串首）：`-v4` 里的 v 比词中的 v 值钱
    - 越靠前越值钱：减去首个命中下标
    - 越集中越值钱：减去命中跨度（末 - 首）
    """
    q = query.strip().lower()
    if not q:
        return 1
    pos = match_positions(item, q)
    if pos is None:
        return 0
    text = item.lower()
    score = 10 * len(pos)
    for i, idx in enumerate(pos):
        if i and idx == pos[i - 1] + 1:
            score += 8                       # 连续命中
        if idx == 0 or text[idx - 1] in SEPARATORS:
            score += 6                       # 词边界命中
    score -= pos[0]                          # 越靠前越好
    score -= pos[-1] - pos[0]                # 越集中越好
    if text == q:
        score += 5000                        # 完全相等置顶
    return score


def filter_items(items: List[str], query: str) -> List[Tuple[int, int]]:
    """过滤并排序：返回 [(原下标, 评分), ...]，评分 0 的被滤除。

    按评分降序，同分保持原列表顺序（Python sort 稳定），因此空查询时
    结果顺序 == 原列表顺序，非 TTY 降级路径的「第一个匹配」即下标 0。
    """
    scored = [(i, match_score(it, query)) for i, it in enumerate(items)]
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return [(i, s) for i, s in scored if s > 0]


def highlight_match(text: str, query: str) -> List[Tuple[str, str]]:
    """命中高亮分段：返回 [(token, 片段), ...]，可直接喂 prompt_toolkit 渲染。

    - token 为 "sel.row"（普通）或 "sel.hl"（命中）；渲染端对选中行再做
      "sel.row"→"sel.row.sel" / "sel.hl"→"sel.hl.sel" 升级
    - **整词能命中就标出它的所有出现**（原有承诺，保留）：多词查询各自把出现的
      区间标满，重叠/相邻的合并
    - **整词命中不了才退回子序列**（与 match_score 同一套判定）：此时标出真正被
      匹配上的那些字符，不会出现"排上来了却一个字都没高亮"
    - 相邻命中合并成一段：`deep` 是一段 `deep`，不是四段单字符（终端里逐字符上色
      会让颜色转义码把行长算乱）
    - 纯函数、不依赖 prompt_toolkit，可直接单测
    """
    q = query.strip().lower()
    if not q:
        return [("sel.row", text)]
    low = text.lower()
    runs: List[List[int]] = []
    for term in q.split():
        start, as_substring = 0, False
        while True:
            idx = low.find(term, start)
            if idx < 0:
                break
            runs.append([idx, idx + len(term)])
            start = idx + len(term)
            as_substring = True
        if as_substring:
            continue
        # 整词命中不了：逐字符向后找（match_score 判定它能命中，这里必然找得到）
        pos, cursor = [], 0
        for ch in term:
            idx = low.find(ch, cursor)
            if idx < 0:
                return [("sel.row", text)]
            pos.append(idx)
            cursor = idx + 1
        runs.extend([i, i + 1] for i in pos)
    if not runs:
        return [("sel.row", text)]
    runs.sort()
    merged = [runs[0]]
    for s, e in runs[1:]:
        if s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    segs: List[Tuple[str, str]] = []
    cursor = 0
    for s, e in merged:
        if s > cursor:
            segs.append(("sel.row", text[cursor:s]))
        segs.append(("sel.hl", text[s:e]))
        cursor = e
    if cursor < len(text):
        segs.append(("sel.row", text[cursor:]))
    return segs


# ============================================================
# 交互状态
# ============================================================

class _SelectorState:
    """交互状态：过滤词、高亮下标、滚动偏移、预览开关、过滤结果。

    `multi=True` 时多两个字段：`checked`（已勾选的**原下标**集合）与
    `result_multi`（确认后的下标列表）。单选/多选共用同一套过滤与滚动 ——
    多选不是另一套浮层，只是同一个浮层多一个按键。
    """

    def __init__(self, items: List[str], preview_fn, max_height: int,
                 multi: bool = False,
                 initial: Optional[List[int]] = None) -> None:
        self.items = items
        self.preview_fn = preview_fn
        self.max_height = max(3, int(max_height))
        self.multi = bool(multi)
        self.checked = {int(i) for i in (initial or [])
                        if 0 <= int(i) < len(items)}
        self.query = ""
        self.selected = 0          # 在过滤结果中的下标（0-based）
        self.scroll = 0            # 可见窗口首行（相对过滤结果）
        self.show_preview = False  # v 开关
        self.result: Optional[int] = None
        self.result_multi: Optional[List[int]] = None
        self.matches = filter_items(items, "")   # [(原下标, 评分)]

    @property
    def matched_items(self) -> List[Tuple[int, str]]:
        """过滤结果 [(原下标, 文本), ...]，评分降序（同分保持原序）。"""
        return [(i, self.items[i]) for i, _ in self.matches]

    @property
    def selected_item(self) -> Optional[Tuple[int, str]]:
        """当前高亮项 (原下标, 文本)；无匹配时 None。"""
        if not self.matches:
            return None
        idx = min(self.selected, len(self.matches) - 1)
        i = self.matches[idx][0]
        return (i, self.items[i])

    def toggle_current(self) -> bool:
        """勾选/取消当前高亮项，返回是否有变化。"""
        cur = self.selected_item
        if cur is None:
            return False
        if cur[0] in self.checked:
            self.checked.discard(cur[0])
        else:
            self.checked.add(cur[0])
        return True


# ============================================================
# 交互主流程（Application + Layout + Float 居中浮层）
# ============================================================

def _interactive_select(title: str, items: List[str],
                        preview_fn, max_height: int,
                        multi: bool = False,
                        initial: Optional[List[int]] = None
                        ) -> Optional[Union[int, List[int]]]:
    """交互主流程：居中浮层 Application + Layout。

    `multi=True` 时：Space 勾选/取消，Enter 确认并返回**下标列表**（按原下标升序），
    Esc 取消返回 None。行首标记 `▶ `（高亮）/`  `，多选时多一个 `[x]`/`[ ]`。

    prompt_toolkit 缺失或交互异常时返回 None（降级，不阻塞、不崩溃）。
    """
    try:
        from prompt_toolkit.application import Application
        from prompt_toolkit.application.current import get_app
        from prompt_toolkit.buffer import Buffer
        from prompt_toolkit.filters import Condition
        from prompt_toolkit.key_binding import KeyBindings
        from prompt_toolkit.layout import (Float, FloatContainer,
                                           FormattedTextControl, HSplit, Layout,
                                           VSplit, Window)
        from prompt_toolkit.layout.controls import BufferControl
        from prompt_toolkit.styles import Style
        from prompt_toolkit.widgets.base import Frame
    except ImportError:
        return None

    state = _SelectorState(items, preview_fn, max_height, multi=multi,
                           initial=initial)

    # ---------- 过滤输入缓冲：每次输入变化重绘列表（输入即过滤） ----------
    def _on_text_changed(buf):
        state.query = buf.text
        state.selected = 0
        state.scroll = 0
        state.matches = filter_items(items, state.query)
        try:
            get_app().invalidate()   # 通知渲染器重绘列表窗格
        except Exception:
            pass                     # 缓冲在 app 未运行时被修改：无需重绘

    buf = Buffer(on_text_changed=_on_text_changed)

    # ---------- 布局尺寸：面板固定视口，列表在窗口内滚动 ----------
    def _layout_heights(rows: int) -> Tuple[int, int, int]:
        """返回 (列表行数, 预览行数, 面板总高)。终端太小时压缩列表。"""
        prev_h = 0
        if state.show_preview and state.preview_fn:
            prev_h = max(2, min(state.max_height // 2, 8))
        list_h = min(state.max_height, max(1, len(state.matches)))
        body = 1 + list_h + prev_h + 1            # 输入 + 列表 + 预览 + 底部提示
        panel_h = min(body + 2, max(6, rows - 4))  # 含上下边框
        list_h = max(1, (panel_h - 2) - 1 - prev_h - 1)  # 被截断时压缩列表
        return list_h, prev_h, panel_h

    # ---------- 列表窗格内容（命中高亮 + 选中标记 + 滚动窗口） ----------
    _NORM = {"sel.row": "class:sel.row", "sel.hl": "class:sel.hl"}
    _SEL = {"sel.row": "class:sel.row.sel", "sel.hl": "class:sel.hl.sel"}

    def _list_rows() -> List[List[Tuple[str, str]]]:
        """当前可见行（每行是一组 FormattedText 分段）。"""
        rows = state.matched_items
        if not rows:
            return [[("class:sel.empty", "  无匹配项（Esc 清空过滤词）")]]
        total = len(rows)
        sel = min(state.selected, total - 1)
        # 滚动窗口：让选中项始终可见（逐行滚动）
        if state.scroll > sel:
            state.scroll = sel
        elif state.scroll + state.max_height <= sel:
            state.scroll = sel - state.max_height + 1
        state.scroll = max(0, state.scroll)
        lines = []
        for k, (i, text) in enumerate(rows[state.scroll:state.scroll + state.max_height]):
            is_sel = state.scroll + k == sel
            # 纯函数 token（sel.row/sel.hl）→ 渲染用 class: 样式串
            segs = [(_SEL[t] if is_sel else _NORM[t], s)
                    for t, s in highlight_match(text, state.query)]
            mark = "▶ " if is_sel else "  "
            if state.multi:
                mark += "[x] " if i in state.checked else "[ ] "
            lines.append([("class:sel.row.sel" if is_sel else "class:sel.row",
                           mark), *segs])
        return lines

    def _list_formatted() -> List[Tuple[str, str]]:
        """展平为 FormattedText（行间插 \n 分隔）。"""
        out = []
        for row in _list_rows():
            if out:
                out.append(("", "\n"))
            out.extend(row)
        return out

    # ---------- 预览窗格 ----------
    def _preview_rows() -> List[Tuple[str, str]]:
        if not state.show_preview or not state.preview_fn:
            return []
        cur = state.selected_item
        if cur is None:
            return [("class:sel.preview", "  (无匹配，无预览)")]
        i, _ = cur
        try:
            text = state.preview_fn(i) or ""
        except Exception as e:
            text = f"(预览出错: {type(e).__name__}: {e})"
        lines = text.splitlines() or [""]
        cap = max(2, min(state.max_height // 2, 8))
        rows = [("class:sel.preview", f"  {l}") for l in lines[:cap]]
        if len(lines) > cap:
            rows.append(("class:sel.preview",
                         f"  … 共 {len(lines)} 行，仅显示前 {cap} 行"))
        return rows

    def _preview_formatted() -> List[Tuple[str, str]]:
        out = []
        for t, s in _preview_rows():
            if out:
                out.append(("", "\n"))
            out.append((t, s))
        return out

    # ---------- 底部提示条（滚动位置 + 按键提示） ----------
    def _footer_formatted() -> List[Tuple[str, str]]:
        total = len(state.matches)
        cur = 0 if not total else min(state.selected, total - 1) + 1
        bits = [f"{cur}/{total}", "↑↓/jk 选择", "输入过滤"]
        if state.multi:
            bits.append(f"Space 勾选({len(state.checked)})")
        bits += ["Enter 确认", "Esc 取消"]
        if state.preview_fn:
            bits.append("v 关闭预览" if state.show_preview else "v 预览")
        return [("class:sel.footer", "  " + "  ·  ".join(bits))]

    # ---------- 窗格与面板 ----------
    input_window = Window(BufferControl(buffer=buf, focusable=True), height=1,
                          style="class:sel.input")
    label_window = Window(FormattedTextControl("🔍 过滤 "), height=1,
                          style="class:sel.prompt", dont_extend_width=True)
    list_window = Window(
        FormattedTextControl(text=_list_formatted),
        height=lambda: _layout_heights(get_app().output.get_size().rows)[0],
        style="class:sel.list",
    )
    preview_window = Window(
        FormattedTextControl(text=_preview_formatted),
        height=lambda: _layout_heights(get_app().output.get_size().rows)[1],
        style="class:sel.preview",
    )
    footer_window = Window(FormattedTextControl(text=_footer_formatted), height=1,
                           style="class:sel.footer")

    body = HSplit([VSplit([label_window, input_window]),
                   list_window, preview_window, footer_window])
    frame = Frame(body=body, title=f" {title} ")
    panel = Float(content=frame)   # left/top/width/height 在 app 建立后计算
    root = FloatContainer(content=Window(FormattedTextControl("")),
                          floats=[panel])

    # ---------- 居中浮层定位 ----------
    def _compute_panel(size) -> Tuple[int, int]:
        """面板宽高：宽度随终端，高度随内容（含边框）。"""
        pw = max(50, min(90, size.columns - 6))
        _, _, ph = _layout_heights(size.rows)
        return pw, ph

    def _place_panel() -> None:
        """按当前终端尺寸重算面板位置（水平垂直居中）。"""
        size = get_app().output.get_size()
        pw, ph = _compute_panel(size)
        panel.width, panel.height = pw, ph
        panel.left = max(0, (size.columns - pw) // 2)
        panel.top = max(0, (size.rows - ph) // 2)
        get_app().invalidate()

    # ---------- 按键绑定 ----------
    kb = KeyBindings()

    # 仅当过滤框为空时 j/k/v 生效（避免与打字冲突：输入字母即过滤）
    browse_mode = Condition(lambda: get_app().current_buffer.text == "")

    @kb.add("enter")
    def _confirm(event):
        if state.multi:
            # 多选：确认时把勾选集合交出去（允许空手确认，交由调用方决定算不算取消
            # —— "什么都没选"和"取消"是两个不同的动作，浮层不替调用方合并它们）
            state.result_multi = sorted(state.checked)
            event.app.exit()
            return
        cur = state.selected_item
        if cur is not None:
            state.result = cur[0]
            event.app.exit()

    @kb.add("space")
    def _toggle(event):
        # 多选才吃 Space；单选模式下 Space 仍按普通字符走过滤输入
        if state.multi and state.toggle_current():
            event.app.invalidate()

    @kb.add("escape")
    def _escape(event):
        # 有过滤词：先清空过滤回到全量列表；无过滤词：取消
        if state.query:
            event.app.current_buffer.text = ""   # 触发 on_text_changed 重绘
        else:
            event.app.exit()

    @kb.add("c-c")
    def _cancel(event):
        event.app.exit()

    @kb.add("down")
    @kb.add("c-n")
    def _next(event):
        if state.matches:
            state.selected = min(state.selected + 1, len(state.matches) - 1)
            event.app.invalidate()

    @kb.add("up")
    @kb.add("c-p")
    def _prev(event):
        if state.matches:
            state.selected = max(state.selected - 1, 0)
            event.app.invalidate()

    @kb.add("pagedown")
    def _page_down(event):
        if state.matches:
            state.selected = min(state.selected + state.max_height,
                                 len(state.matches) - 1)
            event.app.invalidate()

    @kb.add("pageup")
    def _page_up(event):
        if state.matches:
            state.selected = max(state.selected - state.max_height, 0)
            event.app.invalidate()

    @kb.add("j", filter=browse_mode)
    def _j_next(event):
        _next(event)

    @kb.add("k", filter=browse_mode)
    def _k_prev(event):
        _prev(event)

    @kb.add("v", filter=browse_mode)
    def _toggle_preview(event):
        if state.preview_fn:
            state.show_preview = not state.show_preview
            _place_panel()   # 预览区出现/消失 → 重算面板高度并居中

    # ---------- 应用与运行 ----------
    # 外壳配色来自色板：类名（frame.* / sel.*）与这里引用的一一对应，
    # dark/light 下与改造前逐字相同，选雾蓝时整块跟着走。
    style = Style.from_dict(ace_theme.ptk_styles())

    app = Application(
        layout=Layout(root, focused_element=input_window),
        style=style,
        key_bindings=kb,
        erase_when_done=True,                  # 结束后擦除浮层，露出下层屏幕
        enable_page_navigation_bindings=False,  # PageUp/PageDown 走自绘滚动
    )

    # 首次定位面板（居中）；随后 v 切换预览时由 _place_panel 重算
    size0 = app.output.get_size()
    pw0, ph0 = _compute_panel(size0)
    panel.width, panel.height = pw0, ph0
    panel.left = max(0, (size0.columns - pw0) // 2)
    panel.top = max(0, (size0.rows - ph0) // 2)

    try:
        app.run()
    except (Exception, KeyboardInterrupt, EOFError):
        return None          # 任何异常都降级为取消，绝不拖垮 REPL
    return state.result_multi if state.multi else state.result


# ============================================================
# 入口
# ============================================================

def run_selector(title: str, items: List[str],
                 preview_fn: Optional[Callable[[int], str]] = None,
                 max_height: int = 12) -> Optional[int]:
    """交互式搜索选择器。返回选中项 index；用户取消（Esc/Ctrl+C）返回 None。

    参数:
      title:      顶部标题（如 "选择模型"）
      items:      选项列表（纯文本，可含描述，如 "deepseek-v4-flash  DeepSeek 官方"）
      preview_fn: 可选；选中项时显示预览，接收 index（原下标）返回多行文本
      max_height: 列表可见行数上限（默认 12）

    行为:
      - 非 TTY（sys.stdin / sys.stdout 非 isatty）：不阻塞，直接返回
        第一个匹配（空过滤 = 全部项 → 下标 0）；无选项返回 None
      - prompt_toolkit 缺失或交互异常：返回 None（可选依赖降级）
    """
    # 无选项：无可选择，直接返回 None（不进交互，也不阻塞）
    if not items:
        return None
    # 非 TTY：不阻塞，直接返回首个（最佳）匹配
    try:
        interactive = bool(sys.stdin.isatty() and sys.stdout.isatty())
    except Exception:
        interactive = False
    if not interactive:
        return filter_items(items, "")[0][0]
    ridx = _interactive_select(title, items, preview_fn, max_height)
    return ridx if isinstance(ridx, int) else None


def run_multiselect(title: str, items: List[str],
                    initial: Optional[List[int]] = None,
                    preview_fn: Optional[Callable[[int], str]] = None,
                    max_height: int = 12) -> Optional[List[int]]:
    """交互式**多选**（同一个浮层，多一个 Space 勾选）。返回下标列表；取消返回 None。

    参数:
      title:    顶部标题
      items:    选项列表
      initial:  预先勾选的下标（"当前生效的规则"就该是勾好的，而不是让你从头再点一遍）
      preview_fn / max_height: 同 run_selector

    行为:
      - Enter 确认：返回勾选下标（**升序**；空列表 = 用户什么都没勾，由调用方决定
        算不算取消 —— 浮层不替调用方合并"没选"与"取消"）
      - Esc / Ctrl+C / prompt_toolkit 缺失 / 非 TTY：返回 None（没有交互界面时
        不假装用户勾过东西）
    """
    if not items:
        return None
    try:
        interactive = bool(sys.stdin.isatty() and sys.stdout.isatty())
    except Exception:
        interactive = False
    if not interactive:
        return None
    picked = _interactive_select(title, items, preview_fn, max_height,
                                 multi=True, initial=initial)
    if picked is None:
        return None
    return [int(i) for i in picked] if isinstance(picked, list) else None
