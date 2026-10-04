"""边角零件 —— **小图标 / 分隔线 / 进度条 / 快捷键提示 / byline** 的唯一一份实现。

出处（照抄语义与观感，不抄实现）：
  - Claude Code `components/design-system/StatusIcon.tsx`
    → 六态 `success / error / warning / info / pending / loading` = 图标 + 颜色；
    `Divider.tsx` → **整宽**细线、可把标题**居中嵌进线里**（`──── 标题 ────`）；
    `ProgressBar.tsx` → 用**八分之一块** `▏▎▍▌▋▊▉█` 画进度（比整格跳一下精致一档）；
    `KeyboardShortcutHint.tsx` → 一律 `key to action`（可选括号/加粗）；`Byline.tsx` → 元数据用 ` · ` 连。
  - pi `keybinding-hints.ts` → 组合键 `ctrl+shift+p`、多键 `↑/↓`、macOS 上 `alt` 显示成 `option`。

为什么单拎一层：这些零件此前**散在各渲染器里各写一遍**（工具卡一套 `status_mark`、
底栏一套分隔、markdown 又是 `"─" * 20`），口径一漂就对不上 —— 典型症状是"同一件事三处长三个样"。
集中一处、由 `test_all` 守着，才不会"改好了一处、另外三处还是老样子"。
"""

from __future__ import annotations

from typing import Iterable, List, Tuple

from ui.ace_text import display_width, truncate_width

__all__ = ["STATUS_ICONS", "status_icon", "divider", "progress_bar",
           "key_hint", "byline", "format_key", "BLOCKS",
           "BLOCK_FIGURE", "block_figure", "pose_for_effort",
           "THINK_MARK", "think_label", "demo"]

#: 状态 → (图标, 语义色 token)。token 名与 `ui/ace_theme.py` 一致（那边是唯一真相源）。
#: `pending` 与 `loading` 刻意**不同形**：前者是"还没轮到它"，后者是"正在跑"。
STATUS_ICONS: dict = {
    "success": ("✓", "success"),
    "error": ("✗", "error"),
    "warning": ("⚠", "warn"),
    "info": ("ℹ", "info"),
    "pending": ("○", "dim"),
    "loading": ("◌", "tool_pending"),
}

#: 同义词 → 六态。调用方历史上用的词五花八门（`ok` / `done` / `FAIL` / `running`…），
#: 集中做一次归一，免得每个调用点自己 `if`。
_ALIASES: dict = {
    "ok": "success", "done": "success", "pass": "success", "passed": "success",
    "✓": "success", "v": "success",
    "fail": "error", "failed": "error", "err": "error", "400": "error",
    "403": "error", "404": "error", "format_error": "error", "tool_banned": "error",
    "guard_violation": "error", "bait_triggered": "error", "ast_failed": "error",
    "warn": "warning", "500": "warning", "502": "warning", "503": "warning",
    "note": "info", "notice": "info",
    "todo": "pending", "queued": "pending", "wait": "pending", "waiting": "pending",
    "run": "loading", "running": "loading", "working": "loading", "busy": "loading",
    "pending": "pending", "loading": "loading",
    "success": "success", "error": "error", "warning": "warning", "info": "info",
}


def status_icon(state: str) -> Tuple[str, str]:
    """状态词 → `(图标, 颜色 token)`。认不出的一律当 `pending`（不猜"成功"）。"""
    key = str(state or "").strip().lower()
    return STATUS_ICONS[_ALIASES.get(key, "pending" if key else "pending")]


def divider(width: int, *, char: str = "─", title: str = "",
            pad: int = 0) -> str:
    """**整宽**细线；给了 `title` 就把它居中嵌进线里（CC `Divider` 的做法）。

    与"随手 `char * 20`"的区别：宽度跟着终端走，窄终端不溢出、宽终端不留半截；
    标题居中时两侧留**对称**的空格，看起来才像一条"分段线"而不是"线 + 字"。

    **一律按显示宽度算**（`display_width`），不是 `len()`：`" 状态 "` 的码点数是 4、
    显示宽度是 6 —— 用码点数居中，中文标题的分隔线会**左右不对称**（实测踩过）。
    """
    w = max(1, int(width) - max(0, int(pad)))
    if not title:
        return char * w
    label = f" {str(title).strip()} "
    lw = display_width(label)
    if lw >= w:                              # 标题比线还长：只留标题，别画负长度
        return truncate_width(str(title).strip(), w)
    left = (w - lw) // 2
    right = w - lw - left
    return char * left + label + char * right


#: 八分之一块（CC `ProgressBar.BLOCKS`）——让进度条"动一小格"而不是跳一整格。
BLOCKS = (" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█")


def progress_bar(ratio: float, width: int, *, empty: str = "─") -> str:
    """按 `ratio∈[0,1]` 画进度条，宽 `width` 格。

    子格用八分之一块补，所以"8 格宽画 1/16"也能看出区别（整格方案会一直显示 0）。
    """
    w = max(1, int(width))
    try:
        r = float(ratio)
    except (TypeError, ValueError):
        r = 0.0
    r = 0.0 if r < 0 else (1.0 if r > 1 else r)
    filled = r * w
    whole = int(filled)
    rem = filled - whole
    out: List[str] = ["█"] * whole
    if whole < w:
        idx = int(rem * 8)                   # 0..7 → 空格 / ▏…▉
        if idx > 0:
            out.append(BLOCKS[idx])
            out.append(empty * (w - whole - 1))
        else:
            # 余数正好是 0：别再塞一个空子格（那会白扔一格，半满看起来像 4/8 而不是 4/8 满）
            out.append(empty * (w - whole))
    return "".join(out)[:w]


def format_key(key: str, *, darwin: bool = False) -> str:
    """组合键写法归一：`ctrl+shift+p`；`↑/↓` 这种"或"用 `/` 连（pi 的做法）。

    **不改大小写**：键名怎么写就怎么显示（`Shift+Tab` 与 `shift+tab` 是两个观感）。
    唯一会动的是 macOS 上的 `alt → option`（pi 同款，苹果键盘上印的是 Option）。
    """
    parts = []
    for alt in str(key or "").split("/"):
        segs = []
        for part in alt.split("+"):
            p = part.strip()
            if darwin and p.lower() == "alt":
                p = "option"
            segs.append(p)
        parts.append("+".join(segs))
    return "/".join(parts)


def key_hint(key: str, action: str, *, darwin: bool = False) -> str:
    """`key to action` —— 语序交给 i18n（中文不写 "to"，英文写）。

    为什么走 i18n 而不是拼字符串：`ctrl+o 展开` 与 `ctrl+o to expand` 的差别是**语序**，
    不是词表 —— 硬拼必然在某种语言下别扭。

    占位符叫 `{shortcut}` **不叫 `{key}`**：`ui.i18n.t()` 的第一个形参就叫 `key`，
    同名会直接 `TypeError: t() got multiple values for argument 'key'`（实测踩过）。
    """
    from ui.i18n import t  # 局部导入：本模块要被 --preview 等轻量入口 import
    return t("key_hint", shortcut=format_key(key, darwin=darwin), action=action)


def byline(items: Iterable[str], *, sep: str = " · ") -> str:
    """元数据一行连起来（CC `Byline`）：空项自动丢，分隔符不会出现在首尾。"""
    return sep.join(str(x) for x in items if str(x or "").strip())


#: 方块小人（照 Claude Code `LogoV2/Clawd.tsx` 的做法）：**2 行 × 9 列**的块字符网格。
#: 三条纪律照抄它的：
#:   1. **按段拆**（左 / 眼 / 右），所以只换眼睛和手臂就是新姿势，躯干那几段不动；
#:   2. **所有姿势同宽同高**（9×2）—— 换姿势不能让周围布局跳一下；
#:   3. 用**四分块**字符拼（`▐▛▜▌▝▜▛▘▗▟▙▖`），比整块字符能拼出圆角与斜线。
#: 姿势与思考强度挂钩（`low` 蹲、`max` 举臂）：**看小人的姿势就知道它多用力**，
#: 比再写一个词省一行的注意力。
BLOCK_FIGURE = {
    "default": (" ▐▛███▜▌ ", " ▝▜   ▛▘ "),
    "crouch":  ("  ▐▛█▜▌  ", " ▗▟    ▙▖"),
    "arms-up": ("▗▟▐▛█▜▌▙▖", "  ▝▜ ▛▘  "),
}

#: 思考标记（照 Claude Code `AssistantThinkingMessage` 的 `∴ Thinking` 标签）。
THINK_MARK = "∴"


def block_figure(pose: str = "default") -> Tuple[str, str]:
    """方块小人的两行。认不出的姿势回退 `default`（不返回空行）。"""
    return BLOCK_FIGURE.get(str(pose or "").lower(), BLOCK_FIGURE["default"])


def pose_for_effort(level: str) -> str:
    """思考强度 → 姿势：`low` 蹲着、`high`/`max` 举臂、其余站着。"""
    lv = str(level or "").strip().lower()
    if lv == "low":
        return "crouch"
    if lv in ("high", "max"):
        return "arms-up"
    return "default"


def think_label(effort_level: str = "", text: str = "") -> str:
    """思考行的标签：`∴ 思考中 ◉`（标记 + 文案 + 强度符号）。

    为什么不做成"带秒数"的整行（原先那个 `thinking_line`）：**秒数由 spinner 自己算**
    （它每 0.12s 重绘一次），这里再拼一遍就是两个时间源，迟早对不上。
    只出"标记 + 文案 + 强度"，谁渲染谁负责加计时。原形状没有任何调用方 ——
    那正是「猜出来的接口」的下场，所以这里直接换掉而不是留着。
    """
    from core import ace_effort as _ef
    parts = [THINK_MARK]
    if text:
        parts.append(str(text))
    if effort_level:
        parts.append(_ef.symbol(effort_level))
    return " ".join(parts)


def demo() -> None:
    """自检：小零件的边界（宽度、居中、子格、归一）。"""
    assert divider(8) == "─" * 8
    assert divider(0) == "─"                      # 宽度非法也不返回空串
    d = divider(11, title="标题")
    assert display_width(d) == 11 and "标题" in d, d      # 按**显示宽度**整宽（中文占两列）
    assert display_width(divider(12, title="状态")) == 12      # 中文按显示宽度居中
    assert display_width(divider(3, title="很长很长的标题")) <= 3
    assert progress_bar(0, 4) == "────", progress_bar(0, 4)
    assert progress_bar(1, 4) == "████"
    assert progress_bar(0.5, 8).startswith("████")
    assert len(progress_bar(0.3, 7)) == 7
    assert progress_bar(-1, 4) == progress_bar(0, 4) and progress_bar(9, 4) == progress_bar(1, 4)
    assert status_icon("ok") == ("✓", "success")
    assert status_icon("running") == ("◌", "tool_pending")
    assert status_icon("谁知道呢") == ("○", "dim")      # 认不出 → pending，不猜成功
    assert format_key("alt+shift+P", darwin=True) == "option+shift+P"
    assert format_key("alt+P") == "alt+P" and format_key("↑/↓") == "↑/↓"
    assert byline(["a", "", "b"]) == "a · b"
    # 方块小人：所有姿势**同宽同高**（换姿势不许让布局跳 —— CC `Clawd` 的硬要求）
    _figs = [block_figure(p) for p in BLOCK_FIGURE]
    assert all(len(f) == 2 for f in _figs), "每个姿势都必须是两行"
    assert len({display_width(r) for f in _figs for r in f}) == 1, "所有姿势必须同宽"
    assert block_figure("不存在的姿势") == BLOCK_FIGURE["default"]
    assert pose_for_effort("low") == "crouch" and pose_for_effort("max") == "arms-up"
    assert pose_for_effort("auto") == "default"
    assert think_label("high", "思考中") == "∴ 思考中 ◉"
    assert think_label().startswith("∴")
    assert think_label("", "思考中") == "∴ 思考中"


if __name__ == "__main__":       # pragma: no cover - 手动跑：python -m ui.ace_widgets
    demo()
    print("ace_widgets demo ok")
    print(divider(60, title="状态"))
    print(progress_bar(0.62, 24), "62%")
