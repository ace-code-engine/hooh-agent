#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""setup_env —— 给 ACE 找一个"能用的" Python 环境（找不到就自己建一个）

为什么需要它：交互体验有一半挂在 `prompt_toolkit` 上（浮层菜单、历史、底部状态栏）。
此前用户的遭遇是"菜单不好用、没安装" —— 因为他跑的 `python` 不是装了依赖的那个。
把"用哪个解释器"交给用户去猜，等于让功能取决于运气。

这里的规矩是**多环境 + 说实话**：
1. 依次试候选解释器（`ACE_PYTHON` → 项目内 `.ace_env` → 本机常见开发环境 → PATH 上的
   `python`/`python3` → `py -3`），返回**第一个真的能 import prompt_toolkit** 的那个；
2. 一个都没有 → 在项目下建 `.ace_env`，然后按顺序装依赖：
   **本地 wheel（`vendor/*.whl`，离线可用）→ pip 在线装**；
3. 失败就如实报错并给出可复制的命令，绝不假装成功（"看着像装好了"是最坏的结果）。

输出是**给脚本消费的**：`--print-python` 只打印一行解释器路径，`ace.cmd` 直接用它。
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# 终端编码防线：绝不因为一个字符把一次运行打断（见 core/ace_io.py）
try:
    from core import ace_io as _ace_io
    _ace_io.harden_streams()
except Exception:  # noqa: BLE001 —— 加固失败也要能跑
    pass


HERE = Path(__file__).resolve().parent
ENV_DIR_NAME = ".ace_env"
VENDOR_DIR_NAME = "vendor"
# 界面依赖：prompt_toolkit（普通 REPL 的输入行/浮层菜单）。
# 引擎界面（默认那条）走 ui/ace_prompt 的零依赖输入层，不需要任何第三方界面库 ——
# 原来列在这里的 textual / rich 随 `tui/` 一起删掉了（见 docs/TUI-ENGINE.md 第五节）。
# requests 不一样 —— 它是**模型调用的硬依赖**
# （core/ace_http.request_with_retry 唯一出网点，直接 import requests，无回退），
# 所以列在这里：启动器必须把它装上，否则装完 UI 也连不上模型（H-22）。
REQUIRED = ("requests", "prompt_toolkit")
# `--vendor` 用的解析参数：让 pip 把整棵依赖树解成**平台中立**的 `py3-none-any` wheel，
# 而不是按"跑这条命令的那台机器"解。
#
# 为什么必须这么做：这份集合是**要提交进仓库**的，给 Linux/macOS 与 3.10~3.13 共用。
# 实测在 Windows + CPython 3.13 上直接 `pip download requests` 会把 charset-normalizer
# 下成 `charset_normalizer-3.5.1-cp313-cp313-win_amd64.whl`，而仓库里原有的 11 个 wheel
# 全是 py3-none-any —— 于是"离线包"会**悄悄退化成只对导出它的那台机器有效**。
# 注意：部分镜像源不支持这套 tag（实测清华镜像直接报 "from versions: none"），
# 所以 `vendor_into()` 在全部源都失败后会退回普通下载，并明确把"非平台中立"说出来。
NEUTRAL_TAGS = ("--only-binary=:all:", "--platform", "any",
                "--implementation", "py", "--abi", "none",
                "--python-version", "3.10")
# 索引顺序：**官方源优先**，镜像兜底。踩过的坑：某些镜像会返回 "from versions: none"
# （包索引不完整），于是"装不上"被误判成"没有网络"；换官方源立刻就装上了。
INDEXES = ("https://pypi.org/simple",
           "https://pypi.tuna.tsinghua.edu.cn/simple")
CHECK_TIMEOUT = 20


def env_dir(root: Optional[Path] = None) -> Path:
    """本地虚拟环境目录（可用 `ACE_ENV_DIR` 换到别处，支持多套环境并存）。"""
    override = os.environ.get("ACE_ENV_DIR")
    if override:
        return Path(override).expanduser()
    return (root or HERE) / ENV_DIR_NAME


def venv_python(venv: Path) -> Optional[Path]:
    """虚拟环境里的解释器路径（Windows 与 POSIX 两套布局都认）。"""
    for rel in ("Scripts/python.exe", "Scripts/pythonw.exe", "bin/python3", "bin/python"):
        cand = venv / rel
        if cand.is_file():
            return cand
    return None


def candidate_interpreters(root: Optional[Path] = None) -> List[Tuple[str, str]]:
    """候选解释器 `[(来源说明, 路径/命令)]`，按"越靠近本项目越优先"排序。

    POSIX 上给的是命令名（`python3`），Windows 上给绝对路径 —— 两条路径都交给
    `subprocess` 直接跑，不做 shell 解析。
    """
    out: List[Tuple[str, str]] = []
    explicit = os.environ.get("ACE_PYTHON")
    if explicit:
        out.append(("ACE_PYTHON", explicit))
    local = venv_python(env_dir(root))
    if local is not None:
        out.append(("项目内 .ace_env", str(local)))
    if os.name == "nt":
        for p in (r"C:\aider_env\Scripts\python.exe",
                  os.path.expanduser(r"~\AppData\Local\Programs\Python")):
            if os.path.isfile(p):
                out.append(("本机常见环境", p))
    for name in ("python3", "python"):
        found = shutil.which(name)
        if found:
            out.append((f"PATH 上的 {name}", found))
    if os.name == "nt" and shutil.which("py"):
        out.append(("py -3 启动器", "py"))
    seen: set = set()
    uniq: List[Tuple[str, str]] = []
    for src, path in out:
        key = os.path.abspath(path) if os.path.isfile(path) else path
        if key in seen:
            continue
        seen.add(key)
        uniq.append((src, path))
    return uniq


def probe(python: str, imports: Tuple[str, ...] = REQUIRED,
          timeout: int = CHECK_TIMEOUT) -> bool:
    """这个解释器能不能起来 / 能不能 import 指定模块（跑一次子进程，不做猜测）。

    `imports` 为空 = 只验证"解释器本身能不能用"（`python -c pass`）—— 空元组不能拼成
    `import ` 那种语法错，否则一个可用的解释器会被判成不可用（测试当场抓到过）。
    """
    code = ("import " + ", ".join(imports)) if imports else "pass"
    cmd = [python, "-c", code]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    except Exception:  # noqa: BLE001 —— 起不来就当他没有
        return False
    return proc.returncode == 0


def version_of(python: str) -> str:
    """解释器版本（拿不到就返回空串，不编）。"""
    try:
        proc = subprocess.run([python, "-c",
                               "import sys;print('.'.join(map(str, sys.version_info[:3])))"],
                              capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=CHECK_TIMEOUT)
        return proc.stdout.strip() if proc.returncode == 0 else ""
    except Exception:  # noqa: BLE001
        return ""


def find_ready(root: Optional[Path] = None) -> Optional[Tuple[str, str]]:
    """返回 `(来源, 解释器)`：第一个装了界面依赖的候选；都没有就 None。"""
    for src, path in candidate_interpreters(root):
        if probe(path):
            return src, path
    return None


def vendor_wheels(root: Optional[Path] = None) -> List[str]:
    """`vendor/*.whl`：离线安装用的本地轮子（有就优先用，没有就联网装）。"""
    base = (root or HERE) / VENDOR_DIR_NAME
    return sorted(glob.glob(str(base / "*.whl")))


def _run(cmd: List[str], timeout: int = 300) -> Tuple[int, str]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except Exception as e:  # noqa: BLE001
        return 1, f"{type(e).__name__}: {e}"


def create_env(root: Optional[Path] = None, base_python: Optional[str] = None,
               log=print) -> Tuple[Optional[str], str]:
    """建 `.ace_env` 并装依赖 → `(解释器路径 或 None, 说明)`。

    安装顺序（**离线优先，因为仓库里就带着 wheel**）：
      1. `vendor/*.whl`（`--no-index`，完全不联网）；
      2. 在线 pip：按 `INDEXES` 逐个试（官方源优先，镜像兜底）。
    两条都不成就返回失败原因，调用方据此如实告诉用户（并给出可复制的命令）。
    """
    root = root or HERE
    target = env_dir(root)
    base = base_python or sys.executable
    if not probe(base, ()):                      # 连 python 都跑不动就别往下走了
        return None, f"基础解释器不可用: {base}"
    log(f"  · 建虚拟环境: {target}")
    code, out = _run([base, "-m", "venv", str(target)])
    if code != 0:
        return None, f"venv 创建失败: {out.strip()[:200]}"
    py = venv_python(target)
    if py is None:
        return None, "虚拟环境里没有解释器（布局不符合预期）"
    wheels = vendor_wheels(root)
    if wheels:
        log(f"  · 用仓库自带的 wheel 离线安装（{len(wheels)} 个）")
        code, out = _run([str(py), "-m", "pip", "install", "--no-index",
                          "--disable-pip-version-check", *wheels])
        if code == 0 and probe(str(py)):
            return str(py), "已用仓库自带的 wheel 装好（未联网）"
        log(f"  · 本地 wheel 没装成（{out.strip()[:120]}），改走在线安装")
    for index in INDEXES:
        log(f"  · 在线安装（{index}）: pip install {' '.join(REQUIRED)}")
        code, out = _run([str(py), "-m", "pip", "install", "--disable-pip-version-check",
                          "--index-url", index, *REQUIRED])
        if code == 0 and probe(str(py)):
            return str(py), f"已在线装好（源: {index}）"
    return None, (f"pip 安装失败（试过 {len(INDEXES)} 个源）: {out.strip()[:200]}\n"
                  f"    可手动执行: \"{py}\" -m pip install "
                  f"--index-url {INDEXES[0]} {' '.join(REQUIRED)}")


def vendor_into(root: Optional[Path] = None, log=print) -> Tuple[int, str]:
    """把运行依赖的 wheel 下载到 `vendor/`（**给离线机器准备内置环境**）。

    这是"内置好环境"的正路：在一台能联网的机器上跑一次，把 wheel 提交进仓库，
    之后任何机器 `python setup_env.py --ensure` 都能离线装好。

    只用**平台中立**（`py3-none-any`）的 wheel，见 `NEUTRAL_TAGS` 的说明 ——
    这份集合要跨平台、跨 Python 版本共用，不能按导出它的那台机器解析。
    镜像源不支持这套 tag 时退回普通下载，并在返回值里**明说**产物只对本平台有效。
    """
    root = root or HERE
    dest = (root) / VENDOR_DIR_NAME
    dest.mkdir(parents=True, exist_ok=True)
    base = sys.executable
    last = ""
    for index in INDEXES:
        log(f"  · 从 {index} 下载平台中立的 wheel 到 {dest}")
        code, out = _run([base, "-m", "pip", "download", "--index-url", index,
                          *NEUTRAL_TAGS, "-d", str(dest), *REQUIRED], timeout=900)
        if code == 0:
            return len(vendor_wheels(root)), f"已下载到 {dest}（源: {index}，平台中立 py3-none-any）"
        last = out.strip()[-200:]
    for index in INDEXES:
        log(f"  · 该源不支持平台中立解析，退回普通下载（{index}）")
        code, out = _run([base, "-m", "pip", "download", "--index-url", index,
                          "-d", str(dest), *REQUIRED], timeout=900)
        if code == 0:
            return len(vendor_wheels(root)), (
                f"已下载到 {dest}（源: {index}） —— ⚠ **非平台中立**，"
                "只对导出它的平台与 Python 版本有效")
        last = out.strip()[-200:]
    return 0, f"下载失败: {last}"


def ensure(root: Optional[Path] = None, allow_create: bool = True, log=print
           ) -> Dict[str, object]:
    """找环境 → 找不到就建 → 返回结果字典（**机器可读**，便于脚本与断言）。

    返回：`{"python": 路径或 "",
            "source": "ACE_PYTHON/项目内 .ace_env/PATH.../新建/无",
            "created": bool, "note": 说明, "candidates": [...]}`。
    """
    root = root or HERE
    ready = find_ready(root)
    if ready is not None:
        src, path = ready
        return {"python": path, "source": src, "created": False,
                "note": f"界面依赖已就绪（{version_of(path)}）",
                "candidates": candidate_interpreters(root)}
    cands = candidate_interpreters(root)
    if not allow_create:
        return {"python": "", "source": "无", "created": False,
                "note": "没有找到装了界面依赖的解释器（未尝试创建）",
                "candidates": cands}
    base = cands[0][1] if cands else sys.executable
    if base == "py":
        base = "py"
    log("  没有找到装了界面依赖的解释器，就地建一个：")
    path, note = create_env(root, base_python=base, log=log)
    return {"python": path or "", "source": "新建" if path else "无",
            "created": bool(path), "note": note,
            "candidates": candidate_interpreters(root)}


def main() -> int:
    ap = argparse.ArgumentParser(description="给 ACE 找一个能用的 Python 环境")
    ap.add_argument("--print-python", action="store_true",
                    help="只打印可用解释器路径（供启动脚本消费；没找到则为空行）")
    ap.add_argument("--check", action="store_true", help="只看状态，不创建环境")
    ap.add_argument("--ensure", action="store_true", help="缺失时创建 .ace_env 并安装")
    ap.add_argument("--vendor", action="store_true",
                    help="把界面依赖的 wheel 下载到 vendor/（给离线机器准备内置环境）")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出结果（脚本用）")
    args = ap.parse_args()

    root = HERE
    if args.vendor:
        count, note = vendor_into(root)
        print(f"vendor/: {count} 个 wheel · {note}")
        return 0 if count else 1
    if args.print_python:
        ready = find_ready(root)
        print(ready[1] if ready else "")
        return 0 if ready else 1
    result = ensure(root, allow_create=bool(args.ensure) and not args.check)
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["python"] else 1
    print(f"解释器: {result['python'] or '（没找到）'}")
    print(f"来源  : {result['source']}")
    print(f"说明  : {result['note']}")
    for src, path in result.get("candidates", []):  # type: ignore[union-attr]
        mark = "✓" if probe(str(path)) else "·"
        print(f"  {mark} {src:<18}{path}")
    if not result["python"]:
        print("提示: 运行 `python setup_env.py --ensure` 会自动建 .ace_env 并装依赖；"
              "离线环境可以把 wheel 放进 vendor/ 再跑。")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
