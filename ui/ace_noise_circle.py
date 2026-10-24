#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_noise_circle —— **噪声填充圆盘**：把 `circle-noise-fill.html` 那套算法搬到字符格上

为什么单独一层：源件是一条**图形**动画（646² 画布上，一个半径 0.447×边长的圆盘按 fBm
噪声排名**成团点亮**，3.5 秒长满），不是"进度条"——搬进终端就必须是**二维格子网格**，
一行几格的那种是漫画不是这个效果。

源件的四条关键机制（逐条对应到本模块）：

| 源件 | 这里 |
| --- | --- |
| `if (Math.hypot(x,y) > R) continue` —— 只圈范围，**一行绘制都没有** | 单元格中心映射到归一化方形，`hypot > 1` 的格子不参与（`:44-48`） |
| `birth[ks[i]] = r/(order.length-1)` —— 排名归一化 ⇒ 阈值 == 已填比例 | `_birth_thresholds()`，同样的排名归一（`:50`） |
| 5 层 fBm 决定出生顺序 ⇒ **成团生长** | `_fbm()`，同 `hash`/`vnoise`/`fbm` 三个函数（`:28-39`） |
| `smooth(p)=p*p*(3-2p)` 只作用在阈值上 | `_smooth()`（`:61`） |
| `SH[i]=.90+.10*i/(SIZE-1)` —— 斜向明暗，银白有金属感 | 终端里对应的是**字形 ramp**（` ░▒▓█`）：亮度 → 字形，不是乘法 |

**倒放**（用户要求）：源件 `LOOP=false` 是一次性填充；做成会动的界面元素时，
`reverse=True` 让帧序列 = 正向填满 + 镜像倒放（填满那一帧只出现一次）。
"""

from __future__ import annotations

import math
from typing import List, Tuple

__all__ = ["disc_frames", "NOISE_COLS", "NOISE_ROWS", "RAMP", "fbm", "birth_thresholds"]

# 默认网格：终端一格约 1:2（高:宽），所以圆盘要 2 倍列数才**看着圆**。
NOISE_COLS = 27
NOISE_ROWS = 13
# 明暗 ramp：暗 → 亮。空的地方用空格（源件底色是纯黑，圆盘是"从黑里长出来"的）。
RAMP = " ░▒▓█"
# 噪声频率按归一化坐标调（源件的 .05 是按 646 像素调的，照抄到 27 格会变成"整块一起亮"）。
FREQ = 1.9
OCT = 4
SEED = 1


def _hash2(x: float, y: float, seed: float = SEED) -> float:
    """格点哈希 → [0,1)。同源件 `hash()`。"""
    h = math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
    return h - math.floor(h)


def _vnoise(x: float, y: float) -> float:
    """二维**值噪声**：格点取值、格点间平滑插值 —— 相邻格接近才有"成团生长"。"""
    xi, yi = math.floor(x), math.floor(y)
    xf, yf = x - xi, y - yi
    u = xf * xf * (3 - 2 * xf)
    v = yf * yf * (3 - 2 * yf)
    a = _hash2(xi, yi)
    b = _hash2(xi + 1, yi)
    c = _hash2(xi, yi + 1)
    d = _hash2(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v


def fbm(x: float, y: float, octaves: int = OCT) -> float:
    """多层值噪声（fBm）—— 层数越多细节越碎。"""
    s = 0.0
    amp, freq, norm = 0.5, 1.0, 0.0
    for _ in range(max(1, int(octaves))):
        s += amp * _vnoise(x * freq, y * freq)
        norm += amp
        freq *= 2.07
        amp *= 0.5
    return s / norm if norm else 0.0


def _smooth(p: float) -> float:
    """缓动（smoothstep）：起步慢、中段成片翻、收尾慢。"""
    p = max(0.0, min(1.0, float(p)))
    return p * p * (3 - 2 * p)


def birth_thresholds(cols: int = NOISE_COLS, rows: int = NOISE_ROWS,
                     freq: float = FREQ) -> List[List[float]]:
    """每格的出生阈值（`rows × cols`；圆外的格子是 `None`）。

    阈值 == 该格在全盘排名中的位置归一化 ⇒ **阈值就是已填比例**（源件 :50 同一口径）。
    返回 `None` 的位置是圆外 —— 那里永远不填（源件那句 `continue`）。
    """
    nc, nr = max(2, int(cols)), max(2, int(rows))
    samples: List[Tuple[float, int, int]] = []
    for j in range(nr):
        for i in range(nc):
            # 单元格中心 → [-1,1]²，然后按 2:1 拉伸回来比较（终端格比像素"高"）
            u = (i + 0.5) / nc * 2.0 - 1.0
            v = (j + 0.5) / nr * 2.0 - 1.0
            if math.hypot(u, v) > 1.0:
                continue
            samples.append((fbm(u * freq, v * freq), i, j))
    grid: List[List[float]] = [[None] * nc for _ in range(nr)]  # type: ignore[list-item]
    if not samples:
        return grid
    samples.sort(key=lambda s: s[0])
    last = max(1, len(samples) - 1)
    for rank, (_val, i, j) in enumerate(samples):
        grid[j][i] = rank / last
    return grid


def disc_frames(cols: int = NOISE_COLS, rows: int = NOISE_ROWS, steps: int = 14,
                ramp: str = RAMP, freq: float = FREQ, reverse: bool = False,
                seed: float = SEED) -> List[List[str]]:
    """圆盘的帧序列：每帧 = `rows` 行、每行 `cols` 列。

    - **末帧 == 静态满盘**（与 `banner_frames` 同一条契约：非 TTY 直接取 `frames[-1]`）；
    - `reverse=True` 时接着**倒放**回空（填满那一帧只出现一次）；
    - 纯函数：同参数逐帧相同（可单测、可导帧比对）。
    """
    nc, nr = max(2, int(cols)), max(2, int(rows))
    n = max(2, int(steps))
    grid = birth_thresholds(nc, nr, freq)
    ramp = ramp or RAMP
    top = len(ramp) - 1

    def frame_at(p: float) -> List[str]:
        thr = _smooth(p)
        out: List[str] = []
        for j in range(nr):
            row_chars: List[str] = []
            for i in range(nc):
                b = grid[j][i]
                if b is None or b > thr:
                    row_chars.append(" ")               # 圆外 / 还没轮到：黑底
                    continue
                # 斜向明暗（源件 SH）。**只取 ramp 上段**：源件的高光只有 10%
                # （`.90 + .10*i`），铺满整条 ramp 会变成一块渐变色，而它是一块银盘。
                shade = ((i / max(1, nc - 1)) + (j / max(1, nr - 1))) / 2.0
                lo = min(top, 2)                        # 最暗也就 `▒`（top < 2 时退化为全亮）
                row_chars.append(ramp[min(top, lo + int(round(shade * (top - lo))))])
            out.append("".join(row_chars))
        return out

    # 进度含两端：0（全黑）→ 1（满盘），`reverse=True` 时再镜像回到 0 ——
    # 倒放必须**收在空**，否则"消散"没散完，最后还挂着一团。
    marks = [i / n for i in range(0, n + 1)]
    frames = [frame_at(p) for p in marks]
    if reverse:
        frames += [frame_at(p) for p in marks[-2::-1]]
    return frames
