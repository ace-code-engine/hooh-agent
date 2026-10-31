#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_wix.py —— 由载荷目录生成 WiX 源文件，并（可选）当场编译成 MSI。

## 为什么是 WiX 而不是 Inno Setup

两者都能做"自带环境、双击安装"。选 WiX 的理由只有一条，但很硬：**这台机器上有可用的
WiX 工具链，没有 Inno Setup。** 而"本地不可验证"在这条发布链上已经连续弄红 CI 五次
（`$Args` 自动变量、`Start-Process` 拆空格、脚本里的中文、版本判据少个 v、一次空参数），
每一次都是同一个模式：**我在本地看不到 CI 会看到的东西**。所以凡是能在本地真跑一遍的
方案，优先于"理论上更好但只能靠 CI 兜底"的方案。

（WiX 工具链来自 electron-winstaller 随附的 vendor 目录，版本 3.10.0.2103。）

## 为什么自己生成 .wxs

WiX 通常用 `heat.exe` 收集文件，但那东西不在随附的工具链里。于是这里自己走一遍载荷目录
——顺带**把载荷完整性也验了**：每个文件都生成一个 `<Component>`，所以"包里少了个文件"
不再可能悄悄过去。每个组件的 GUID 由 `uuid5(命名空间, 相对路径)` 确定性生成，同一份载荷
每次得到同样的 GUID —— MSI 的升级/卸载依赖这一点，随机 GUID 会让每次构建变成不同产品。

## 用法

    python packaging/make_wix.py                      # 只生成 dist/ace.wxs
    python packaging/make_wix.py --build              # 生成后用 candle+light 编译出 MSI
    python packaging/make_wix.py --build --candle <路径> --light <路径>

退出码 0 = 成功；1 = 失败（并说明原因）。所有构建产物落在 dist\\ 下，不入库。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import uuid
from pathlib import Path
from xml.sax.saxutils import escape

for _s in (sys.stdout, sys.stderr):
    try:
        if _s.encoding and _s.encoding.lower() not in ("utf-8", "utf8"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

# 固定命名空间 + 固定 UpgradeCode：产品身份必须跨版本稳定，否则升级会装成两个产品。
NS = uuid.UUID("6f3d2a58-2f14-4c8b-9a71-0d5e7c4b1f90")
UPGRADE_CODE = uuid.UUID("b1c7f0a4-8d63-4e52-9f3a-6c2d8e5b7a41")

# 常见二进制扩展名 —— 用来决定哪些文件该标成"永久不参与版本比较"的那些规则。
# 这里只用于日志统计，MSI 本身不需要区分。
BIN_EXT = {".exe", ".dll", ".pyd", ".so", ".bin"}


def msi_version(v: str) -> str:
    """MSI 的 Version 必须是 x.y.z（最多四段数字），预发布后缀不能进去。"""
    core = v.split("-")[0]
    parts = [p for p in core.split(".") if p.isdigit()]
    while len(parts) < 3:
        parts.append("0")
    return ".".join(parts[:4])


def guid_for(rel: str) -> str:
    """由相对路径确定性推出组件 GUID（大写到花括号形式）。"""
    return "{" + str(uuid.uuid5(NS, rel.replace("\\", "/"))).upper() + "}"


def build_wxs(payload: Path, version: str, out: Path, app_name: str = "HooH") -> tuple:
    files = sorted(p for p in payload.rglob("*") if p.is_file())
    if not files:
        raise SystemExit(f"FAIL: 载荷目录是空的: {payload}")
    if not (payload / "ace.exe").is_file():
        raise SystemExit(f"FAIL: 载荷里没有 ace.exe: {payload}")

    ver = msi_version(version)
    lines = []
    add = lines.append

    add('<?xml version="1.0" encoding="utf-8"?>')
    add('<!-- 由 packaging/make_wix.py 生成，请勿手工编辑。每次构建按载荷目录重新生成。 -->')
    add('<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">')
    add(f'  <Product Id="*" Name="{escape(app_name)}" Language="1033" '
        f'Version="{ver}" Manufacturer="ace-code-engine" '
        f'UpgradeCode="{str(UPGRADE_CODE).upper()}">')
    add('    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine" '
        'Description="HooH - local-first AI coding agent. Ships its own runtime; no Python needed." '
        'Comments="https://github.com/ace-code-engine/hooh-agent" />')
    add('    <MajorUpgrade AllowSameVersionUpgrades="yes" '
        'DowngradeErrorMessage="A newer version of HooH is already installed." />')
    add('    <MediaTemplate EmbedCab="yes" CompressionLevel="high" />')
    add(f'    <Property Id="ARPNOMODIFY" Value="1" />')
    add(f'    <Property Id="ARPCOMMENTS" Value="Local-first AI coding agent. No Python needed." />')
    add('    <Property Id="ARPURLINFOABOUT" Value="https://github.com/ace-code-engine/hooh-agent" />')
    # 品牌图标：Add/Remove Programs 里显示 HooH 的「互」徽标。ico 随 PyInstaller
    # datas（assets/）落在 _internal\assets\，与载荷一起被本脚本收获。
    add('    <Icon Id="ace.ico" SourceFile="_internal\\assets\\ace.ico" />')
    add('    <Property Id="ARPPRODUCTICON" Value="ace.ico" />')

    # 目录骨架：Program Files\ACE\{,_internal\...}
    # 用真正的递归目录树来生成，而不是"按深度补 </Directory>"——第一版就是那么写的，
    # candle 直接拒绝：闭合标签与开始标签不匹配。目录嵌套必须由树本身决定。
    add('    <Directory Id="TARGETDIR" Name="SourceDir">')
    add('      <Directory Id="ProgramFiles64Folder">')
    add(f'        <Directory Id="INSTALLFOLDER" Name="{escape(app_name)}">')

    tree = {}
    for f in files:
        rel = f.parent.relative_to(payload).parts
        node = tree
        for part in rel:
            node = node.setdefault(part, {})

    dir_ids = {}
    used_ids = {}

    def dir_id(key: str) -> str:
        """目录 ID：路径里的非字母数字压成 `_`，**撞车时加确定性后缀**。

        为什么必须防撞：这个 ID 直接决定文件装进哪个目录。两个不同目录映射到同一个 ID，
        它们的同名文件就会落进同一个 MSI 目录 —— 轻则装错地方，重则 ICE30 直接编译失败。
        `a/b-c` 与 `a/b_c` 是一对现成的反例（都被压成 `D_a_b_c`）。
        """
        base = "D_" + "".join(c if c.isalnum() else "_" for c in key)
        did, n = base, 2
        while used_ids.get(did, key) != key:
            did = f"{base}_{n}"
            n += 1
        used_ids[did] = key
        return did

    def emit_tree(node, prefix_parts, depth):
        pad = "  " * depth
        for part in sorted(node):
            key = "/".join(list(prefix_parts) + [part])
            did = dir_id(key)
            dir_ids[key] = did
            add(f'{pad}<Directory Id="{did}" Name="{escape(part)}">')
            emit_tree(node[part], list(prefix_parts) + [part], depth + 1)
            add(f'{pad}</Directory>')

    emit_tree(tree, [], 5)
    add('        </Directory>')
    add('      </Directory>')
    # 开始菜单
    add('      <Directory Id="ProgramMenuFolder">')
    add('        <Directory Id="AceProgramMenuDir" Name="HooH" />')
    add('      </Directory>')
    add('    </Directory>')

    # 每个文件一个组件，**挂在它自己那一层的 `<DirectoryRef>` 下**。为什么不是给组件写
    # `Directory` 属性：WiX v3 明令禁止（CNDL0062 —— 组件既然嵌在 <Directory> 里，就不能
    # 再自己声明目录），本机 candle 实测直接报错退出 62。而"全部塞进 INSTALLFOLDER 这一个
    # DirectoryRef"更不行：那等于所有文件平铺进根目录，实测在 CI 上触发 ICE30
    # （`_internal/README.md` 与 `_internal/vendor/README.md`、两个包的 `py.typed` 同名），
    # 就算压掉 ICE 编出来，PyInstaller 单目录包的模块/资源也全都不在 `_internal/` 下了。
    def dir_id_for(f: Path) -> str:
        if f.parent == payload:
            return "INSTALLFOLDER"
        key = "/".join(f.parent.relative_to(payload).parts)
        return dir_ids.get(key, "INSTALLFOLDER")

    by_dir: dict = {}
    for f in files:
        by_dir.setdefault(dir_id_for(f), []).append(f)

    for did in sorted(by_dir):
        add(f'    <DirectoryRef Id="{did}">')
        for f in by_dir[did]:
            rel = f.relative_to(payload).as_posix()
            cid = guid_for(rel)
            add(f'      <Component Id="C_{cid.strip("{}").replace("-", "_")}" '
                f'Guid="{cid}" DiskId="1">')
            add(f'        <File Id="F_{cid.strip("{}").replace("-", "_")}" '
                f'Source="{escape(str(f))}" KeyPath="yes" />')
            add('      </Component>')
        add('    </DirectoryRef>')

    add('    <DirectoryRef Id="AceProgramMenuDir">')
    # 控制台程序必须借 cmd 起一个窗口，否则点开一闪而过
    add('      <Component Id="C_StartMenu" Guid="' + guid_for("__startmenu__") + '" DiskId="1">')
    add('        <Shortcut Id="S_ACE" Name="HooH" Description="Local-first AI coding agent" '
        'Target="[System64Folder]cmd.exe" Arguments="/k &quot;[INSTALLFOLDER]ace.exe&quot;" '
        'WorkingDirectory="INSTALLFOLDER" />')
    add('        <Shortcut Id="S_ACEDemo" Name="HooH (offline demo)" '
        'Description="Run HooH with the scripted offline model" '
        'Target="[System64Folder]cmd.exe" Arguments="/k &quot;[INSTALLFOLDER]ace.exe&quot; --mock" '
        'WorkingDirectory="INSTALLFOLDER" />')
    add('        <RemoveFolder Id="RF_AceProgramMenuDir" Directory="AceProgramMenuDir" On="uninstall" />')
    add('        <RegistryValue Root="HKCU" Key="Software\\ace-code-engine\\ACE" '
        'Name="installed" Type="integer" Value="1" KeyPath="yes" />')
    add('      </Component>')
    add('    </DirectoryRef>')

    add('    <Feature Id="Main" Title="HooH" Level="1" Display="expand" '
        'Description="HooH itself and everything it needs to run.">')
    add('      <ComponentGroupRef Id="PayloadFiles" />')
    add('      <ComponentRef Id="C_StartMenu" />')
    add('    </Feature>')

    # 所有载荷文件包进一个 ComponentGroup，Feature 用一次引用收进来
    add('    <ComponentGroup Id="PayloadFiles" Directory="INSTALLFOLDER">')
    for f in files:
        rel = f.relative_to(payload).as_posix()
        cid = guid_for(rel)
        add(f'      <ComponentRef Id="C_{cid.strip("{}").replace("-", "_")}" />')
    add('    </ComponentGroup>')

    add('  </Product>')
    add('</Wix>')

    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    bins = sum(1 for f in files if f.suffix.lower() in BIN_EXT)
    return len(files), bins


def run(cmd, label):
    print(f"  $ {label}")
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    for line in out.splitlines():
        if line.strip():
            print("    " + line.strip())
    return p.returncode, out


def main() -> int:
    ap = argparse.ArgumentParser(description="生成 ACE 的 WiX 源文件并（可选）编译成 MSI")
    ap.add_argument("--payload", default=str(REPO / "dist" / "ace"))
    ap.add_argument("--version", default="")
    ap.add_argument("--out", default=str(REPO / "dist"))
    ap.add_argument("--build", action="store_true", help="另外调用 candle + light 编译出 MSI")
    ap.add_argument("--candle", default="")
    ap.add_argument("--light", default="")
    args = ap.parse_args()

    payload = Path(args.payload)
    if not payload.is_dir():
        print(f"FAIL: 载荷目录不存在: {payload}")
        print("      先构建并冒烟：packaging/build_exe.ps1 -Python python")
        return 1

    version = args.version
    if not version:
        vf = REPO / "core" / "version.py"
        import re
        version = re.search(r'__version__ = "([^"]+)"',
                            vf.read_text(encoding="utf-8")).group(1)
    print(f"载荷  : {payload}")
    print(f"版本  : {version}  -> MSI Version {msi_version(version)}")

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    wxs = outdir / "ace.wxs"
    n_files, n_bins = build_wxs(payload, version, wxs)
    total = sum(f.stat().st_size for f in payload.rglob("*") if f.is_file())
    print(f"已生成: {wxs}")
    print(f"  组件 {n_files} 个（其中二进制 {n_bins} 个），载荷 {total / 1048576:.1f} MB")
    print("  每个文件一个组件 -> 载荷完整性也被这一步验过：少一个文件就会少一个组件引用")

    if not args.build:
        return 0

    candle, light = args.candle, args.light
    if not (candle and light):
        # 在随附的 WiX 工具链里找（electron-winstaller 的 vendor 目录）
        for base in (Path.home() / "CodeBuddy", Path("C:/Program Files (x86)"),
                     Path("C:/Program Files")):
            if not base.exists():
                continue
            hits = list(base.glob("**/electron-winstaller/vendor/candle.exe")) + \
                   list(base.glob("**/WiX Toolset*/bin/candle.exe"))
            if hits:
                candle = str(hits[0])
                light = str(hits[0].with_name("light.exe"))
                break
    if not (candle and light and Path(candle).is_file() and Path(light).is_file()):
        print("FAIL: 找不到 candle.exe / light.exe —— 用 --candle/--light 指定，或设好 WiX 工具链")
        return 1
    print(f"candle: {candle}")

    wixobj = outdir / "ace.wixobj"
    msi = outdir / f"hooh-{version}-windows-amd64.msi"
    # -arch x64：载荷是 64 位（PyInstaller 在 windows-latest 上产出的就是 x64）。
    rc, _ = run([candle, "-nologo", "-arch", "x64", "-out", str(wixobj), str(wxs)],
                f"candle -arch x64 -out {wixobj.name} {wxs.name}")
    if rc != 0:
        print(f"FAIL: candle 退出 {rc}")
        return 1
    if not wixobj.is_file():
        print("FAIL: candle 报成功但没有产出 .wixobj")
        return 1
    # -sice:ICE61：我们**故意**保留 AllowSameVersionUpgrades（同一版本号也允许升级/重装，
    #   因为 MSI 的版本只能到 x.y.z，两个不同构建完全可能同号），而 ICE61 正是抱怨这一点。
    #   压掉它不等于忽略问题：这个取舍写在这里，而不是让它每天以警告形式刷屏。
    rc, _ = run([light, "-nologo", "-sice:ICE61", "-b", str(payload),
                 "-out", str(msi), str(wixobj)],
                f"light -sice:ICE61 -b {payload.name} -out {msi.name} {wixobj.name}")
    if rc != 0:
        print(f"FAIL: light 退出 {rc}")
        return 1
    if not msi.is_file():
        print("FAIL: light 报成功但没有产出 .msi")
        return 1

    # 自检：MSI 里必须真的带上 ace.exe。只信"light 退出码 0"是不够的——
    # 一个空壳 MSI 也能编出来，而用户装完什么都不会有。
    try:
        blob = msi.read_bytes()
    except OSError as e:
        print(f"FAIL: 读不回 MSI: {e}")
        return 1
    missing = [name for name in ("ace.exe",)
               if name.encode("ascii") not in blob and name.encode("utf-16-le") not in blob]
    if missing:
        print(f"FAIL: MSI 里找不到 {missing} —— 说明载荷没被打进去")
        return 1
    print(f"MSI   : {msi}  ({msi.stat().st_size / 1048576:.1f} MB)")
    print(f"  自检通过：MSI 里含 ace.exe 的引用，且包住了 {n_files} 个载荷文件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
