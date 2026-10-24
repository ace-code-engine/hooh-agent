#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_spinner —— 等待指示器状态机：**扫光速度即语义**，卡住会被颜色说出来

为什么值得单独做一层：此前等待行只有一个会转的点号 + 秒数，于是"在等网络"和"模型在
长思考"长得一模一样，用户只能靠读文字区分；而"卡住了"更是完全看不出来（转得一样快）。
参照的交互口径是：**不同阶段的字形与速度不同**（等首字节快、推理慢、正式回答旋转、
工具执行另一套），**静默超时后颜色从主题色平滑过渡到告警红**，并且这套动效必须有
**无动效替代编码**（整屏不动时仍能看出状态）。

三件可断言的事（都是纯函数）：
- `frames_for(phase)` / `frame_at(phase, elapsed)`：阶段 → 帧序列与当前帧；
- `stall_level(idle, threshold)`：0→1 的"卡住程度"；
- `stall_color(level, truecolor)`：真彩走平滑过渡，**低色深在过半处离散跳到告警色**
  （降级之后语义仍然成立）。
`spinner_line()` 负责把上面三样拼成一行（并按列截断，免得顶破终端让 `\r` 重绘错位）。
"""

from __future__ import annotations

import math
from typing import Dict, List, Sequence, Tuple

from ui.ace_text import truncate_width

__all__ = ["PHASES", "frames_for", "frame_at", "phase_interval", "stall_level",
           "stall_color", "spinner_line", "DEFAULT_STALL_SECONDS",
           "THEME_RGB", "WARN_RGB", "noise_frames", "NOISE_CELLS",
           "NOISE_FILL", "NOISE_EMPTY"]

# 阶段：等首字节（网络）→ 推理 → 正式回答 → 工具参数流入 → 工具执行
PHASES: Tuple[str, ...] = ("waiting", "reasoning", "answering", "tool_args",
                           "tool_running")

# ── 噪声填充指示器 ────────────────────────────────────────────────────────────
# 照 `C:\Users\69215\Desktop\circle-noise-fill.html`（参考件）那套算法，把 646² 像素的
# "圆圈被噪点填满"**缩到 5 格**（推理阶段的转轮位置）：
#   ① 每格先算一个"出生阈值"，由**值噪声**排序归一化 ⇒ 阈值 == 已填比例（源片 :50）；
#   ② 相邻格的噪声值接近 ⇒ **成团生长**；换成随机数就退化成散点雨（源片 :29-39）；
#   ③ 缓动只作用在进度上（smoothstep，源片 :61）；
#   ④ **填满之后倒放回来** —— 源片是一次性填充（`LOOP=false`），做成指示器得往回走，
#      否则一旦填满就再也看不出"还在动"。
# 圆本身不抄：源片那句 `if (Math.hypot(x,y) > R) continue` 是**范围**而不是绘制，
# 这里 5 格就是范围（规范同 §4.7 的结论）。
NOISE_CELLS = 5
NOISE_STEP = 0.20               # 每帧推进多少进度（一轮 11 帧 ≈ 1s，太快成了闪烁）
NOISE_FILL = "█"
NOISE_EMPTY = "·"
NOISE_SEED = 1.0                # 写死：开屏/转轮每次都不一样 = 每次启动都像另一个软件


def _hash1(i: float, seed: float = NOISE_SEED) -> float:
    """格点哈希 → [0,1)。同源片的 `hash()`，只是一维。"""
    v = math.sin(i * 127.1 + seed * 74.7) * 43758.5453
    return v - math.floor(v)


def _noise1(x: float, seed: float = NOISE_SEED) -> float:
    """一维**值噪声**：格点取值、格点之间平滑插值 —— 相邻格接近才有"成团生长"。"""
    xi = math.floor(x)
    xf = x - xi
    u = xf * xf * (3 - 2 * xf)
    return _hash1(xi, seed) * (1 - u) + _hash1(xi + 1, seed) * u


def _smooth(p: float) -> float:
    """缓动（smoothstep）：起步慢、中段成片翻、收尾慢。"""
    p = max(0.0, min(1.0, float(p)))
    return p * p * (3 - 2 * p)


def noise_frames(cells: int = NOISE_CELLS, step: float = NOISE_STEP) -> List[str]:
    """噪声填充的帧序列：**正向填满 → 倒放回空**。

    纯函数（同一 `cells`/`step` 永远同一串帧）—— 所以能被单测逐帧比对，
    也能被前端那份实现逐帧对齐。
    """
    n = max(1, int(cells))
    vals = [_noise1(i * 0.55) for i in range(n)]
    order = sorted(range(n), key=lambda i: vals[i])
    th = [0.0] * n
    for rank, i in enumerate(order):
        # 阈值 = 排名归一化（源片 :50 是 `rank/(len-1)`）。这里刻意用 `(rank+1)/(n+1)`：
        # 源片有几万像素，第一格在 p=0 就亮看不出来；只有 5 格时那一格非常扎眼
        # （实测首帧是 `····█`，像"已经填了一半"）。空 → 满，两头都干净。
        th[i] = (rank + 1) / (n + 1)

    step = max(0.02, min(1.0, float(step)))
    marks: List[float] = []
    p = 0.0
    while p < 1.0:
        marks.append(p)
        p += step
    marks.append(1.0)
    marks += marks[-2::-1]                     # 倒放（去掉重复的那个 1.0）
    out: List[str] = []
    for p in marks:
        e = _smooth(p)
        out.append("".join(NOISE_FILL if th[i] <= e + 1e-9 else NOISE_EMPTY
                           for i in range(n)))
    return out


# 每个阶段一套字形与帧间隔（0.08s = 快、0.18s = 慢）。字符都是单宽、无 emoji。
# 推理那串 = `noise_frames()` 的输出，**写成字面量**是因为前端一致性测试
# （`frontend/test/spinner.test.ts`）按 `_GLYPHS` 里的引号字面量解析比对 —— 放函数调用
# 它读不到。两者不许漂：`test_all.py` 有一条 `noise_frames() == list(_GLYPHS["reasoning"][0])`。
_GLYPHS: Dict[str, Tuple[Tuple[str, ...], float]] = {
    "waiting": (("·", "˙", "•", "˙"), 0.08),          # 等首字节：快闪
    # 推理：**噪声填充**（原来这里是月相 `◐◓◑◒`——上游 `moon` 预设，被这个换掉）。
    # 间隔仍是"最慢"那一档（0.18 > tool_running 的 0.16）：速度即语义，不因为换了字形就变。
    "reasoning": (("·····", "·····", "···██", "··███", "█████", "█████", "█████",
                   "··███", "···██", "·····", "·····"), 0.18),
    "answering": (("◈", "◇", "◆", "◇"), 0.12),        # 正式回答：中速旋转
    "tool_args": (("▖", "▘", "▝", "▗"), 0.10),        # 参数流入：四角推进
    "tool_running": (("▁", "▃", "▅", "▇", "▅", "▃"), 0.16),   # 执行：脉冲
}
DEFAULT_PHASE = "reasoning"
DEFAULT_STALL_SECONDS = 3.0

# 主题绿 → 告警红（真彩色下按比例插值）
THEME_RGB = (0x7E, 0xCB, 0x8F)
WARN_RGB = (0xFF, 0x6B, 0x6B)
_RESET = "\x1b[0m"


def _norm_phase(phase: str) -> str:
    p = str(phase or DEFAULT_PHASE)
    return p if p in _GLYPHS else DEFAULT_PHASE


def frames_for(phase: str) -> List[str]:
    """阶段的帧序列（认不出的阶段退回默认，不抛）。"""
    return list(_GLYPHS[_norm_phase(phase)][0])


def phase_interval(phase: str) -> float:
    """阶段的帧间隔（秒）——**速度本身是语义**。"""
    return float(_GLYPHS[_norm_phase(phase)][1])


def frame_at(phase: str, elapsed: float, reduced_motion: bool = False) -> str:
    """当前该显示哪一帧；`reduced_motion` 时固定**一个非空**的稳定字形。"""
    frames = frames_for(phase)
    if reduced_motion:
        # 无动效 ≠ 什么都看不见：噪声填充的首帧是空格子，静态时会像"没在干活"。
        if _norm_phase(phase) == "reasoning":
            return NOISE_FILL * NOISE_CELLS
        return frames[0]
    idx = int(max(0.0, float(elapsed)) / phase_interval(phase)) % len(frames)
    return frames[idx]


def stall_level(idle_secs: float, threshold: float = DEFAULT_STALL_SECONDS) -> float:
    """"卡住程度" 0→1：静默超过阈值后随时间递增（有活跃工具时调用方不该调它）。"""
    try:
        idle = max(0.0, float(idle_secs))
        th = max(0.1, float(threshold))
    except (TypeError, ValueError):
        return 0.0
    if idle <= th:
        return 0.0
    return min(1.0, (idle - th) / (th * 2))       # 再过一个阈值时长到满


def _lerp_rgb(a: Sequence[int], b: Sequence[int], level: float) -> Tuple[int, int, int]:
    return tuple(int(round(a[i] + (b[i] - a[i]) * float(level))) for i in range(3))  # type: ignore[return-value]


def stall_color(level: float, truecolor: bool = True) -> str:
    """卡住程度 → ANSI 颜色码。

    真彩：主题色与告警色之间**平滑插值**；低色深：**过半处离散跳到告警色**（降级后
    "不太对"的语义仍然成立，而不是变成一个看不出差别的中间色）。
    """
    lv = max(0.0, min(1.0, float(level or 0.0)))
    if lv <= 0.0:
        if truecolor:
            return f"\x1b[38;2;{THEME_RGB[0]};{THEME_RGB[1]};{THEME_RGB[2]}m"
        return "\x1b[32m"
    if not truecolor:
        return "\x1b[31m" if lv > 0.5 else "\x1b[33m"
    r, g, b = _lerp_rgb(THEME_RGB, WARN_RGB, lv)
    return f"\x1b[38;2;{r};{g};{b}m"


def spinner_line(phase: str, elapsed: float, idle: float = 0.0,
                 label: str = "", reduced_motion: bool = False,
                 truecolor: bool = True, width: int = 0,
                 color: bool = True,
                 stall_seconds: float = DEFAULT_STALL_SECONDS,
                 active_tool: bool = False) -> str:
    """等待行：`◐ 正在读取 x.py 3s`（颜色随卡住程度过渡）。

    `active_tool=True`（工具正在跑）时**不做卡住判定** —— 一条长命令跑 60 秒是正常的，
    把它染成告警色只会教用户忽略颜色。
    """
    glyph = frame_at(phase, elapsed, reduced_motion)
    secs = int(max(0.0, float(elapsed)))
    text = f"{glyph} {label}".rstrip()
    text += f" {secs}s"
    level = 0.0 if active_tool else stall_level(idle, stall_seconds)
    if level > 0.0 and not reduced_motion:
        text = f"{stall_color(level, truecolor)}{text}{_RESET}"
    elif level > 0.0:
        # 无动效：用文字编码代替颜色动画（静态也能看出"卡了"）
        text += "  (无响应)"
    return truncate_width(text, width) if width and width > 0 else text
