# -*- coding: utf-8 -*-
"""
ace_theme.py —— ACE 主题色层（唯一真相源）

目标：全仓「一个 token → 一种颜色」只有这一张表；三种消费者（传统 REPL 的
`c()`、引擎屏的 `cell()`、SVG 预览的 `cell_hex()`）都从这里取值，不再各存一套。

用法：
    from ui import ace_theme as theme
    theme.apply_color("mist-dark")        # --color 的值：色板名 / auto / 覆盖式
    color = theme.tc("error")             # 当前色板下 error 的原值
    sgr   = theme.sgr_for("error")        # →  "38;2;218;138;147"（不含 ESC/m）
    theme.set_theme(None)                 # 恢复自动检测

色板名：dark / light（旧的两套，值仍是 Rich 色名）、
        mist-dark / mist-light / mist-ansi（dsh-TUI 的「雾蓝 Gentle Mist Blue」家族）、
        auto（按终端背景在 mist-light / mist-dark 之间选）、
        ~/.ace/themes/<name>.json 里的自定义主题。

值的写法（`sgr()` 负责翻译，未知值 → "" 不上色，绝不抛异常）：
    "#RRGGBB" / "#RGB" / "rgb(r,g,b)" / "ansi256(n)" / "ansi:blueBright"
    "ansibrightblack"（Rich 风格色名）/ "38;5;245"（已经是 SGR 参数）
    "bg:#RRGGBB"（背景）/ ""（刻意的"不上色"，见 user_bg 的说明）

纯 stdlib，无任何第三方依赖；导入无副作用（首次取色时才懒检测主题）。
"""

import json
import os
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# 一、旧的两套调色板（值 = Rich 风格色名）
#
# 这两个字典是**契约**：test_all.py [33] 直接断言里面的值，还有调用方按名字取色。
# 不要为了"统一格式"把它们改成十六进制 —— 色名的语义是"用终端调色板里的那一号
# 色"，改成 hex 就把渲染决定权从用户终端手里抢走了（`frontend/src/theme/tokens.ts`
# 上面那段注释踩过这个坑：ansiyellow → #808000 渲染成橄榄绿）。
# ---------------------------------------------------------------------------
THEMES = {
    "dark": {
        "text": "ansibrightwhite",      # 正文：亮白
        "dim": "ansibrightblack",       # 次要 / 弱化：灰
        "accent": "ansiyellow",         # 强调（标题 / 高亮）：黄
        "border": "ansibrightblack",    # 边框 / 分隔线：灰
        "error": "ansired",             # 错误：红
        "success": "ansigreen",         # 成功：绿
        "warn": "ansiyellow",           # 警告：黄
        "info": "ansicyan",             # 信息：青
        "user_bg": "bg:#2b2b3c",        # 用户消息底色（深紫灰，与 ai_code 底栏一致）
        "tool_pending": "ansiblue",     # 工具三态 · 执行中：蓝
        "tool_ok": "ansigreen",         # 工具三态 · 成功：绿
        "tool_fail": "ansired",         # 工具三态 · 失败：红
        "perm_ro": "ansiblue",          # 权限 · 只读：蓝
        "perm_write": "ansiyellow",     # 权限 · 可写：黄
        "perm_full": "ansired",         # 权限 · 全权：红
        "goal_active": "ansigreen",     # 目标 · 进行中：绿
        "goal_paused": "ansiyellow",    # 目标 · 暂停：黄
    },
    "light": {
        "text": "ansiblack",            # 正文：黑
        "dim": "ansibrightblack",       # 次要 / 弱化：灰
        "accent": "ansiblue",           # 强调：蓝（浅底上比黄色清晰）
        "border": "ansibrightblack",    # 边框 / 分隔线：灰
        "error": "ansibrightred",       # 错误：亮红（浅底上增强对比）
        "success": "ansigreen",         # 成功：绿
        "warn": "ansimagenta",          # 警告：品红（浅底上黄字不可读）
        "info": "ansiblue",             # 信息：蓝
        "user_bg": "bg:#eef0f6",        # 用户消息底色（浅蓝灰）
        "tool_pending": "ansiblue",     # 工具三态 · 执行中：蓝
        "tool_ok": "ansigreen",         # 工具三态 · 成功：绿
        "tool_fail": "ansibrightred",   # 工具三态 · 失败：亮红
        "perm_ro": "ansiblue",          # 权限 · 只读：蓝
        "perm_write": "ansimagenta",    # 权限 · 可写：品红
        "perm_full": "ansibrightred",   # 权限 · 全权：亮红
        "goal_active": "ansigreen",     # 目标 · 进行中：绿
        "goal_paused": "ansimagenta",   # 目标 · 暂停：品红
    },
}

# 17 个语义 token（顺序即文档顺序，前端 `tokens.ts` 按这个集合同步）
SEMANTIC_TOKENS = (
    "text", "dim", "accent", "border", "error", "success", "warn", "info",
    "user_bg", "tool_pending", "tool_ok", "tool_fail",
    "perm_ro", "perm_write", "perm_full", "goal_active", "goal_paused",
)

# 传统 REPL 的 6 个短色名。ai_code.py 里 200+ 处 `c("cyan", ...)` 用的是它们，
# 所以色板必须同时定义这 6 个 —— 否则换色只换了新代码，老屏还是旧色。
LEGACY_COLOR_NAMES = ("red", "green", "yellow", "blue", "magenta", "cyan")

# ---------------------------------------------------------------------------
# 二、雾蓝色板（配色照抄 dsh-TUI 的「Gentle Mist Blue」家族）
#
# 来源：`G:\ai工作区\dsh-TUI-main\dsh-TUI-main\src\theme.ts`
#   dark  :239-313 / light :321-395 / dark-ansi :406-480
# 那边有 73 个 token，我们只有 17 + 6 个槽位，所以是**按语义挑**而不是逐字搬：
#   dsh-TUI                          → ace
#   accent / activity                → accent / tool_pending
#   text                             → text
#   inactive                         → dim
#   promptBorder                     → border
#   error / success / warning        → error / success / warn
#   toolCardBackground               → user_bg（卡片衬底当用户消息底色）
#   toolNameExec / toolNameMutate    → perm_ro / perm_write（读=青、写=金）
#   toolDot*                         → 6 个短色名（终端里最亮的那档）
# 两边都是"雾蓝当家、正文中性"的同一套审美，所以直接取色不会跑味。
# ---------------------------------------------------------------------------
MIST_DARK = {
    "text": "#E8E6E0",              # 暖白正文（dsh-TUI text）
    "dim": "#8D95A6",               # 雾灰蓝（inactive）
    "accent": "#7DA1DE",            # 雾蓝品牌色（accent）
    "border": "#55606F",            # 哑蓝灰（promptBorder）
    "error": "#DA8A93",             # 柔玫瑰（error）
    "success": "#82B89D",           # 雾绿（success）
    "warn": "#D8B270",              # 柔琥珀（warning）
    "info": "#7DA1DE",              # 信息 = 品牌雾蓝
    "user_bg": "bg:#242B3A",        # 浅蓝灰卡片衬底（toolCardBackground）
    "tool_pending": "#7DA1DE",      # 执行中：活动指示器同色（activity）
    "tool_ok": "#82B89D",
    "tool_fail": "#DA8A93",
    "perm_ro": "#82B8C7",           # 只读：哑青（toolDotRead）
    "perm_write": "#E5C07B",        # 可写：柔金（toolNameMutate）
    "perm_full": "#DA8A93",
    "goal_active": "#82B89D",
    "goal_paused": "#D8B270",
    "red": "#DA8A93", "green": "#82B89D", "yellow": "#D8B270",
    "blue": "#7DA1DE", "magenta": "#B3A0D4", "cyan": "#56B6C2",
}

MIST_LIGHT = {
    "text": "#343945",              # 墨色正文
    "dim": "#8991A0",
    "accent": "#3F6CC4",            # 主蓝（品牌）
    "border": "#ABC2EC",
    "error": "#C65D6B",
    "success": "#4E9675",
    "warn": "#C08A3E",
    "info": "#3F6CC4",
    "user_bg": "bg:#DCE4FB",
    "tool_pending": "#3F6CC4",
    "tool_ok": "#4E9675",
    "tool_fail": "#C65D6B",
    "perm_ro": "#3F7E8F",
    "perm_write": "#8A6A00",
    "perm_full": "#C65D6B",
    "goal_active": "#4E9675",
    "goal_paused": "#C08A3E",
    "red": "#C65D6B", "green": "#4E9675", "yellow": "#C08A3E",
    "blue": "#3F6CC4", "magenta": "#9B86B8", "cyan": "#0F7A8A",
}

# 16 色回退板：值用 Rich 色名（老 conhost / dumb terminal 下只有这 16 号色可靠）。
MIST_ANSI = {
    "text": "ansibrightwhite", "dim": "ansiwhite", "accent": "ansibrightblue",
    "border": "ansiwhite", "error": "ansibrightred", "success": "ansibrightgreen",
    "warn": "ansibrightyellow", "info": "ansibrightcyan",
    "user_bg": "40",                # 背景黑（SGR 参数，不是色名）
    "tool_pending": "ansibrightblue", "tool_ok": "ansibrightgreen",
    "tool_fail": "ansibrightred", "perm_ro": "ansibrightcyan",
    "perm_write": "ansibrightyellow", "perm_full": "ansibrightred",
    "goal_active": "ansibrightgreen", "goal_paused": "ansibrightyellow",
    "red": "ansibrightred", "green": "ansibrightgreen", "yellow": "ansibrightyellow",
    "blue": "ansibrightblue", "magenta": "ansibrightmagenta", "cyan": "ansibrightcyan",
}

# 一张总表：色板名 → {token: 值}。`dark` / `light` 直接引用旧表（同一个对象，
# 不复制），这样 `tc("error")` 在 dark 下仍然返回 "ansired"，旧契约一个字不动。
PALETTES = {
    "dark": THEMES["dark"],
    "light": THEMES["light"],
    "mist-dark": MIST_DARK,
    "mist-light": MIST_LIGHT,
    "mist-ansi": MIST_ANSI,
}

# `auto` 按终端背景在这两个之间选（见 detect_theme）
AUTO_DARK, AUTO_LIGHT = "mist-dark", "mist-light"

# 自定义主题目录（照 dsh-TUI 的 ~/.dsh-tui/themes/<name>.json 的形式）
CUSTOM_THEME_DIR = Path.home() / ".ace" / "themes"

# 未知 token 的回退色名（tc 永不抛异常）
_FALLBACK = "ansi"

# 旧的两套 dark/light 表里只有 17 个语义 token，没有 `c("cyan", ...)` 用的那 6 个
# 短色名。这里按传统 ANSI 名回退 —— 于是它们在 dark/light 下发出的 SGR 与改造前
# 逐字节一致（demo/*.svg 的 --check 就是靠这条不红）。
_LEGACY_NAME_FALLBACK = {
    "red": "ansired", "green": "ansigreen", "yellow": "ansiyellow",
    "blue": "ansiblue", "magenta": "ansimagenta", "cyan": "ansicyan",
    "black": "ansiblack", "white": "ansiwhite", "gray": "ansibrightblack",
}

# ---------------------------------------------------------------------------
# 三、色的翻译层：任何写法 → SGR 参数
#
# 为什么需要它：三种消费者拿到的值格式本来就不同（Rich 名 / 十六进制 /
# 已经是 SGR 串），过去靠"各处自己认自己那一种"，于是同一处改色要改三个地方。
# 现在只有这一个函数认格式，其余全是纯表。
# ---------------------------------------------------------------------------
_NAME_TO_SGR = {
    "ansi": "39", "ansiblack": "30", "ansired": "31", "ansigreen": "32",
    "ansiyellow": "33", "ansiblue": "34", "ansimagenta": "35", "ansicyan": "36",
    "ansiwhite": "37", "ansibrightblack": "90", "ansibrightred": "91",
    "ansibrightgreen": "92", "ansibrightyellow": "93", "ansibrightblue": "94",
    "ansibrightmagenta": "95", "ansibrightcyan": "96", "ansibrightwhite": "97",
    # 短名（c("red", ...) 那一套）与 chalk 的名字都收进来，方便自定义主题直接写
    "black": "30", "red": "31", "green": "32", "yellow": "33", "blue": "34",
    "magenta": "35", "cyan": "36", "white": "37", "gray": "90", "grey": "90",
    "blackbright": "90", "redbright": "91", "greenbright": "92",
    "yellowbright": "93", "bluebright": "94", "magentabright": "95",
    "cyanbright": "96", "whitebright": "97",
}

_HEX3 = re.compile(r"^#([0-9a-f])([0-9a-f])([0-9a-f])$")
_HEX6 = re.compile(r"^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$")
_RGB_FN = re.compile(r"^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$")
_ANSI256_FN = re.compile(r"^ansi256\(\s*(\d{1,3})\s*\)$")
_SGR_PARAM = re.compile(r"^\d+(;\d+)*$")


def _hex_to_rgb(value: str):
    """'#RRGGBB' / '#RGB' → (r, g, b)；不是就返回 None。"""
    m = _HEX6.match(value)
    if m:
        return tuple(int(x, 16) for x in m.groups())
    m = _HEX3.match(value)
    if m:
        return tuple(int(x * 2, 16) for x in m.groups())
    return None


def sgr(value: str) -> str:
    """任意颜色写法 → SGR 参数（不含 ESC 与结尾的 m）。认不出来返回 ""（= 不上色）。

    支持：`#RGB` / `#RRGGBB` / `#RRGGBBAA`（忽略 alpha）/ `rgb(r,g,b)` /
    `ansi256(n)` / `ansi:blueBright` / Rich 色名 / 已经是 SGR 参数 / `bg:#RRGGBB`。
    """
    v = str(value or "").strip()
    if not v:
        return ""
    low = v.lower()
    # 背景色：bg: 前缀 → 48;2;r;g;b
    if low.startswith("bg:"):
        body = v[3:].strip()
        rgb = _hex_to_rgb(body.lower())
        if rgb:
            return "48;2;{};{};{}".format(*rgb)
        m = _RGB_FN.match(body.lower())
        if m:
            return "48;2;{};{};{}".format(*(int(x) for x in m.groups()))
        inner = sgr(body)
        # 色名背景：31 → 41（前景码 +10）
        if inner.isdigit() and 30 <= int(inner) <= 37:
            return str(int(inner) + 10)
        if inner.isdigit() and 90 <= int(inner) <= 97:
            return str(int(inner) + 10)
        return ""
    # ansi:blueBright → ansibrightblue
    if low.startswith("ansi:"):
        # dsh-TUI 的写法（ansi:blueBright）原样收下，好让它的主题文件可以直接抄过来
        name = low[5:].replace("_", "").replace("-", "")
        return _NAME_TO_SGR.get("ansi" + name, _NAME_TO_SGR.get(name, ""))
    if low in _NAME_TO_SGR:
        return _NAME_TO_SGR[low]
    rgb = _hex_to_rgb(low)
    if rgb:
        return "38;2;{};{};{}".format(*rgb)
    m = _RGB_FN.match(low)
    if m:
        return "38;2;{};{};{}".format(*(int(x) for x in m.groups()))
    m = _ANSI256_FN.match(low)
    if m:
        return "38;5;{}".format(int(m.group(1)))
    # 已经是 SGR 参数（`38;5;245` / `39` / `40`）直接放行
    if _SGR_PARAM.match(low):
        return low
    return ""


# ---------------------------------------------------------------------------
# 四、当前色板
# ---------------------------------------------------------------------------
_CURRENT = None          # None = 尚未显式设置 → 首次使用时懒调用 detect_theme()
_OVERRIDES = {}          # 覆盖式 --color 的落点（只覆盖当前会话，不写盘）


def _is_light_bg() -> bool:
    """终端背景是不是浅色（COLORFGBG 推断：格式 'fg;bg'，背景号 >= 8 视为浅底）。"""
    fgbg = os.environ.get("COLORFGBG", "").strip()
    if fgbg:
        bg = fgbg.split(";")[-1].strip()
        if bg.isdigit():
            return int(bg) >= 8
    return False


def detect_theme() -> str:
    """检测当前色板名。

    优先级：
      1. 环境变量 ACE_THEME（任何已知色板名都认，含自定义主题名）；
      2. COLORFGBG 推断 → light / dark（**旧的两套**，默认外观一个字不改）；
      3. 兜底 "dark"。

    注意这里**不**自动切雾蓝：`--color auto` 才是"跟随背景用雾蓝家族"的显式请求
    （见 `apply_color`）。默认检测必须保持 dark/light —— 换色是用户的选择，
    不该由一次升级替他决定。
    """
    explicit = os.environ.get("ACE_THEME", "").strip().lower()
    if explicit in PALETTES or _load_custom(explicit):
        return explicit
    return "light" if _is_light_bg() else "dark"


def _resolve_theme() -> str:
    """内部：返回当前生效的色板名（未显式设置时懒检测）。"""
    return _CURRENT if _CURRENT is not None else detect_theme()


def _palette(name: str = None) -> dict:
    """取色板表：先看自定义主题，再看内置；都没有就回退 dark。"""
    key = name or _resolve_theme()
    if key == "auto":
        key = AUTO_LIGHT if _is_light_bg() else AUTO_DARK
    custom = _load_custom(key)
    if custom:
        return custom
    return PALETTES.get(key, PALETTES["dark"])


def tc(token: str) -> str:
    """取当前色板下 token 的**原值**（可能是色名、十六进制或 SGR 串）。

    token 不存在时回退 "ansi"（默认前景），绝不抛异常。
    """
    if token in _OVERRIDES:
        return _OVERRIDES[token]
    return _palette().get(token, _FALLBACK)


def sgr_for(token: str) -> str:
    """取当前色板下 token 的 SGR 参数（喂给 `\\x1b[...m`）。

    严格版：**token 认不出来就返回 ""**（= 不上色），和 `tc()` 的"回退默认前景"
    是两种契约 —— `c()` 靠这个区分"这是个颜色"和"这不是个颜色名"。
    旧的 dark/light 表里没有 6 个短色名（`cyan` 那些），这里按传统 ANSI 名回退，
    保证它们的输出与改造前逐字节一致。
    """
    if token in _OVERRIDES:
        return sgr(_OVERRIDES[token])
    palette = _palette()
    if token in palette:
        return sgr(palette[token])
    legacy = _LEGACY_NAME_FALLBACK.get(token)
    return sgr(legacy) if legacy else ""


def set_theme(theme: str) -> None:
    """显式设置并缓存当前色板。

    theme 为已知色板名（或自定义主题名）时切换；为 None 时恢复自动检测；
    未知名字回退到 detect_theme() 的结果（不抛异常）。
    """
    global _CURRENT
    if theme is None:
        _CURRENT = None
        return
    name = str(theme).strip().lower()
    if name not in PALETTES and not _load_custom(name):
        name = detect_theme()
    _CURRENT = name


def current_theme() -> str:
    """返回当前生效的色板名。"""
    return _resolve_theme()


# ---------------------------------------------------------------------------
# 五、自定义主题：~/.ace/themes/<name>.json
#
# 形式照 dsh-TUI 的 ~/.dsh-tui/themes/<name>.json：
#   {"name": "sakura", "displayName": "樱花粉", "base": "mist-dark",
#    "colors": {"accent": "#FF9EC7", "warn": "#E0C08A"}}
# `colors` 是**部分覆盖**，只写想改的键；未知键与坏值跳过（不影响其它键）。
# ---------------------------------------------------------------------------
_CUSTOM_CACHE = {}


def _safe_theme_name(name: str) -> bool:
    """主题名来自用户输入：挡掉路径穿越（`../` 之类），只允许 [a-z0-9_-]。"""
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", str(name or "").lower()))


def _load_custom(name: str) -> dict:
    """读一个自定义主题并叠加到它的 base 上；读不到返回 {}（不抛异常）。"""
    key = str(name or "").strip().lower()
    if not _safe_theme_name(key):
        return {}
    if key in _CUSTOM_CACHE:
        return _CUSTOM_CACHE[key]
    built = {}
    try:
        raw = json.loads((CUSTOM_THEME_DIR / (key + ".json")).read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            base = str(raw.get("base") or "mist-dark").strip().lower()
            # `name` 字段可以给别名，但加载键仍是文件名
            alias = str(raw.get("name") or "").strip().lower()
            colors = raw.get("colors")
            if base in PALETTES and isinstance(colors, dict):
                built = dict(PALETTES[base])
                for k, v in colors.items():
                    if k in SEMANTIC_TOKENS or k in LEGACY_COLOR_NAMES or k in built:
                        if sgr(v):
                            built[k] = v
                if alias and alias != key and _safe_theme_name(alias):
                    _CUSTOM_CACHE[alias] = built
    except Exception:  # noqa: BLE001 —— 坏主题文件绝不能挡住启动
        built = {}
    _CUSTOM_CACHE[key] = built
    return built


def list_theme_names() -> list:
    """所有可用色板名（内置在前，自定义在后，按名字排序）。"""
    names = ["auto"] + list(PALETTES)
    try:
        custom = sorted(p.stem for p in CUSTOM_THEME_DIR.glob("*.json")
                        if _safe_theme_name(p.stem))
    except Exception:  # noqa: BLE001
        custom = []
    return names + [n for n in custom if n not in names]


def apply_color(spec) -> str:
    """应用 `--color` 的值，返回最终生效的色板名（用不了则返回 ""）。

    三种写法：
      `--color mist-dark`                    选色板（含 auto / 自定义主题名）
      `--color accent=#FF9EC7,warn=#E0C08A`  在当前色板上覆盖若干个 token
      `--color`                              等价于 auto（跟随终端背景）
    """
    global _OVERRIDES
    text = str(spec or "").strip()
    if not text:
        return ""
    if "=" in text:
        # 覆盖式：每个键独立校验，坏的那个跳过，其余照常生效
        applied = {}
        for part in text.split(","):
            if "=" not in part:
                continue
            key, _, val = part.partition("=")
            key = key.strip()
            if not key or not sgr(val):
                continue
            applied[key] = val.strip()
        if not applied:
            return ""
        _OVERRIDES = applied
        return _resolve_theme()
    _OVERRIDES = {}
    name = text.lower()
    if name == "auto":
        return AUTO_LIGHT if _is_light_bg() else AUTO_DARK
    if name in PALETTES or _load_custom(name):
        _set_current(name)
        return name
    return ""


def _set_current(name: str) -> None:
    """内部：直接写当前色板（apply_color 已校验过，不再走 set_theme 的回退）。"""
    global _CURRENT
    _CURRENT = name


def clear_overrides() -> None:
    """清掉覆盖式 --color 的痕迹（测试与 `/color` 复位用）。"""
    global _OVERRIDES
    _OVERRIDES = {}


# ---------------------------------------------------------------------------
# 六、瑞士风格 token 层（docs/TUI-SWISS-SPEC.md 第四节）
# 三级灰 + 一个强调色 + 三个语义色。**新屏一律用这一层**。
#
# 为什么和上面的旧表并存：旧表的色名（`ansiyellow` 之类）被 test_all.py:6002-6052
# 当契约断言了，还有调用方在用。一次大爆炸改色会把"测试红"和"界面坏"混在一起。
# 旧 → 新的映射与删除条件写在规范第四节；调用方迁完之后，旧表整块删除。
#
# 值分两种：SGR 参数（喂终端）与 hex（喂 SVG 预览后端），所以两个取值函数。
# 雾蓝两套的 SGR 值由上面的 PALETTES 直接翻译而来，不再手抄第二遍。
# ---------------------------------------------------------------------------
def _mist_cells(palette: dict, base_bg: str) -> dict:
    """雾蓝色板 → 瑞士 token 层（值是 SGR 参数，不是色名）。"""
    return {
        "text": "39",
        "text_2": sgr(palette["dim"]),
        "text_3": sgr(palette["border"]),
        "accent": sgr(palette["accent"]),
        "ok": sgr(palette["tool_ok"]),
        "warn": sgr(palette["warn"]),
        "err": sgr(palette["error"]),
        "base_bg": base_bg,
        "base_fg": palette["text"],
        "accent_hex": palette["accent"],
    }


CELL_THEMES = {
    "dark": {
        "text": "39", "text_2": "38;5;245", "text_3": "38;5;240",
        "accent": "38;5;173",
        "ok": "38;5;71", "warn": "38;5;179", "err": "38;5;167",
        "base_bg": "#0e0e13", "base_fg": "#e8e8ee", "accent_hex": "#d7a05f",
    },
    "light": {
        "text": "39", "text_2": "38;5;244", "text_3": "38;5;249",
        "accent": "38;5;160",
        "ok": "38;5;28", "warn": "38;5;136", "err": "38;5;160",
        "base_bg": "#faf8f4", "base_fg": "#16161a", "accent_hex": "#c0392b",
    },
    # 雾蓝：底色取 dsh-TUI 的工具卡衬底/暖白，避免"品牌色换了、底还是旧底"
    "mist-dark": _mist_cells(MIST_DARK, "#12151c"),
    "mist-light": _mist_cells(MIST_LIGHT, "#F6F3ED"),
    # 16 色档：灰阶退化成三档色名对应的 SGR，保证老终端也能读
    "mist-ansi": {
        "text": "39", "text_2": "37", "text_3": "90",
        "accent": "94",
        "ok": "92", "warn": "93", "err": "91",
        "base_bg": "#000000", "base_fg": "#ffffff", "accent_hex": "#5E88CC",
    },
}

SWISS_ROLES = ("text", "text_2", "text_3", "accent", "ok", "warn", "err")


def cell(role: str, theme: str = None) -> str:
    """瑞士 token → SGR 参数（不含 ESC）。未知角色回退 `text`（默认前景）。"""
    palette = CELL_THEMES.get(theme or _resolve_theme(), CELL_THEMES["dark"])
    return palette.get(role, palette["text"])


def cell_hex(role: str, theme: str = None) -> str:
    """同一批 token 的 hex 值（预览图用；终端不用它）。未知角色回退默认前景。"""
    palette = CELL_THEMES.get(theme or _resolve_theme(), CELL_THEMES["dark"])
    return palette.get(role, palette["base_fg"])


# ---------------------------------------------------------------------------
# 七、终端外壳（prompt_toolkit 样式字典）：底栏 / 全屏 / 选择器
#
# 为什么单独一层，而不是塞进 17 个语义 token：这一层管的是**界面底色与选中块**
# （`bg:#2b2b3c` 的底栏、选中行的紫底），语义 token 管的是"文字该是什么颜色"。
# 混在一起会把前端的 token 契约从 17 个撑大，而 `frontend/test/theme.test.ts`
# 是按 17 个钉死的 —— 加 token 要两边同时改，收益却只是三个外壳。
#
# 铁律不变：**缺省不换色**。`dark` / `light` 的值与改造前**逐字相同**
# —— 包括"这两套本来就共用同一份外壳、没分深浅"这件事（浅色终端上底栏一直是
# 深色条，那是既有观感，不由这次移植顺手改掉）。
# 只有显式选雾蓝时，外壳才跟着雾蓝走，且颜色全部由同一张色板推出来。
# ---------------------------------------------------------------------------
_CHROME_COMMON = {
    "prompt": "ansimagenta bold",
    "prompt-bash": "ansiyellow bold",
    "prompt-multi": "ansicyan bold",
    "continuation": "ansibrightblack",
    "perm": "ansicyan bold",
    "footer": "bg:#2b2b3c #aaaaaa",
    "footer-dim": "bg:#2b2b3c #666666",
    "footer-ro": "bg:#2b2b3c #5fa8ff",
    "footer-w": "bg:#2b2b3c #f6c453",
    "footer-f": "bg:#2b2b3c #ff6b6b",
    "footer-goal": "bg:#2b2b3c #7ecb8f",
    "completion-menu.completion": "bg:#2b2b3c #ffffff",
    "completion-menu.completion.current": "bg:#5f3dc4 #ffffff",
    "completion-menu.completion.meta": "bg:#1e1e2e #aaaaaa",
}

#: 全屏会话（`ui/ace_fullscreen.py`）与选择器（`ui/ace_selector.py`）的现值，逐字保留。
_CHROME_FULLSCREEN = {
    "fs.header": "bg:#2b2b3c #ffffff bold",
    "fs.body": "#cccccc",
    "fs.text": "#cccccc",
    "fs.status": "bg:#2b2b3c #aaaaaa",
    "fs.hint": "bg:#2b2b3c #888888",
    "fs.notice": "bg:#2b2b3c #f6c453",
    "fs.scroll": "bg:#2b2b3c #9cdcfe",
    "fs.prompt": "bold #7ecb8f",
    "fs.input": "#ffffff",
}

_CHROME_SELECTOR = {
    "frame.border": "#8a8a9a",
    "frame.label": "bold #f6c453",
    "sel.prompt": "bold #7ecb8f",
    "sel.input": "#ffffff",
    "sel.row": "#cccccc",
    "sel.row.sel": "bg:#5f3dc4 #ffffff",
    "sel.hl": "bold #f6c453",
    "sel.hl.sel": "bg:#5f3dc4 #f6c453 bold",
    "sel.empty": "#666666 italic",
    "sel.footer": "bg:#2b2b3c #aaaaaa",
    "sel.preview": "#9cdcfe",
}

#: 旧两套外壳（dark 与 light 共用同一份，照旧）。
_CHROME_LITERAL = {
    name: dict(_CHROME_COMMON, **_CHROME_FULLSCREEN, **_CHROME_SELECTOR)
    for name in ("dark", "light")
}


def _derive_chrome(palette: dict) -> dict:
    """雾蓝外壳：颜色**全部**由同一张色板推出来，不再手抄第二遍。"""
    raw_bg = str(palette.get("user_bg", ""))
    # 16 色板那边 `user_bg` 是 SGR 参数（"40"），prompt_toolkit 认不了 —— 退回色名。
    bg = _ptk(raw_bg[3:] if raw_bg.startswith("bg:") else "ansiblack")
    text = _ptk(palette["text"])
    dim = _ptk(palette["dim"])
    accent = _ptk(palette["accent"])

    def band(fg: str, attrs: str = "") -> str:
        return "bg:{} {}{}".format(bg, fg, attrs)

    return {
        "prompt": "{} bold".format(accent),
        "prompt-bash": "{} bold".format(_ptk(palette["warn"])),
        "prompt-multi": "{} bold".format(_ptk(palette["info"])),
        "continuation": dim,
        "perm": "{} bold".format(_ptk(palette["perm_ro"])),
        "footer": band(dim),
        "footer-dim": band(_ptk(palette["border"])),
        "footer-ro": band(_ptk(palette["perm_ro"])),
        "footer-w": band(_ptk(palette["perm_write"])),
        "footer-f": band(_ptk(palette["perm_full"])),
        "footer-goal": band(_ptk(palette["goal_active"])),
        "completion-menu.completion": band(text),
        "completion-menu.completion.current": "bg:{} {}".format(accent, bg),
        "completion-menu.completion.meta": "bg:{} {}".format(_ptk(palette["border"]), dim),
        "frame.border": _ptk(palette["border"]),
        "frame.label": "bold {}".format(_ptk(palette["warn"])),
        "sel.prompt": "bold {}".format(_ptk(palette["goal_active"])),
        "sel.input": text,
        "sel.row": text,
        "sel.row.sel": "bg:{} {}".format(accent, text),
        "sel.hl": "bold {}".format(_ptk(palette["warn"])),
        "sel.hl.sel": "bg:{} {} bold".format(accent, _ptk(palette["warn"])),
        "sel.empty": "{} italic".format(_ptk(palette["border"])),
        "sel.footer": band(dim),
        "sel.preview": _ptk(palette["info"]),
        "fs.header": band(text, " bold"),
        "fs.body": text,
        "fs.text": text,
        "fs.status": band(dim),
        "fs.hint": band(_ptk(palette["border"])),
        "fs.notice": band(_ptk(palette["warn"])),
        "fs.scroll": band(_ptk(palette["info"])),
        "fs.prompt": "bold {}".format(_ptk(palette["goal_active"])),
        "fs.input": text,
    }


# prompt_toolkit 的 ANSI 色名白名单**不含 `ansibrightwhite`**（`ansibrightblack` /
# `ansibrightblue` 都在，实测 `Style.from_dict` 只对这一个抛 ValueError）。
# 雾蓝 16 色板的 text 正是它（照 dsh-TUI 的 `ansi:whiteBright` 抄的），所以进
# prompt_toolkit 之前必须换掉 —— 否则 `--color mist-ansi` 一开经典 REPL 就崩。
_PTK_NAME_FIX = {"ansibrightwhite": "#ffffff"}


def _ptk(color) -> str:
    """色板里的色名 → prompt_toolkit 认的写法（不认识就原样返回）。"""
    return _PTK_NAME_FIX.get(str(color), str(color))


def ptk_styles(palette: str = None) -> dict:
    """当前色板下的 prompt_toolkit 样式字典（底栏 / 全屏 / 选择器三处共用一份）。

    多出来的键对 `Style.from_dict` 是无害的（各外壳只引用自己那几个类名），
    所以只维护这一份，避免又出现"三处各自硬编码、换色漏两个"。
    """
    name = palette or _resolve_theme()
    if name in _CHROME_LITERAL:
        return dict(_CHROME_LITERAL[name])
    return _derive_chrome(_palette(name))
