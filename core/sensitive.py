#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""敏感目标判定：**唯一来源**（H-11）。

## 两个不同的问题，故意放在一起

| | 问题 | 谁在用 | 入口 |
|---|---|---|---|
| ① | agent **能不能碰**这个路径？ | 文件工具 / 只读终端 / 命令执行 | `sensitive_target()` |
| ② | 这个文件的**内容是不是秘密**？ | `core/guardian`（决定要不要把它**明文复制**进快照） | `is_credential_file()` |

它们**故意不同**，而最大的那个差集就是 `.env`：项目内的 `.env` 是正常开发对象
（"帮我建个 .env"必须能用），所以 ① 不拦它；但快照是明文副本，② 必须排除它。

## 为什么必须同源

此前这两份名单分散在两个模块里各改各的，实测**双向漂移**：

- **方向 A（安全）**：25 个名字 —— `.npmrc` `.pypirc` `.pgpass` `.git-credentials`
  `.netrc` `.htpasswd` `.terraformrc` `.dockercfg` `.my.cnf` `.agent_cli.json` … ——
  对 ① 是凭据，② 却会**明文复制进 `.guardian/snapshots/**/files/`**。
  而 `guardian.py` 自己的注释写着"**绝不能**把用户凭据再复制一份进 `.guardian`"
  （SEC-04，且 BACKLOG 里记的是 ✅ 已完成）。
- **方向 B（可用性）**：`.claude.json` / `client.ovpn` / `key.asc` ② 不快照、
  ① 却视为普通文件 ⇒ 这些写入**不可回滚**。

两份名单各改一半，就成了两个都不完整的名单。现在同源，差异只剩本文件里显式写出的
那一条 —— 它从"没人知道的漂移"变成"写在这里的设计决定"。

## 仍不是完备边界

这是"已知高价值目标"清单，不是安全边界（真正的隔离仍需容器/低权限账户）。
判据方向仍是"列举禁止什么"，而列举天生补不全 —— 这一点见本卡 §0 与 H-06/H-11。
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from core.canonical import canonical_text

__all__ = [
    "CREDENTIAL_BASENAMES", "CREDENTIAL_SUFFIXES", "PRIVATE_KEY_PREFIXES",
    "TOOL_BLOCKED_BASENAMES", "AGENT_STATE_DIRNAMES", "AGENT_STATE_FILENAMES",
    "SENSITIVE_DIRNAMES", "SENSITIVE_DIR_PREFIXES", "STARTUP_FRAGMENTS",
    "is_credential_file", "sensitive_target", "sensitive_dir_listing_reason",
]

# ---------------------------------------------------------------- ② 凭据名单

# 明文凭据 / 密钥材料 / 持久化入口（两份旧名单的**并集**）。
# 加一个名字要同时想清楚它对 ① 和 ② 的影响 —— 不想清楚就会漂移。
CREDENTIAL_BASENAMES = frozenset({
    # 本工具与同类的凭据配置
    ".ai_code.json", ".agent_cli.json", ".claude.json",
    # 各类工具链的明文 token 存放点：不存在"agent 需要改它"的正常场景
    ".netrc", "_netrc", ".git-credentials", ".npmrc", ".pypirc", ".dockercfg",
    ".pgpass", ".my.cnf", ".htpasswd", ".terraformrc",
    # 项目内的 .env（**只在 ② 生效**，见下面那个显式差集）
    ".env",
    # shell 启动脚本：写它们等于装持久化后门
    ".bashrc", ".bash_profile", ".zshrc", ".zprofile", ".profile",
    ".zshenv", ".zlogin", ".bash_aliases", ".bash_logout",
    # 系统凭据与会话
    "authorized_keys", "known_hosts", "credentials", "shadow", "sudoers",
})
CREDENTIAL_SUFFIXES = (".pem", ".key", ".ppk", ".p12", ".pfx", ".keystore",
                       ".jks", ".ovpn", ".asc")
PRIVATE_KEY_PREFIXES = ("id_rsa", "id_ed25519", "id_ecdsa", "id_dsa")

# ① 与 ② 的**唯一显式差集**：agent 可以碰、但快照不收。
# `.env` 是项目内的正常开发对象（"帮我建个 .env"必须能用），拦死它会把正常请求也拒掉。
# 代价：写 `.env` **不可回滚**（它不进快照）。这一点是刻意的取舍，不是漏项 ——
# 若要收紧，正确做法是"写凭据形态的目标时额外确认"，而不是把它塞回 ① 里一拒了之。
TOOL_BLOCKED_BASENAMES = CREDENTIAL_BASENAMES - {".env"}

# ---------------------------------------------------------------- ① 路径判定

SENSITIVE_DIRNAMES = {
    ".ssh", ".aws", ".azure", ".gnupg", ".kube", ".docker", ".config/gcloud",
    # 用户级自启动 / 定时任务：写这里等于装持久化后门
    ".config/autostart", ".config/systemd", ".local/share/systemd",
}
# 目录整体不可写（系统 / 自启动 / 定时任务）
SENSITIVE_DIR_PREFIXES = (
    "c:/windows", "c:/program files", "c:/program files (x86)", "c:/programdata",
    "/etc", "/bin", "/sbin", "/usr/bin", "/usr/sbin", "/boot", "/sys", "/proc",
    "/var/spool/cron",
)
STARTUP_FRAGMENTS = ("start menu/programs/startup", "currentversion/run")

# Agent 自身的安全状态目录：回滚快照存在项目目录内，而项目目录正是 agent 可写的范围。
# 不挡这里，agent 改一行 `.guardian/snapshots/<id>/meta.json` 就能让 verify_snapshot
# 失败，熔断回滚静默变成空操作 —— 安全网被它要防的东西拆了。
# 审计与运行状态同理（SEC-017）：会话事件日志、飞轮样本、POC 报告都是"事后取证"用的，
# 让被审计方自己可写，等于没有记录。挡住文件工具这一层；`terminal_exec` 仍能碰它们，
# 但它每次都过人，且那一步本身就是可被看见的动作。
AGENT_STATE_DIRNAMES = {".guardian", ".ace_sessions", ".agent_flywheel", ".poc_reports"}
# 同上，但是文件形态（目标状态 / 记忆）：改它等于伪造"用户偏好"或"任务已完成"
AGENT_STATE_FILENAMES = {".ace_goals.json", ".agent_memory.json"}
# WP-4：工作区注册表 —— 它**就是放行名单本身**（`tools/base._confined` 的 allowedRoots
# 来源）。不挡的话，被管的模型只要写一份 `{"workspaces":[{"worktree_path":"C:/"}]}`
# 就给自己发了通行证，`file_read` / git / terminal_view 的项目边界当场失效。
# 挡**精确这一条路径**而不是整个 `.ace/`：`.ace/commands/*.md`、`.ace/skills/` 是给人
# 用的项目内容（用户自己编辑、[44] 有断言），一律挡会把正常用法拒掉 —— 与 SEC-006
# "别因为工具选择而失败"同一个取舍。
# 与 `.guardian` 同为"安全状态自持"：挡住文件工具这一层，`terminal_exec` 仍能碰它，
# 但那一步每次过人、且本身是可被看见的动作。
AGENT_STATE_PATH_FRAGMENTS = (".ace/workspaces.json",)

# 版本库自身元数据：写 `.git/hooks/*`、`.git/config` 是持久化后门（pre-commit 已经
# 跑过，/undo 追不回来）；`.gitmodules` 同理（给子模块换仓库）。git 工具走 git 二进制、
# 从不 file_write 进 `.git/`，所以整目录挡掉不会误伤正常用法。
VCS_STATE_DIRNAMES = {".git"}
VCS_STATE_PATH_FRAGMENTS = (".gitmodules",)

# 授权规则文件自己：写 `.ace/permissions*.json` 等于 agent 给自己发通行证。
# `/rules add` 走 ace_rules.save_rules（直接 Python open），不经过文件工具，不受影响。
AUTH_STATE_PATH_FRAGMENTS = (".ace/permissions.json", ".ace/permissions.local.json")


# ---------------------------------------------------------------- ② 判定

def is_credential_file(path: "Path | str") -> bool:
    """这个文件的**内容**是不是秘密（要不要排除在明文快照之外）。

    只看**文件名**：凭据的判别依据是命名约定，与路径无关（`a/.env` 与 `b/.env`
    同样是凭据）。`.env.local` 这类 `*.env.*` 变体也算。
    """
    try:
        name = Path(str(path)).name.lower()
    except (TypeError, ValueError):
        return False
    return (name in CREDENTIAL_BASENAMES
            or name.startswith(".env.")
            or name.startswith(PRIVATE_KEY_PREFIXES)
            or name.endswith(CREDENTIAL_SUFFIXES))


# ---------------------------------------------------------------- ① 判定

def _match(spelled: str) -> Optional[str]:
    """在**一段已折成小写、斜杠统一**的路径串上做名单判定。"""
    low = spelled.replace("\\", "/").lower()
    name = low.rsplit("/", 1)[-1]
    parts = [p for p in low.split("/") if p]

    if name in TOOL_BLOCKED_BASENAMES:
        return f"敏感文件（凭据/启动脚本）: {name}"
    if AGENT_STATE_DIRNAMES & set(parts):
        return "Agent 自身的运行/审计状态目录（改它等于改自己的记录或拆掉回滚安全网）"
    if name in AGENT_STATE_FILENAMES:
        return f"Agent 自身的状态文件（目标/记忆）: {name}"
    if any(fr in low for fr in AGENT_STATE_PATH_FRAGMENTS):
        return "Agent 自身的工作区注册表（allowedRoots 的放行名单，改它等于自己发通行证）"
    if VCS_STATE_DIRNAMES & set(parts):
        return "版本库元数据（写钩子/配置等于植入持久化后门）"
    if any(fr in low for fr in VCS_STATE_PATH_FRAGMENTS):
        return "版本库元数据（.gitmodules，改它等于给子模块换仓库）"
    if any(fr in low for fr in AUTH_STATE_PATH_FRAGMENTS):
        return "Agent 自身的授权规则文件（改它等于给自己发通行证）"
    if "ace-agent" in parts:
        # 信任锚（RG-01）：快照签名密钥 / 本地端点 token 落在
        # `%LOCALAPPDATA%\ace-agent\state\<项目哈希>\`。此前不在任何名单里 ——
        # 一次已确认的 `type %LOCALAPPDATA%\ace-agent\state\...\signing_key`
        # 就能把密钥读出去重签整条审计链。引擎进程自己直读密钥不走工具层，
        # 不受此判定影响（它本来就该读）；挡的是**被管的模型**借工具够到它。
        return "信任锚（快照签名密钥 / 端点 token）"
    if name.endswith(CREDENTIAL_SUFFIXES):
        return f"私钥/证书文件: {name}"
    for d in SENSITIVE_DIRNAMES:
        if d in parts or (("/" in d) and d in low):
            return f"敏感目录: {d}"
    if low.startswith(SENSITIVE_DIR_PREFIXES):
        return "系统目录"
    if any(frag in low for frag in STARTUP_FRAGMENTS):
        return "自启动项"
    # `.claude/settings.json` 等同类配置（含模型凭据）
    if ".claude/" in low and name.endswith(".json"):
        return "敏感文件（模型凭据配置）"
    return None


def sensitive_target(path: "Path | str") -> Optional[str]:
    """命中敏感目标返回原因串，否则 None（① 的问题）。

    用于文件写/删/移与终端命令的前置拦截。挡两类东西：用户的凭据/自启动入口，
    以及 agent 自己的回滚快照目录。

    **H-10：先按 OS 解析后的规范路径判一遍，再按原串判一遍。**
    只按原串判就是此前那个绕过 —— `SSH~1/config` 指向 `.ssh/config`，但拼写上
    没有任何敏感成分。两遍都判只会**多**命中，不会少（原串那遍是超集兜底：
    终端命令里的 `%USERPROFILE%` 之类展开不了，只能按原串看）。
    """
    raw = str(path)
    for spelled in (canonical_text(raw), raw):
        if not spelled:
            continue
        hit = _match(spelled)
        if hit:
            return hit
    return None


# H-29b：列目录（只出文件名、不出内容）只关心"**名字本身就是情报**"的类别。
# 系统目录 / 自启动项那两类是"能不能写、能不能读内容"的问题 —— 列 `C:\Windows`
# 不泄露任何凭据，而 SEC-006 明确"目录名单可越界（'帮我看看桌面'不该因为工具选择
# 而失败）"。所以这里按类别收窄，而不是给列目录换一套新名单。
_DIR_LISTING_BLOCKING_PREFIXES = ("敏感文件", "私钥/证书", "敏感目录", "Agent 自身")


def sensitive_dir_listing_reason(path: "Path | str") -> Optional[str]:
    """列目录专用的敏感判定（H-29b）：命中返回原因串，否则 None。

    与 `sensitive_target` 共用 `_match` 这**同一个判据来源**，只在返回的**类别**上
    收窄：挡凭据 / 私钥 / 敏感目录 / agent 自身状态，放行系统目录与自启动项。

    为什么需要它：`ls`/`dir` 是只读、免确认的工具，此前它们连 `sensitive_target`
    都不调（只有 `cat` 分支调），于是一份情报 `cat` 挡、`ls` 放 —— 同一个仓库里
    两套口径。而 `file_ops` 对同一批目录明确拒绝列名，理由是"文件名单本身就是情报"。
    """
    raw = str(path)
    for spelled in (canonical_text(raw), raw):
        if not spelled:
            continue
        hit = _match(spelled)
        if hit and hit.startswith(_DIR_LISTING_BLOCKING_PREFIXES):
            return hit
    return None


# 兼容别名：老代码/测试按这些私有名引用。新代码请用上面的公开名。
_SENSITIVE_BASENAMES = TOOL_BLOCKED_BASENAMES
_SENSITIVE_SUFFIXES = CREDENTIAL_SUFFIXES
_SENSITIVE_DIRNAMES = SENSITIVE_DIRNAMES
_SENSITIVE_DIR_PREFIXES = SENSITIVE_DIR_PREFIXES
_STARTUP_FRAGMENTS = STARTUP_FRAGMENTS
_AGENT_STATE_DIRNAMES = AGENT_STATE_DIRNAMES
_AGENT_STATE_FILENAMES = AGENT_STATE_FILENAMES
