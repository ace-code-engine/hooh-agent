#!/usr/bin/env python3
"""把一次真实的 `ai_code.py --mock` 会话录成 README 里的动画 SVG。

为什么自己写而不是用 VHS / asciinema：
它们都要 PTY + ffmpeg（VHS 还要 Docker），本项目核心零依赖，不想为一张图引入这些。
mock 模式本身就是脚本化的离线假模型，输出稳定可复现 —— 正好满足「演示要能重复渲染」。

口径：SVG 里的每一行文字都是子进程真实打印的字节（含真实 ANSI 配色），
唯一的人为补写是「用户敲进去的那一行」—— 管道 stdin 不会回显，
而真实终端会，所以在提示符后面把输入补回去，才是用户实际看到的画面。

用法：
    python demo/record_demo.py              # 重新录制并写出 demo/demo.svg
    python demo/record_demo.py --check      # 只检查现有 SVG 是否还能重现（CI 用）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from xml.sax.saxutils import escape

# 终端编码防线：绝不因为一个字符把一次运行打断（见 core/ace_io.py）
try:
    from core import ace_io as _ace_io
    _ace_io.harden_streams()
except Exception:  # noqa: BLE001 —— 加固失败也要能跑
    pass


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT_SVG = HERE / "demo.svg"
TMP_ROOT = ROOT / ".test_tmp"        # 临时工作目录（gitignore），与 test_all.py 同一取态

# 演示脚本：mock 是两步剧本（工具调用 → 基于结果作答），其余都是本地斜杠命令。
# 不要写"改代码/装依赖"这种 mock 演不出来的台词，演示必须和真实行为一致。
# 两套剧本：happy = 完整闭环；blocked = 让 mock 去读项目外的私钥，被执行层 403 拦下。
SESSIONS = {
    "happy": ["现在几点", "/status", "/permission readonly", "/exit"],
    "blocked": ["帮我读一下 ~/.ssh/id_rsa 里的私钥", "/status", "/exit"],
    # 改动可见：先提权到 write（默认 readonly 下写入要走审批，管道里没法批），
    # 再让 mock 走"建文件 → 改一行"的剧本，卡片里就会带上色的 diff 与一行汇总。
    "diff": ["/permission write", "帮我改代码，往笔记里加一行", "/exit"],
}
SESSION = SESSIONS["happy"]          # main() 会按 --session 覆盖
OUT_SVGS = {"happy": HERE / "demo.svg", "blocked": HERE / "demo_blocked.svg",
            "landing": HERE / "demo_landing.svg", "diff": HERE / "demo_diff.svg"}
OUT_SVG = OUT_SVGS["happy"]          # main() 会按 --session 覆盖
_CURRENT_SESSION = "happy"           # 当前录的是哪套剧本（行数上限等按它取）

# 首屏预览剧本：不走 stdin 打字，而是 `--preview` 只画一遍界面就退出。
# 为什么要单独录一张：首屏是"改没改一眼就知道"的地方，而它只能在真实终端里交互
# 才看得到 —— 有了 --preview，评审不用开终端也能对比。
PREVIEW_ARGV = {"landing": ["--mock", "--preview", "--preview-width", "88"]}

# 「最近会话」面板的固定素材：时间戳**写死**，而且刻意挑**两天前**的日期。
# 为什么不是"现在往前推两小时"、也不是"昨天"：format_when 对"今天/昨天"是相对判断，
# 图里一旦出现"昨天 20:27"，隔一天（或 CI 在别的时区跑）复核就变成"09-18 20:27"，
# --check 立刻误报。两天前一定落到日期分支，永久稳定。
FIXTURE_SESSIONS = [
    ("1789657652000.jsonl", 1789657652, "帮我看看 tools/registry.py 里一共注册了多少个工具"),
    ("1789563720000.jsonl", 1789563720, "把这个月的销售数据导出成一张表"),
]

# 只保留演示需要的行数：/help 那张大表会把画面撑爆，不进脚本。
# 上限要够装下完整一场（清干净的工作目录下约 29 行），否则结尾的 /exit 会被截掉。
# 首屏预览是一整屏（logo + 两个面板 + 分组菜单 + 状态栏示例），单独给一个上限。
MAX_LINES = 32
MAX_LINES_BY_SESSION = {"landing": 46, "diff": 40}
# 输入提示符：v3.6 起是主题色方块 ▊；❯ 是补全菜单不可用时的旧形态。
# 两个都认 —— 改一次提示符就让演示录制失效，是这份脚本最容易腐化的地方。
PROMPTS = ("▊", "❯")

# 一眼能看懂的暗色主题（对比度按 WCAG AA 选的，前景 #d7dce5 / 背景 #11141b）
THEME = {
    "bg": "#11141b", "chrome": "#1b1f29", "fg": "#d7dce5", "dim": "#7d879c",
    "red": "#f2777a", "green": "#5fd68a", "yellow": "#f0c674",
    "blue": "#7aa6f0", "magenta": "#c39ac9", "cyan": "#66cccc",
}
SGR_TO_KEY = {"31": "red", "32": "green", "33": "yellow",
              "34": "blue", "35": "magenta", "36": "cyan", "2": "dim"}

FONT_SIZE = 15
LINE_H = 24
CHAR_W = FONT_SIZE * 0.6          # 等宽西文字符宽度
PAD_X, PAD_TOP = 22, 52           # PAD_TOP 留给窗口栏
CURSOR_LINE_DELAY = 0.75          # 用户输入行之间的停顿，给人"在打字"的节奏
LINE_DELAY = 0.28                 # 普通输出行的间隔
TAIL_PAUSE = 2.6                  # 循环前的停顿，不然看完就闪回开头

_SGR_RE = re.compile(r"\033\[([0-9;]*)m")
# 清屏 / 移光标之类的控制序列（注意排除 m，那是配色，要留给 split_ansi 解析）
_ANSI_OTHER_RE = re.compile(r"\033\[[0-9;]*(?!m)[A-Za-z]")
_SPINNER_GLYPHS = "·˙•◈◐◑◒◓◇◆▁▃▅▇▖▘▝▗"   # ace_spinner 五个阶段的首字形（含工具两阶段）
# 推理阶段换成了**噪声填充**（多格帧，照 `circle-noise-fill.html` 缩到 5 格）。
# 它不能塞进上面那串"单字形"里：`^[字形]\s` 这种匹配是按"一个字形 + 空格"写的，
# 5 格宽的一帧会让第二条字符是 `·`/`█` 而不是空格 ⇒ 永远匹配不上 ⇒ 演示图里
# 会留下**取决于采集时机**的帧（正是这套归一化要消灭的东西）。
_NOISE_FRAMES = ("·····", "···██", "··███", "█████")
_NOISE_CANON = "█████"              # 多格帧一律收敛到"填满"那一帧
_SPINNER_RE = re.compile(r"^(?:[%s]|%s)\s"
                         % (_SPINNER_GLYPHS, "|".join(re.escape(f) for f in _NOISE_FRAMES)))
# 归一表：同一阶段的字形收敛到一个代表字形。**不含 waiting 那三个点** ——
# `·` 也是正文里常见的项目符号，按转轮处理会把正常行的颜色剥掉。
_SPINNER_CLASS = {"◐": "◐", "◑": "◐", "◒": "◐", "◓": "◐",
                  "◈": "◈", "◇": "◈", "◆": "◈",
                  "▁": "▅", "▃": "▅", "▇": "▅",
                  "▖": "▘", "▝": "▘", "▗": "▘"}


def _canon_spinner(line: str) -> str:
    """转轮帧 → 稳定形态：字形归一到阶段代表，颜色段整段去掉。

    为什么必须归：动到第几帧、以及"卡住"渐变到哪个色号，都由**采集时机**决定
    （Windows 本机与 CI 的耗时不同），不是会话内容。不归的话，`--check` 会把
    "这次等了 12 秒还是 9 秒"报成"CLI 输出变了"，而真正的漂移反而淹在噪声里。
    这条是 2026-09-19 那次 CI 红换来的：录制时是主题色，CI 上是渐变到一半的告警色。
    """
    plain = _SGR_RE.sub("", line)
    if not plain:
        return line
    for f in _NOISE_FRAMES:                 # 多格帧：整段替换，不能只看首字符
        if plain.startswith(f + " "):
            return _NOISE_CANON + plain[len(f):]
    if plain[0] not in _SPINNER_CLASS:
        return line
    return _SPINNER_CLASS[plain[0]] + plain[1:]



def _load_display_width():
    """按文件路径加载 `ui/ace_text.display_width`。

    与 project_version() 同一套做法、同一个理由：脚本以 `demo/` 为 `sys.path[0]`，
    仓库根不在路径上；按文件路径加载既保持"宽度只有一处口径"的纪律，又不给这份
    演示脚本引入 sys.path 手术。（此前这里自己写了一份 CJK 宽度算法，与卡片那边
    各算各的 —— 同一件事两个口径迟早会漂。）
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("_ace_text", ROOT / "ui" / "ace_text.py")
    if spec is None or spec.loader is None:
        raise SystemExit("读不到 ui/ace_text.py，无法计算画布宽度")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.display_width


display_width = _load_display_width()


def _seed_sessions(work: Path) -> None:
    """给首屏预览铺两份固定的会话日志（时间戳写死，见 FIXTURE_SESSIONS）。

    只写 user/assistant 事件就够了：`list_sessions()` 数的是 user 事件，首句取第一条。
    """
    sess = work / ".ace_sessions"
    sess.mkdir(parents=True, exist_ok=True)
    for name, mtime, first in FIXTURE_SESSIONS:
        p = sess / name
        events = [
            {"seq": 1, "kind": "user/message", "ts": "2026-09-18 20:27:32",
             "content": first},
            {"seq": 2, "kind": "assistant/message", "ts": "2026-09-18 20:27:40",
             "content": "（演示用固定素材）"},
        ]
        p.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events),
                     encoding="utf-8")
        os.utime(p, (mtime, mtime))


def _fold_path(raw: str, form: str) -> str:
    """把出现过的绝对路径折叠成 `…`。

    **保宽还是折成一列，取决于该路径是不是被补齐到框宽** —— 这两种情况各有一个必须满足的
    约束，用同一种做法都会坏掉一个：

    - **框内行**（路径后面只剩补白与右边框 `│`）：必须**保持显示宽度**。面板是按真实路径
      算好补白的，直接换成 1 列的 `…` 会让这一行比同框其它行短掉（路径长度 - 1）列 ——
      已提交的 demo.svg 里「当前会话」那个框就是这样缺了一角（其余行 96 列，`目录` 行 28 列）。
    - **自由行**（路径后面还有别的文本，或路径就在行尾）：必须**折成 1 列**。这类行的宽度
      本身就是"前缀 + 路径 + 后缀"，保宽等于把机器上的路径长度留在图里；例如
      `知识库: <项目>/.ace_kb` —— 保宽会把补白插进路径中间，变成
      `知识库: …<一堆空格>\\.ace_kb`，既难看又随路径长度变。

    路径长度因此不再左右 SVG（`--check` 才能跨机器成立），框也保持满宽。
    """
    out, i, n = [], 0, len(form)
    keep_width = display_width(form) - 1
    while True:
        j = raw.find(form, i)
        if j < 0:
            out.append(raw[i:])
            return "".join(out)
        out.append(raw[i:j])
        line_end = raw.find("\n", j)
        tail = raw[j + n:line_end if line_end >= 0 else len(raw)]
        # 判"框内行"要先剥 ANSI：边框前后总带 SGR 重置（`\x1b[0m│`），不剥就永远判不出来，
        # 于是框内行走了折成一列那条路 —— 框重新缺角，且宽度又随路径长度变。
        tail_plain = _ANSI_OTHER_RE.sub("", _SGR_RE.sub("", tail))
        out.append("…" + " " * keep_width if tail_plain.strip() == "│" else "…")
        i = j + n


def capture_session(name: str = "happy") -> str:
    """真的把 CLI 跑起来，拿它打印的原始字节（含 ANSI）。

    跑在**临时工作目录 + 临时 HOME** 里，让录制与录制者的机器状态无关：
    否则会把 ~/.ai_code.json、`.ace_sessions/`（"已恢复上次会话"）、`.ace_kb`
    的绝对路径、`.guardian` 快照数一并录进 README 首屏 —— 既泄露本机路径，
    也让 --check 换台机器就必然失败。

    临时目录落仓库内 `.test_tmp/`（gitignore）而不是系统临时区：受限环境下
    系统 temp 常常不可写（与 test_all.py 同一取态）。注意用 `mkdir(parents=True)`
    而不是 `tempfile.mkdtemp` —— 后者建的目录在本机连子目录都写不进去。
    """
    TMP_ROOT.mkdir(exist_ok=True)
    tmp = TMP_ROOT / f"demo_{uuid.uuid4().hex[:8]}"
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        work, home = tmp / "project", tmp / "home"
        work.mkdir()
        home.mkdir()
        env = dict(os.environ)
        env["FORCE_COLOR"] = "1"          # 管道下强制上色，见 ai_code.py 的 USE_COLOR
        env.pop("NO_COLOR", None)
        # 钉死"终端是 UTF-8"：否则 `ui/ace_home` 的选中标记 `▶` 会在 cp936 控制台上降级
        # 成 `>`（core/ace_io.ASCII_FALLBACK），同一份演示在 Windows 与 CI 上录出两张图，
        # `--check` 跨平台必然对不上（2026-10-06 CI #273 就是这么红的）。
        env["ACE_DISPLAY_ENCODING"] = "utf-8"
        env["PYTHONIOENCODING"] = "utf-8"
        env["HOME"] = env["USERPROFILE"] = str(home)   # 不读录制者的 ~/.ai_code.json
        env.pop("HOMEDRIVE", None)
        env.pop("HOMEPATH", None)
        # 平台状态目录也要搬进临时 HOME。只搬 HOME 在 Linux 上够（Path.home() 认 $HOME），
        # 在 Windows 上不够：签名锚（RG-01）读的是 %LOCALAPPDATA% —— 于是同一份演示在两个
        # 平台录出两张不同的图：Windows 上锚落在**录制者自己的** AppData 里，建不出来 →
        # 写路径 fail-close → `diff` 那张录到的是一条 403，还把录制者的真实路径印进了
        # 发布出去的 SVG（而且 CI 上必然对不上）。2026-09-26 发布 v3.43.0 时就是这么红的。
        for _var, _sub in (("LOCALAPPDATA", "AppData/Local"), ("APPDATA", "AppData/Roaming"),
                           ("XDG_STATE_HOME", ".local/state"), ("XDG_CACHE_HOME", ".cache")):
            env[_var] = str(home / _sub)
        argv = PREVIEW_ARGV.get(name)
        if argv is not None:
            _seed_sessions(work)          # 让「最近会话」面板有确定的素材
        proc = subprocess.run(
            [sys.executable, str(ROOT / "ai_code.py")] + (argv or ["--mock"]),
            input=("" if argv is not None else "\n".join(SESSION) + "\n"),
            cwd=str(work), env=env, text=True, encoding="utf-8",
            capture_output=True, timeout=120,
        )
        if proc.returncode != 0:
            raise SystemExit(f"录制失败（退出码 {proc.returncode}）:\n{proc.stderr[-2000:]}")
        raw = proc.stdout
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # 临时目录/临时 home 的绝对路径一律折叠成占位符：SVG 里不留任何本机路径。
    # 分隔符统一成 "/" —— 否则 Windows 录的 "…\.ace_kb" 与 Linux CI 的 "…/.ace_kb"
    # 对不上，--check 会在 CI 上误报。
    # 折叠的两种口径（保宽 / 折成一列）与各自的理由见 `_fold_path` 的 docstring ——
    # 这里曾经一律折成一个 `…`，代价是：① 发布出去的图里那个框缺一角；② 路径长度
    # （本机 50 列、CI 69 列）以补白形式留在 SVG 里，`--check` 在 CI 上必然对不上。
    for path in (work, home):
        for form in (str(path), path.as_posix()):
            raw = _fold_path(raw, form)
    return raw.replace("…\\", "…/")


def to_transcript(raw: str) -> list[tuple[str, bool]]:
    """原始输出 → [(带 ANSI 的一行, 是否是用户输入行)]。

    做四件事：折叠 \\r（转轮动画只留最后一帧）、丢掉管道模式独有的噪声行、
    把「提示符 + 紧跟其后的输出」拆成两行并补回用户敲的内容、合并重复的转轮帧。

    提示符是 print(..., end="") 打出来的，管道里它和后面的输出粘在同一物理行；
    真实终端上用户先看到 "▊ 我敲的字"，回车后输出才另起一行 —— 拆开才还原真实画面。
    """
    typed = list(SESSION)
    out: list[tuple[str, bool]] = []

    def push(line: str, is_input: bool = False) -> None:
        plain = _SGR_RE.sub("", line).strip()
        if not plain:
            if not out or out[-1][0] == "":
                return                                     # 不留连续空行 / 开头空行
            out.append(("", False))
            return
        if "非交互终端" in plain or "补全菜单不可用" in plain:
            return                                          # 只有管道录制才有，真实终端没有
        if _SPINNER_RE.match(plain):
            line = _canon_spinner(line)                     # 帧号/渐变色都不进演示图
        if out and _SPINNER_RE.match(plain) and _SPINNER_RE.match(
                _SGR_RE.sub("", out[-1][0]).strip()):
            out[-1] = (line, False)                         # 同一段转轮动画只留最后一帧
            return
        out.append((line, is_input))

    for physical in raw.replace("\r\n", "\n").split("\n"):
        line = _ANSI_OTHER_RE.sub("", physical.split("\r")[-1].rstrip())
        plain = _SGR_RE.sub("", line)
        hit = next((p for p in PROMPTS if plain.lstrip().startswith(p)), None)
        if hit:
            if not typed:
                continue
            push(f"{hit} {typed.pop(0)}", is_input=True)
            idx = line.find(hit) + len(hit)
            push(line[idx:].lstrip())                       # 提示符后面粘着的那段输出
            continue
        push(line)

    while out and out[-1][0] == "":
        out.pop()
    return out[:MAX_LINES_BY_SESSION.get(_CURRENT_SESSION, MAX_LINES)]



def split_ansi(line: str) -> list[tuple[str, str]]:
    """ANSI 行 → [(文本, 颜色 key)]，只认本项目用到的那几个 SGR。"""
    spans: list[tuple[str, str]] = []
    color = "fg"
    pos = 0
    for m in _SGR_RE.finditer(line):
        if m.start() > pos:
            spans.append((line[pos:m.start()], color))
        codes = [c for c in m.group(1).split(";") if c]
        if not codes or "0" in codes:
            color = "fg"
        else:
            for code in codes:
                if code in SGR_TO_KEY:
                    color = SGR_TO_KEY[code]
        pos = m.end()
    if pos < len(line):
        spans.append((line[pos:], color))
    return [(t, c) for t, c in spans if t]


def build_svg(transcript: list[tuple[str, bool]]) -> str:
    cols = max((display_width(_SGR_RE.sub("", ln)) for ln, _ in transcript), default=60)
    width = int(PAD_X * 2 + max(cols, 62) * CHAR_W)
    height = int(PAD_TOP + len(transcript) * LINE_H + 22)

    # 时间轴：输入行停久一点，输出行连着走
    times, clock = [], 0.6
    for _, is_input in transcript:
        times.append(clock)
        clock += CURSOR_LINE_DELAY if is_input else LINE_DELAY
    total = clock + TAIL_PAUSE

    rules, body = [], []
    for i, ((line, is_input), t0) in enumerate(zip(transcript, times)):
        pct = max(0.0, min(99.9, t0 / total * 100))
        # 每行一条 keyframes：到点显形、留到循环末尾。比 animation-delay 更可控，
        # 也能干净地无限循环（delay 方案在循环边界会闪）。
        rules.append(f"@keyframes s{i}{{0%,{pct:.3f}%{{opacity:0}}"
                     f"{pct + 0.001:.3f}%,100%{{opacity:1}}}}")
        rules.append(f".r{i}{{animation:s{i} {total:.2f}s steps(1,end) infinite}}")
        y = PAD_TOP + i * LINE_H
        tspans = "".join(
            f'<tspan fill="{THEME[key]}">{escape(text)}</tspan>'
            for text, key in split_ansi(line)
        ) or "&#160;"
        cursor = (f'<tspan class="cur" fill="{THEME["magenta"]}">&#9601;</tspan>'
                  if is_input else "")
        body.append(f'<text class="r{i}" x="{PAD_X}" y="{y}" xml:space="preserve">'
                    f'{tspans}{cursor}</text>')

    dots = "".join(
        f'<circle cx="{22 + n * 18}" cy="20" r="5.5" fill="{col}"/>'
        for n, col in enumerate(("#ff5f57", "#febc2e", "#28c840"))
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" \
viewBox="0 0 {width} {height}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,\
'DejaVu Sans Mono','Noto Sans Mono CJK SC',monospace" font-size="{FONT_SIZE}">
<style>
text{{white-space:pre;dominant-baseline:middle}}
{chr(10).join(rules)}
.cur{{animation:blink 1.05s steps(1,end) infinite}}
@keyframes blink{{0%,49%{{opacity:1}}50%,100%{{opacity:0}}}}
</style>
<rect width="{width}" height="{height}" rx="10" fill="{THEME['chrome']}"/>
<rect y="40" width="{width}" height="{height - 40}" fill="{THEME['bg']}"/>
{dots}
<text x="{width / 2}" y="21" text-anchor="middle" font-size="12.5" \
fill="{THEME['dim']}">hooh-agent — python ai_code.py --mock</text>
{chr(10).join(body)}
</svg>
"""


def _mismatch_report(names: str, fresh: str, old: str) -> str:
    """差异摘要：CI 上这张图对不上时，日志里得看得出**是哪几行**变了。

    为什么需要：`--check` 只在 CI（Linux/3.12）跑，本地（Windows）重放会通过 ——
    平台上真的不一样时，只有一行"请重新录制"等于什么都没说，而 GitHub 上拿不到
    带认证的日志。所以把前几处差异主动打成 `::error::` 注解：注解不需要登录就能读。
    数字已归一化（与判定同源），避免时间戳把真正的差异淹掉。
    """
    _norm = lambda s: re.sub(r"[\d.]+", "#", s)      # noqa: E731 —— 与判定同一口径
    a, b = _norm(old).splitlines(), _norm(fresh).splitlines()
    bad = [(i, x, y) for i, (x, y) in enumerate(zip(a, b)) if x != y][:3]
    if not bad and len(a) != len(b):
        bad = [(min(len(a), len(b)), f"<共 {len(a)} 行>", f"<共 {len(b)} 行>")]
    bits = [f"L{i}: 录制={x.strip()[:110]!r} 现在={y.strip()[:110]!r}"
            for i, x, y in bad]
    return f"{names} 骨架不一致（{len(bad)} 处，最多列 3 处）: " + " | ".join(bits)


def svg_version(svg_text: str) -> str | None:
    """图里印的版本号；取不到返回 None。

    三种横幅形态都要认：聊天图是 `X.Y.Z · 互`，会话面板与首屏是 `vX.Y.Z`，
    主页顶行是 `HooH X.Y.Z · 模型 · 权限`。**抽成函数**是因为 test_all.py 的 [68] 段要用
    同一口径在本地也钉一遍 —— 正则抄第二份，就是给自己埋"改了一处漏另一处"。
    """
    m = (re.search(r">\s*([0-9]+\.[0-9]+\.[0-9]+) · 互<", svg_text)
         or re.search(r"v([0-9]+\.[0-9]+\.[0-9]+)", svg_text)
         or re.search(r"HooH\s+v?([0-9]+\.[0-9]+\.[0-9]+)", svg_text))
    return m.group(1) if m else None


def project_version() -> str:
    """读版本单源（`core/version.py`）。

    不能用 `import core.version`：脚本以 `demo/` 为 `sys.path[0]`，仓库根不在路径上。
    按文件路径加载既保持"版本只有一处"的纪律，又不给这份演示脚本引入 sys.path 手术。
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location("_ace_version", ROOT / "core" / "version.py")
    if spec is None or spec.loader is None:
        raise SystemExit("读不到 core/version.py，无法校验演示图里的版本号")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return str(mod.__version__)


def main() -> None:
    ap = argparse.ArgumentParser(description="录制 hooh-agent 演示动画（SVG）")
    ap.add_argument("--check", action="store_true",
                    help="校验现有 SVG 能否原样重现（不带 --session 时逐个校验全部）")
    ap.add_argument("--session", choices=sorted(set(SESSIONS) | set(PREVIEW_ARGV)),
                    default=None,
                    help="剧本：happy（默认，完整闭环）/ blocked（越界读取被执行层拦下）"
                         "/ landing（首屏预览，--preview 画的静态界面）")
    args = ap.parse_args()

    global SESSION, OUT_SVG, _CURRENT_SESSION
    if args.session:
        targets = [args.session]
    elif args.check:
        targets = sorted(set(SESSIONS) | set(PREVIEW_ARGV))   # CI 走的这条：三套全校验
    else:
        targets = ["happy"]             # 录制默认只重录主剧本，其余用 --session 指定

    for name in targets:
        _CURRENT_SESSION = name
        SESSION = SESSIONS.get(name, [])
        OUT_SVG = OUT_SVGS[name]
        transcript = to_transcript(capture_session(name))
        if not transcript:
            raise SystemExit(f"录制到的会话是空的（{name}），脚本或 CLI 输出可能变了")
        svg = build_svg(transcript)

        if args.check:
            if not OUT_SVG.exists():
                raise SystemExit(f"{OUT_SVG} 不存在，先跑一次不带 --check 的录制")
            old_svg = OUT_SVG.read_text(encoding="utf-8")
            # 时间戳会变（mock 会问当前时间），只比结构：行数与去掉数字后的骨架
            if re.sub(r"[\d.]+", "#", svg) != re.sub(r"[\d.]+", "#", old_svg):
                _why = _mismatch_report(OUT_SVG.name, svg, old_svg)
                # GitHub 注解：CI 上失败时不用登录也能读到这里说的"哪几行变了"
                print(f"::error title=demo-skeleton-mismatch::{_why}")
                raise SystemExit(f"{OUT_SVG.name} 与当前 CLI 输出不一致，请重新录制。{_why}")
            # 骨架比对把数字都归一化了，版本号会因此**静默过期**（改版本后这张图看着还"一致"）。
            # 单列一条：图里印的版本必须等于 core/version.py。
            shown = svg_version(old_svg)
            if not shown:
                raise SystemExit(f"{OUT_SVG.name} 里找不到版本号横幅，录制格式可能变了")
            if shown != project_version():
                raise SystemExit(
                    f"{OUT_SVG.name} 里的版本号是 {shown}，而 core/version.py 是 "
                    f"{project_version()} —— 重新录制这张图")
            print(f"{OUT_SVG.name} 与当前 CLI 输出一致（{name}，v{shown}）")
            continue

        OUT_SVG.write_text(svg, encoding="utf-8")
        print(f"已写出 {OUT_SVG.relative_to(ROOT)}（{name}，{len(transcript)} 行）")



if __name__ == "__main__":
    main()
