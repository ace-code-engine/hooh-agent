#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""dsh_bridge_setup —— 把「HooH × dsh-TUI」这一套配好（**幂等**，随时可重复跑）

做两件事（都能单独关掉）：

1. **注册 ace 路由**：往 `$DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers` 里加一条
   `ace` —— 指向 `tools/ace_openai_proxy.py` 起的本地端点。格式照抄用户已有的
   `workbuddy` 那条（同一份 schema：route 名不是内置 provider 时必须自带 `api` +
   `baseURL` + `models`；`apiKeyEnv` 可省，所以**不用动 `.credentials.yaml`**）。
   现有 settings.yaml 不存在时，**先拿 `settings.yaml.imported` 当底**，
   免得把已经配好的 workbuddy 顶掉。

2. **换品牌**：dsh-TUI 的开屏大字与鲸鱼是它自己的资产。HooH 用它当壳时：
   - `splashFonts.js` 里 `TOP_WORD/BOTTOM_WORD`（`DEEPSEEK`/`HARNESS`）→ `HooH` + 空；
   - `LogoV2.js` 的 `✦ dsh-TUI` → `✦ HooH`、纯文字档 `DeepSeek Harness` → `HooH`；
   - `settings.yaml` 里 `dsh-tui.whale: false` 撤掉像素鲸鱼。
   改的是**装好的 npm 包**，所以 `dsh-tui` 升级/重装会把品牌改回来 —— 重跑本脚本即可
   （`--check` 会说清楚现在是什么状态）。原文件留一份 `.hooh-bak`。

用法：
    python tools/dsh_bridge_setup.py            # 配好（幂等）
    python tools/dsh_bridge_setup.py --check    # 只看状态，什么都不写
    python tools/dsh_bridge_setup.py --revert   # 只回退品牌（settings 里的路由留着）
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

DSH_HOME = Path.home() / ".dsh"
# **设置文件在 profile 的 home 里，不在 DSH_HOME**：`dsh-settings/index.js` 的
# `importLegacyDocument()` 读 `join(profile.home, 'settings.yaml')`，启动时把它改名成
# `.imported` 并逐节导入该 profile 的设置存储。第一版我写到 `~/.dsh/settings.yaml` ——
# 那是 **cli** profile 的 home（`~/.dsh/profiles/cli/`），dsh-tui 一个字都看不到，
# 于是"路由没出现、鲸鱼还在"。写到 profile 里，**下次启动 dsh-tui 自动导入**。
PROFILE_HOME = DSH_HOME / "profiles" / "dsh-tui"
SETTINGS = PROFILE_HOME / "settings.yaml"
LEGACY_SETTINGS = DSH_HOME / "settings.yaml"          # 我第一版写错的位置（要清掉）
IMPORTED = DSH_HOME / "settings.yaml.imported"
TUI_PKG = PROFILE_HOME / "node_modules" / "@deepseek-harness-tui" / "dsh-tui"
FONTS = TUI_PKG / "lib" / "types" / "components" / "splashFonts.js"
LOGO = TUI_PKG / "lib" / "types" / "components" / "LogoV2.js"

PROVIDER_BLOCK = """    ace:
      displayName: HooH (ace engine)
      # 本地端点：tools/ace_openai_proxy.py（`ace proxy`）。鉴权 token 走
      # ACE_PROXY_KEY 环境变量（`ace proxy --show-key` 打印；值来自锚式目录，
      # 跨启动稳定）。dsh 把它以 Authorization: Bearer 发给端点 ——
      # 端点不认 Anonymous（WP-AGENCY 加固后本机任意进程/网页也不能白嫖引擎）。
      api: openai-completions
      baseURL: {base_url}
      apiKeyEnv: ACE_PROXY_KEY
      models:
        - id: "{model}"
          name: "HooH"
          contextWindow: 200000
          maxTokens: 32768
          input:
            - text
"""

WHALE_BLOCK = """
# HooH: 撤掉开屏的像素鲸鱼，只留大字标题（`dsh_bridge_setup.py` 写的）。
dsh-tui:
  whale: false
"""


def _backup(path: Path) -> None:
    bak = path.with_suffix(path.suffix + ".hooh-bak")
    if path.is_file() and not bak.exists():
        shutil.copy2(path, bak)


def settings_text() -> str:
    if SETTINGS.is_file():
        return SETTINGS.read_text(encoding="utf-8")
    if IMPORTED.is_file():                      # 以它当底：workbuddy 那条不能丢
        return IMPORTED.read_text(encoding="utf-8")
    return "llm-pi-ai:\n  providers:\n"


def ensure_provider(text: str, base_url: str, model: str) -> tuple[str, str]:
    if "\n    ace:\n" in text:
        # 升级路径：旧版路由块没有 apiKeyEnv（那时端点不校验鉴权）。补上它，
        # 否则旧配置会在端点加固后开始 401，而用户看到的只是"连不上"。
        start = text.index("\n    ace:\n")
        nxt = text.find("\n    ", start + 1)          # 下一个同级 provider（没有就到末尾）
        block = text[start:nxt if nxt != -1 else len(text)]
        if "apiKeyEnv" not in block and "baseURL:" in block:
            patched = block.replace("      baseURL:", "      apiKeyEnv: ACE_PROXY_KEY\n"
                                                   "      baseURL:", 1)
            text = text[:start] + patched + text[start + len(block):]
            return text, "已存在（补上 apiKeyEnv）"
        return text, "已存在（跳过）"
    marker = "\n  providers:\n"
    if marker not in text:
        if text and not text.endswith("\n"):
            text += "\n"
        text += "llm-pi-ai:\n  providers:\n"
        marker = "\n  providers:\n"
    at = text.index(marker) + len(marker)
    return text[:at] + PROVIDER_BLOCK.format(base_url=base_url, model=model) + text[at:], "已写入"


def ensure_whale(text: str) -> tuple[str, str]:
    if "\n  whale: false" in text:
        return text, "已关闭（跳过）"
    if not text.endswith("\n"):
        text += "\n"
    return text + WHALE_BLOCK, "已关闭"


def patch_branding(revert: bool) -> list[str]:
    report: list[str] = []
    for path, subs in (
        (FONTS, [("const TOP_WORD = 'DEEPSEEK';", "const TOP_WORD = 'HooH';"),
                 ("const BOTTOM_WORD = 'HARNESS';", "const BOTTOM_WORD = '';")]),
        (LOGO, [("'✦ dsh-TUI'", "'✦ HooH'"),
                ("children: \"DeepSeek Harness\"", "children: \"HooH\"")]),
    ):
        if not path.is_file():
            report.append("缺文件：%s" % path)
            continue
        bak = path.with_suffix(path.suffix + ".hooh-bak")
        if revert:
            if bak.is_file():
                shutil.copy2(bak, path)
                report.append("回退 %s" % path.name)
            continue
        src = path.read_text(encoding="utf-8")
        out = src
        for old, new in subs:
            if revert:
                out = out.replace(new, old)
            else:
                out = out.replace(old, new)
        if out == src:
            report.append("%s：已是目标状态（或没找到锚点）" % path.name)
            continue
        _backup(path)
        path.write_text(out, encoding="utf-8")
        report.append("改好 %s（原文件存 %s）" % (path.name, bak.name))
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="配置「HooH × dsh-TUI」（幂等）")
    ap.add_argument("--base-url", default="http://127.0.0.1:8787/v1")
    ap.add_argument("--model", default="ace")
    ap.add_argument("--check", action="store_true", help="只看状态，不写任何文件")
    ap.add_argument("--revert", action="store_true", help="回退品牌改动")
    ap.add_argument("--no-branding", action="store_true", help="只配路由，不动品牌")
    args = ap.parse_args(argv)

    text = settings_text()
    text, prov = ensure_provider(text, args.base_url, args.model)
    text, whale = ensure_whale(text)

    if args.check:
        imported_now = PROFILE_HOME / "settings.yaml.imported"
        print("[check] profile home        :", PROFILE_HOME)
        print("[check] settings.yaml       :", "待导入（存在）" if SETTINGS.is_file()
              else ("已导入过（%s 在）" % imported_now.name if imported_now.is_file() else "不存在"))
        src = SETTINGS.read_text(encoding="utf-8") if SETTINGS.is_file() else ""
        print("[check] ace 路由（待导入文件）:", "已写" if "\n    ace:\n" in src else "未写")
        print("[check] 开屏鲸鱼（待导入文件）:", "已关闭" if "\n  whale: false" in src else "仍开着")
        for path, token in ((FONTS, "TOP_WORD = 'HooH'"), (LOGO, "'✦ HooH'")):
            state = "已换品牌" if (path.is_file() and token in path.read_text(encoding="utf-8")) else \
                    ("缺文件" if not path.is_file() else "还是原品牌")
            print("[check] %-16s: %s" % (path.name, state))
        return 0

    report = patch_branding(args.revert) if not args.no_branding else ["（--no-branding：品牌未动）"]
    if not args.revert:
        PROFILE_HOME.mkdir(parents=True, exist_ok=True)
        SETTINGS.write_text(text, encoding="utf-8")
        print("%s → %s / %s" % (SETTINGS, prov, whale))
        if LEGACY_SETTINGS.is_file():                 # 清掉第一版写错位置的那份
            LEGACY_SETTINGS.unlink()
            print("  已清掉写错位置的 %s（那是 cli profile 的 home）" % LEGACY_SETTINGS)
    for line in report:
        print("  " + line)
    if not args.revert:
        print("\n下一步：**重启 dsh-tui** —— 它启动时会把这份 settings.yaml 改名成")
        print("        .imported 并导入本 profile 的设置（热重载那份是旧的，不看新文件）。")
        print("        然后 `ace proxy --project-root <你的项目>`，在 dsh-tui 里 /model 选 HooH。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
