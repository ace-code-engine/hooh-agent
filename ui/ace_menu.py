#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_menu —— 补全菜单的**模型**：候选从哪来、怎么排、怎么画

为什么要把菜单从"补全器"里拆出来：此前菜单只活在 prompt_toolkit 的 `Completer` 里 ——
装了依赖才存在，没装就只剩一个光秃秃的 `input()`（用户看到的就是"菜单没安装、不好用"）。
把"有哪些候选、当前选中哪个、回车该填什么"抽成纯数据之后：

- **两条渲染路径共用同一份候选**：prompt_toolkit 的浮层菜单，和没有依赖时的自绘菜单
  （`ui/ace_prompt.py`）—— 不会出现"装没装依赖，菜单内容还不一样"；
- 菜单行为可以被断言（候选项、排序、替换区间、回车语义都是纯函数返回值）；
- 加一类候选（斜杠命令 / @ 提及 / 命令参数）只在这里加一处。

菜单打开规则（产品口径，也是本模块的契约）：
- 输入以 `/` 开头 → 命令菜单；以 `@` 开头 → 提及菜单；命令后跟空格 → **参数菜单**；
- 候选按 `ui/ace_selector.filter_items` 的子序列模糊匹配排序（与选择器同一套评分）；
- 回车语义：**候选与已输入内容不同 → 先补全（不发送）**；已经一致 → 直接发送。
  这一条是"菜单不碍事"的关键：否则用户打完 `/help` 还要多按一次回车才能发。
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from ui.ace_text import display_width

__all__ = ["MenuItem", "MenuState", "command_items", "mention_items",
           "argument_items", "build_menu", "render_menu", "menu_hint",
           "window_bounds", "desc_column", "MENU_GAP",
           "MENTION_TRIGGERS", "ARGUMENT_HINTS"]

#: 标签与说明之间至少留几个空格（也是说明列的基准：窗口内最宽标签 + 它）。
#: 前后端同一个值 —— `test/shell-parity.test.ts` 的 R-6 对拍。
MENU_GAP = 2

# `@` 提及的五类（顺序 = 菜单里的展示顺序）
MENTION_TRIGGERS: Tuple[Tuple[str, str], ...] = (
    ("lang", "at_complete_lang"), ("skill", "at_complete_skill"),
    ("file", "at_complete_file"), ("folder", "at_complete_folder"),
    ("session", "at_complete_session"),
)

# 命令的参数提示：命令 → [(参数, 说明 i18n 键)]。有提示的命令输入空格后即弹参数菜单，
# 用户不必去翻 /help —— "下一步能填什么"应该在光标旁边，而不是在另一屏。
ARGUMENT_HINTS: Dict[str, Tuple[Tuple[str, str], ...]] = {
    "/permission": (("readonly", "arg_perm_readonly"), ("write", "arg_perm_write"),
                    ("full", "arg_perm_full"), ("rules", "arg_perm_rules")),
    "/sandbox": (("off", "arg_sandbox_off"), ("job", "arg_sandbox_job"),
                 ("docker", "arg_sandbox_docker")),
    "/net": (("on", "arg_net_on"), ("off", "arg_net_off")),
    "/thinking": (("on", "arg_on"), ("off", "arg_off")),
    "/style": (("default", "style_default"), ("concise", "style_concise"),
               ("explanatory", "style_explanatory"), ("strict", "style_strict")),
    "/fullscreen": (("on", "arg_on"), ("off", "arg_off")),
    # 有固定取值的命令都在这张表里 —— 用户不必去翻 /help 或背 `readonly/write/full`。
    # 加一条的前提只有一个：这条命令的参数**确实**是闭集（开集参数如 /search 不加，
    # 加了会让光标旁边弹出一个"看起来能选、其实还得自己写"的假菜单）。
    "/lang": (("zh", "arg_lang_zh"), ("en", "arg_lang_en"), ("ja", "arg_lang_ja")),
    "/effort": (("auto", "effort_auto"), ("low", "effort_low"), ("medium", "effort_medium"),
                ("high", "effort_high"), ("max", "effort_max")),
    "/vim": (("on", "arg_on"), ("off", "arg_off")),
    "/mock": (("on", "arg_on"), ("off", "arg_off")),
    "/expandall": (("on", "arg_on"), ("off", "arg_off")),
    "/goal": (("resume", "arg_goal_resume"), ("pause", "arg_goal_pause"),
              ("complete", "arg_goal_complete")),
    "/audit": (("stats", "arg_audit_stats"), ("boundary", "arg_audit_boundary")),
    "/rules": (("add", "arg_rules_add"), ("remove", "arg_rules_remove"),
               ("check", "arg_rules_check"), ("accept", "arg_rules_accept")),
    "/todo": (("add", "arg_todo_add"), ("start", "arg_todo_start"),
              ("done", "arg_todo_done"), ("remove", "arg_todo_remove"),
              ("clear", "arg_todo_clear")),
    "/queue": (("clear", "arg_clear"),),
    "/stash": (("pop", "arg_stash_pop"), ("clear", "arg_clear")),
    "/tasks": (),
}


class MenuItem:
    """一个候选：`label` 给人看，`insert` 是回车/Tab 后真正填进输入框的文本。"""

    def __init__(self, label: str, insert: str = "", desc: str = "",
                 group: str = "", kind: str = "command") -> None:
        self.label = str(label)
        self.insert = str(insert or label)
        self.desc = str(desc)
        self.group = str(group)
        self.kind = str(kind)

    def line(self, mark: str = "  ", desc_col: int = 0) -> str:
        """渲染一行：`mark + label (+ 对齐到 `desc_col` 的说明)`。

        `desc_col` = 说明列的起始列（`0` = 不对齐，与旧行为一致）。
        **这个参数此前收了却从来不用** —— 于是补全菜单从不做列对齐，而前端那份做了两列，
        同一份候选在两个外壳里排得不一样。口径由 `desc_column()` 给。
        """
        text = f"{mark}{self.label}"
        if self.desc:
            gap = max(MENU_GAP, int(desc_col or 0) - display_width(text))
            text += (" " * gap) + self.desc
        return text

    def __repr__(self) -> str:
        return f"MenuItem({self.label!r} → {self.insert!r}, {self.group!r})"


class MenuState:
    """菜单状态：候选列表 + 当前选中 + 是否打开（纯数据，不含 I/O）。"""

    def __init__(self, items: Optional[Sequence[MenuItem]] = None,
                 selected: int = 0, open_: bool = False,
                 kind: str = "", query: str = "",
                 span: Tuple[int, int] = (0, 0)) -> None:
        self.items: List[MenuItem] = list(items or [])
        self.selected = max(0, int(selected))
        self.open = bool(open_) and bool(self.items)
        self.kind = str(kind)
        self.query = str(query)
        self.span: Tuple[int, int] = (int(span[0]), int(span[1]))

    @property
    def current(self) -> Optional[MenuItem]:
        if not self.items:
            return None
        return self.items[min(self.selected, len(self.items) - 1)]

    def move(self, delta: int) -> "MenuState":
        if not self.items:
            return self
        n = len(self.items)
        self.selected = (self.selected + delta) % n      # 循环：到底再按一下回到开头
        return self

    def accepted_text(self, text: str) -> str:
        """把当前候选填进 `text`（替换 `span` 区间）——回车/Tab 的语义就在这一处。"""
        cur = self.current
        if cur is None:
            return text
        start, end = self.span
        return text[:start] + cur.insert + text[end:]

    def __repr__(self) -> str:
        return (f"MenuState(open={self.open}, kind={self.kind!r}, "
                f"n={len(self.items)}, sel={self.selected})")


# ============================================================
# 候选来源
# ============================================================

def command_items(commands: Dict[str, str],
                  custom: Optional[Sequence[Tuple[str, str]]] = None,
                  translate: Optional[Callable[[str], str]] = None,
                  group_of: Optional[Callable[[str], str]] = None
                  ) -> List[MenuItem]:
    """斜杠命令候选：内置（带分组）+ 自定义命令（单独一组放最后）。"""
    tr = translate or (lambda k: k)
    out: List[MenuItem] = []
    for name, desc_key in (commands or {}).items():
        # **有取值表的命令，补全时带上那个空格** —— 于是"选了 `/todo`，下一层选项立刻出来"。
        # 不带空格的后果（实测）：命令名一打全，菜单按"不弹就是关"关闭，第二层**永远不出现**，
        # 用户只能自己猜"后面还有没有东西"。没有取值表的命令不带空格：那样回车直接发送。
        _ins = f"{name} " if ARGUMENT_HINTS.get(name) else name
        out.append(MenuItem(name, _ins, tr(desc_key),
                            tr(group_of(name)) if group_of else "", "command"))
    for name, desc in (custom or []):
        out.append(MenuItem(str(name), str(name), str(desc), tr("group_custom"),
                            "custom"))
    return out


def mention_items(kind: str = "", translate: Optional[Callable[[str], str]] = None,
                  values: Optional[Sequence[Any]] = None) -> List[MenuItem]:
    """`@` 提及候选：kind 为空时给五类触发词；给定 kind 时给该类的取值（可选）。

    取值可以是**字符串**（标签即插入值，如 `@lang` 的 `zh`），也可以是
    **`(标签, 插入值)` 二元组** —— `@session` 需要这个：菜单里要显示
    「1. 缓存穿透 · 2 轮」让人认得出是哪次，但插进输入框的必须是 `1`（编号）。
    只给标签的话补全后得到一句人话，模型看不懂；只给编号则用户不知道选的是哪次。
    """
    tr = translate or (lambda k: k)
    if not kind:
        return [MenuItem(f"@{k}", f"@{k} ", tr(desc_key), tr("group_extend"),
                         "mention")
                for k, desc_key in MENTION_TRIGGERS]
    out: List[MenuItem] = []
    for v in (values or []):
        if isinstance(v, (tuple, list)) and len(v) == 2:
            label, insert = str(v[0]), str(v[1])
        else:
            label = insert = str(v)
        out.append(MenuItem(label, f"{insert} ", "", tr("group_extend"), "mention"))
    return out


def argument_items(cmd: str, translate: Optional[Callable[[str], str]] = None
                   ) -> List[MenuItem]:
    """命令的参数候选（`/permission ` 之后弹的就是它）。"""
    tr = translate or (lambda k: k)
    hints = ARGUMENT_HINTS.get(str(cmd or ""))
    if not hints:
        return []
    return [MenuItem(str(a), str(a) + " ", tr(desc_key), tr(cmd), "argument")
            for a, desc_key in hints]


def _token_under_cursor(text: str, cursor: int) -> Tuple[str, int, int]:
    """光标处的"词"：返回 `(token, start, end)`，以空白为界（`/`、`@` 也算词首）。"""
    t = str(text or "")
    cur = max(0, min(int(cursor), len(t)))
    start = cur
    while start > 0 and not t[start - 1].isspace():
        start -= 1
    end = cur
    while end < len(t) and not t[end].isspace():
        end += 1
    return t[start:end], start, end


def build_menu(text: str, cursor: int, commands: Dict[str, str],
               custom: Optional[Sequence[Tuple[str, str]]] = None,
               translate: Optional[Callable[[str], str]] = None,
               group_of: Optional[Callable[[str], str]] = None,
               mention_values: Optional[Dict[str, Sequence[str]]] = None,
               limit: int = 12) -> MenuState:
    """输入 → 菜单状态（**唯一**决定"此刻该弹什么"的地方）。

    四种情形，优先级从高到低：
      1. 当前词以 `@` 开头 → 提及触发词菜单（`@`、`@la`…）；
      2. 行首词是 `@kind` 且该 kind 有取值 → 提及取值菜单（`@lang ` → zh/en/ja）；
      3. 当前词以 `/` 开头且还没打全 → 命令菜单；
      4. 行首是有参数提示的命令、且已经过了空格 → 参数菜单（`/permission r`）；
    其余（普通文本、命令已打全）→ **关闭**的菜单：不弹就是关，用户不必按 Esc 关它，
    回车也就直接发送（"打完命令回车发出去"这个直觉必须成立）。
    """
    tr = translate or (lambda k: k)
    t = str(text or "")
    cur = max(0, min(int(cursor), len(t)))
    token, start, end = _token_under_cursor(t, cur)
    before = t[:cur]
    first = before.strip().split(" ", 1)[0] if before.strip() else ""

    # ① `@` 触发词
    if token.startswith("@"):
        return _ranked(mention_items("", tr), token[1:], start, end, tr,
                       kind="@", limit=limit)
    # ② `@kind ` 取值（如 @lang → zh/en/ja）
    if first.startswith("@") and first[1:] in (mention_values or {}):
        kind = first[1:]
        known = set((mention_values or {}).get(kind, []))
        used = set(before.split()[1:])
        if used & known:
            return MenuState()          # 取值已经选好：菜单让位，回车直接发送
        values = [v for v in (mention_values or {}).get(kind, []) if v not in used]
        if values:
            return _ranked(mention_items(kind, tr, values), token, start, end, tr,
                           kind=f"@{kind}", limit=limit)
    # ③ 命令菜单
    if token.startswith("/"):
        items = command_items(commands, custom, tr, group_of)
        exact = [it for it in items if it.label == token]
        if exact and len(token) > 1:
            # 命令名已打全：不再拿菜单挡着回车（把回车让给"直接发送"）
            return MenuState(exact, 0, False, "command", token, (start, end))
        return _ranked(items, token, start, end, tr, kind="command", limit=limit)
    # ④ 参数菜单（命令 + 空格）
    if first.startswith("/") and first in ARGUMENT_HINTS and " " in before:
        known = {a for a, _k in ARGUMENT_HINTS[first]}
        used = set(before.split()[1:])
        if used & known:
            # 参数已经选好（`/permission readonly `）：菜单让位，回车直接发送。
            # 否则菜单会一直"再补一个参数"，用户永远按不出回车（探针里踩到过）。
            return MenuState()
        args = [it for it in argument_items(first, tr) if it.label not in used]
        if args:
            return _ranked(args, token, start, end, tr, kind=f"arg:{first}",
                           limit=limit)
    return MenuState()


def _ranked(items: Sequence[MenuItem], query: str, start: int, end: int,
            translate: Callable[[str], str], kind: str,
            limit: int = 12) -> MenuState:
    """模糊排序（复用选择器的子序列评分，与选择器同一套手感）。"""
    items = list(items)
    q = str(query or "").strip()
    if q:
        try:
            from ui.ace_selector import filter_items
            labels = [it.label for it in items]
            order = [i for i, _s in filter_items(labels, q)]
            items = [items[i] for i in order]
        except ImportError:      # 极端情况下退化为前缀匹配
            items = [it for it in items if it.label.startswith(q)]
    # 完全一致的候选排最前（用户已经打全了，回车应该直接发送而不是补全）
    exact = [it for it in items if it.label == q]
    rest = [it for it in items if it.label != q]
    items = exact + rest
    return MenuState(items[:max(1, int(limit))], 0, True, kind, q, (start, end))


# ============================================================
# 渲染
# ============================================================

def desc_column(labels: Sequence[str]) -> int:
    """说明列的起始列（**相对标签起点**）：窗口内最宽标签 + `MENU_GAP`。

    为什么取**窗口内**而不是全表：滚到底部时全表最长的那个已经滚出去了，
    照它对齐会在左边留一大片空白（前端那份注释里写的就是这条理由）。

    宽度按**显示列**算（`display_width`），不按码点 —— 中文说明的候选一旦混进来，
    按 `.length` 对齐必然歪。
    """
    return max((display_width(str(x)) for x in labels), default=0) + MENU_GAP


def window_bounds(total: int, selected: int, rows: int) -> Tuple[int, int]:
    """可见窗口 `(start, end)`：**选中项永远在窗口里**，并且尽量让它居中。

    这一条是"按 ↓ 菜单不动"的根因修复：原来只渲染前 N 条，选中项走到第 N+1 条之后
    光标就跑到看不见的地方去了 —— 用户看到的是"我按了键，什么都没发生"。

    窗口规则（与分页器一致）：
    - 选中项在窗口内时尽量不移动窗口（滚动要"黏"，否则每按一下整屏都在跳）；
    - 只在选中项越过上/下边界时把窗口挪一格；
    - 到顶/到底时不循环（列表有头有尾，转圈会让人分不清自己走到哪了）。
    """
    rows = max(1, int(rows))
    total = max(0, int(total))
    if total <= rows:
        return 0, total
    sel = max(0, min(int(selected), total - 1))
    if sel < rows:
        return 0, rows                     # 第一屏：窗口不动（越靠上越不该跳）
    start = max(0, min(sel - rows + 1, total - rows))
    return start, start + rows


def render_menu(state: MenuState, width: int = 80, max_rows: int = 8,
                styler: Optional[Callable[[str, str], str]] = None,
                translate: Optional[Callable[[str], str]] = None) -> List[str]:
    """菜单 → 待打印行（纯文本；带分组标题、滚动窗口与上下省略说明）。

    渲染的是**窗口**（`window_bounds`），所以 `↓` 到底会滚动，而不是让光标消失。
    `styler(kind, text)` 可注入（测试传 no-op 就能断言纯文本）。
    """
    st = styler or (lambda _k, x: x)
    tr = translate or (lambda k: k)
    if not state.items:
        return []
    rows: List[str] = []
    sel = min(state.selected, len(state.items) - 1)
    start, end = window_bounds(len(state.items), sel, max(1, int(max_rows)))
    shown = state.items[start:end]
    _col = desc_column([it.label for it in shown])
    if start > 0:
        rows.append(st("dim", tr("menu_more_above").replace("{n}", str(start))))
    last_group = None
    for offset, item in enumerate(shown):
        i = start + offset
        if item.group and item.group != last_group:
            # 分组标题前缀 `── ` 与 `ui/ace_panel.section_title` 同款（那是本仓的**设计版**
            # 分组标题，主页/面板都用它）；**右侧是否补满属于各外壳的排版**，不在这里定。
            rows.append(st("dim", f"  ── {item.group}"))
            last_group = item.group
        # 选中标记：老终端（cp936）印不出 ▶，降级成 `>`（见 core/ace_io.py）
        from core import ace_io as _io
        mark = st("cyan", _io.glyph("▶") + " ") if i == sel else "  "
        line = item.line("", _col)
        if i == sel:
            line = st("bold", line)
        rows.append(f"{mark}{line}")
    hidden = len(state.items) - end
    if hidden > 0:
        rows.append(st("dim", tr("menu_more").replace("{n}", str(hidden))))
    # 提示行**永远最后一行、永远在窗口里**：它是"这里怎么操作"的唯一说明，
    # 被截掉等于把说明书撕了一半（用户报的"提示看不到尽头"就是这个）。
    rows.append(st("dim", menu_hint(state, tr)))
    return rows


def menu_hint(state: MenuState, translate: Optional[Callable[[str], str]] = None
              ) -> str:
    """一行按键提示（菜单开着时显示在菜单底部）。"""
    tr = translate or (lambda k: k)
    if state.kind.startswith("arg:"):
        return tr("menu_hint_arg")
    if state.kind == "command":
        return tr("menu_hint_command")
    return tr("menu_hint_mention")


def accepts_on_enter(state: MenuState, text: str) -> bool:
    """回车该"补全"还是"发送"（产品口径的唯一判定点）。

    候选与已输入内容不同 → 补全；已经一致 → 发送。这样"打完命令直接回车发出去"
    与"打到一半回车补齐"两个直觉都成立，不必记两条规则。
    """
    cur = state.current
    if cur is None:
        return False
    _token, _s, _e = _token_under_cursor(text, len(text))
    return state.accepted_text(text) != text
