#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
guardian.py —— 物理快照回滚

契约（execution_layer.py）：
    from core.guardian import Guardian
    g = Guardian(str(project_root))
    snapshot_id = g.snapshot(tag)      # 返回快照 id（空项目返回 None）
    ok = g.rollback(snapshot_id)       # 完整性预检 → 备份当前状态 → 恢复 → 验证 → 清理备份
                                       # H-08：范围记在快照里（snapshot(touched=…)）。
                                       #   说得清就只回滚那几个路径（用户对别的文件的
                                       #   编辑不受影响）；说不清就整树还原。

机制（与 system prompt 对齐）：
    1. 写入操作前自动创建项目快照（完整文件树，排除 .git / __pycache__ / .venv 等）
    2. 回滚前执行完整性预检：快照非空、元信息完整、文件校验和一致
    3. 回滚时先备份当前状态，再恢复快照，恢复成功后清理备份

增量存储（WP-AGENCY 刀2，2026-10-24）：
    每次 file_write 都要建快照 —— 若每次都"整树复制 + 全树哈希"，写热路径就背着
    一次全树读的代价（实测 347 文件 / 11.4 MB 夹具单次 ~2 s）。于是内容寻址：

      .guardian/objects/<sha256[:2]>/<sha256>   内容对象（**只写不删不改**， immutable）
      .guardian/objects/index.json              rel 路径 → {size, mtime_ns, sha256} 缓存
      .guardian/snapshots/<id>/files/<rel>      指向对象的**硬链接**（旧消费者零改动）

    快照时逐文件看 `(size, mtime_ns)`：与 index 一致且对象在 → 直接硬链接，**不读不哈希**；
    不一致/新文件 → 拷进对象库（temp+rename 原子落盘）+ 哈希一次。哈希只发生在
    "真变了的文件"上。meta.json 的每文件 sha256 **语义与格式不变**——所以
    `verify_snapshot()` / `rollback()` / 外部工具全部零改动；硬链接损坏、对象缺失
    都会在校验那一步如实暴露（默认 verify_policy="create" 时在写之前暴露）。

    知情取舍（写明不装糊涂）：
    - **mtime 欺骗**：能改 mtime 的进程（同用户）可让"变了"的文件被当成"没变"，
      于是新快照按 index 复用**旧内容**对象——注意这是往旧退的方向，不是把篡改
      藏进新快照；且 meta 里记录的 sha256 与硬链接内容仍由校验步骤对账。
      要彻底关掉这层缓存：删掉 `objects/index.json`（下次快照自动全量重建）。
    - **index.json 是缓存不是真相**：丢了/坏了只是退回全量哈希，绝不 fail-close。
    - **对象库回收**：`prune()` 删快照后跟着 `gc_objects()`，只删没有任何存活
      快照引用的对象。
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

# 并行哈希的线程数。为什么要并行：**瓶颈不是 CPU，是"新写入文件的首次读取代价"**。
# 实测（本机 Windows，347 文件 / 11.4 MB 的夹具，即真实仓库同规模）：
#   · 单个 12 MB 大文件 SHA256        : 788 MB/s  ← CPU 完全不是瓶颈
#   · 顺序读回刚复制出来的 347 个副本  : 987 ms（2.84 ms/文件）
#   · 同一批再读一遍                  :  20 ms（0.06 ms/文件）← 51× 落差
#   · 8 线程读回同一批**全新**副本     : 210 ms（4.7×，逐文件结果一致）
# 也就是说这 1 秒是每文件的首次读取代价（写回/实时防护类），并行能把延迟重叠掉。
# hashlib 对 >2047 字节的 buffer 会释放 GIL，所以这里的线程是真并行。
# `ACE_HASH_WORKERS=1` 可关掉并行（对照/排障用）。
_HASH_WORKERS = max(1, min(8, int(os.environ.get("ACE_HASH_WORKERS") or 0)
                           or (os.cpu_count() or 4)))

EXCLUDE_DIRS = {".git", "__pycache__", ".venv", "venv", ".ace_env", "node_modules",
                ".idea", ".vscode", ".guardian", ".agent_flywheel",
                ".poc_reports", ".sandbox_tmp", ".test_tmp",
                ".ace_shots", ".ace_images",
                # H-01：工具缓存与"只该由自己被写"的运行时产物。
                # 之前漏在名单外，实测一次快照 1903 文件 / 34.5 MB 里有 71% 是
                # `.ace_sessions`(972) + `.ace-cc-zh`(636) —— 全是非源码。
                # `.ace_sessions` 尤其不该被回滚：那是 append-only 的审计记录，
                # 把它还原等于抹掉取证材料。
                ".ruff_cache", ".pytest_cache", ".mypy_cache",
                ".ace_sessions", ".ace-cc-zh",
                # Rust 引擎（engine/）的构建产物。`target/` 是 Rust/Maven/Gradle
                # 的通用约定名，与 node_modules 同类，所以按**名字**排除。
                # 代价说清楚：用户自己那个叫 target/ 的目录也不会进快照
                # （也就不会被回滚重建）—— 与 node_modules 同一取舍。
                # 口径与 .gitignore 的 `engine/target/` 成对，别只改一边。
                "target"}
# SEC-04：快照是明文副本，绝不能把用户凭据/密钥文件再复制一份进 .guardian。
# 命中这些名字的文件不进快照（也就不进 meta、不会被回滚重建）。
#
# H-11：判据**只剩一份**，在 `core/sensitive.py`。此前这里自带一份（3 个 basename
# + 9 个后缀），与 `tools/base` 那份（30 个 basename + 7 个后缀）**双向漂移** ——
# 结果是 25 个凭据名（`.npmrc`/`.pypirc`/`.pgpass`/`.git-credentials`/`.netrc`/
# `.htpasswd`/`.terraformrc`…）被**明文复制进快照**，而本文件的注释正写着"绝不能"。
from core.sensitive import is_credential_file as _is_sensitive_file  # noqa: E402
# H-08：精确回滚要把"模型写在参数里的路径"和快照元信息里的相对路径对上，
# 所以必须走 H-10 的同一个解析入口（8.3 短名 / 尾点 / `..` / 大小写都在那里收口）。
from core.canonical import canonical_path  # noqa: E402

# `is_credential_file` 的唯一实现在 `core.sensitive`；调用方请**直接从那里取**
# （`tools/file_ops.py` 已改成直取），别在这里再转一层 —— 转出层就是下一份会漂的名单。


class SnapshotError(Exception):
    pass


# ---- 信任锚（RG-01）：签名密钥必须放在**工作区之外** --------------------------
# 为什么非出去不可（本工作区实测，见 docs/design/RGTC-LANDING.md RG-01）：密钥原来住在
# `<项目>/.guardian/signing_key`，而 `.guardian` 就在项目目录里。拿到项目目录读写权限的一方
# （agent 走 terminal_exec / code_execute 就够）能：读出密钥 → 改快照副本 → 修 meta 里的摘要
# → 用同一把密钥重算 HMAC。实测这样改完 `verify_snapshot()` 返回 **True** —— 也就是说
# "写前快照"这道安全网**可以被伪造**。把密钥移到工作区外（由 OS 权限保护）之后，同样的攻击
# 拿不到密钥，伪造不成立。
ANCHOR_ENV = "ACE_ANCHOR_DIR"


def default_anchor_root() -> Path:
    """锚的根目录：Windows 用 `%LOCALAPPDATA%`，其它平台用 XDG state。"""
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    else:
        base = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(base) / "ace-agent" / "state"


def anchor_dir_for(project_root: Path, override: Optional[str] = None) -> Path:
    """本项目专属的锚目录：`<根>/<项目绝对路径的哈希>`，项目之间互不干扰。

    根目录的取值顺序：构造参数 `anchor_dir` > 环境变量 `ACE_ANCHOR_DIR` > 平台默认。
    测试与冻结版都靠前两者注入；**取不到可写位置时不静默退回项目内**（那等于把边界悄悄拆了），
    而是由 `Guardian` 记下错误、让写路径 fail-close（读路径不受影响）。
    """
    root = None
    if override:
        root = Path(override).expanduser()
    else:
        env = os.environ.get(ANCHOR_ENV, "").strip()
        if env:
            root = Path(env).expanduser()
    if root is None:
        root = default_anchor_root()
    # Windows 路径大小写不敏感：同一项目用 normcase 归一，避免出现两个锚目录
    ident = os.path.normcase(str(Path(project_root).resolve()))
    return root / hashlib.sha256(ident.encode("utf-8")).hexdigest()[:16]


def load_or_create_anchor_secret(secret_path: Path) -> str:
    """读锚里的一把密钥；没有就建一把（POSIX 0600）。失败抛 `OSError`，由调用方定怎么办。

    抽出来是为了让**别的组件也用同一个锚**（会话日志台账就用它），而不是各自发明一个存密钥的
    地方 —— 后者正是"同一判据抄多份、漏改一份"的来源。注意这里**不做迁移**：迁移是 Guardian
    的事（它知道老位置在哪）。
    """
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    if secret_path.is_file():
        val = secret_path.read_text(encoding="utf-8").strip()
        if val:
            return val
    val = secrets.token_hex(32)
    secret_path.write_text(val, encoding="utf-8")
    _restrict_key_file(secret_path)
    if secret_path.read_text(encoding="utf-8").strip() != val:
        raise OSError(f"锚写入后读回不一致：{secret_path}")
    return val


def _restrict_key_file(key_path: Path) -> None:
    """把密钥文件权限收到所有者可读写（POSIX 0600）。Windows 上靠 `%LOCALAPPDATA%` 的 ACL。

    不吞异常：设不上权限就如实告警，但**不因此中断** —— 快照能力比这行提示重要，
    而"没设上"这件事必须说出来，不能让用户以为设上了。
    """
    if os.name == "nt":
        return
    try:
        os.chmod(key_path, 0o600)
    except OSError as e:
        print(f"⚠ 未能把密钥文件权限收到 0600（{key_path}: {e}）", file=sys.stderr)


class Guardian:
    """物理快照管理器"""

    def __init__(self, project_root: str, store_dir: Optional[str] = None,
                 signing_key: Optional[str] = None, max_snapshots: int = 20,
                 verify_policy: str = "create", anchor_dir: Optional[str] = None) -> None:
        self.project_root = Path(project_root).resolve()
        self.store = Path(store_dir) if store_dir else self.project_root / ".guardian"
        self.snap_dir = self.store / "snapshots"
        self.backup_dir = self.store / "rollback_backups"
        # 增量对象库（WP-AGENCY 刀2）：内容寻址 + 硬链接进快照。index 是**缓存**：
        # 丢了坏了只退回全量哈希，绝不 fail-close。
        self.objects_dir = self.store / "objects"
        self._index_path = self.objects_dir / "index.json"
        self._index: Optional[Dict] = None          # 惰性加载；None = 还没读过
        self._index_dirty = False
        self._link_ok: Optional[bool] = None        # None = 还没试过；False = 本卷不支持硬链接
        # 信任锚（RG-01）：签名密钥放工作区之外。快照本身**仍留在 `.guardian/snapshots/`** ——
        # 那是数据不是锚，搬它等于同时动 /undo、/rollback、gc 与一堆既有断言，收益却与 I1 无关。
        self.anchor = anchor_dir_for(self.project_root, anchor_dir)
        self.anchor_migrated = False
        self.anchor_error = ""
        # SEC-04：签名默认开启。显式提供 signing_key 用配置值；
        # 否则从锚取/建**本项目持久密钥**。持久化是为了让 /undo、重启后的 rollback 等
        # **另一个 Guardian 实例**能验同一批快照的签名。
        self.store.mkdir(parents=True, exist_ok=True)
        self.signing_key = signing_key
        if self.signing_key is None:
            try:
                self.signing_key = self._load_anchor_key()
            except OSError as e:
                # fail-close：锚不可用 → 不生成未签名快照，写路径会被 `snapshot()` 拒绝
                # （执行层已有"快照不可用 → 503"的处理），而读路径照常工作。
                self.anchor_error = f"{type(e).__name__}: {e}"
                print(f"⚠ 签名锚不可用（{self.anchor}）：{self.anchor_error}\n"
                      f"  因此不生成未签名的快照 —— 写操作会被拒（fail-close），读路径不受影响。",
                      file=sys.stderr)
        elif not str(self.signing_key).strip():
            print("⚠ 显式配置了空的 signing_key —— 快照不带签名，篡改只能靠摘要比对发现",
                  file=sys.stderr)
        self.max_snapshots = max_snapshots  # 快照数量硬上限，超出自动清理最旧的
        # 完整性校验的**时机**。实测：单次 snapshot() 的成本 92% 在这一步
        # （读回刚复制出来的 347 个副本要 2.2 s；而大文件 SHA256 有 788 MB/s，
        #   所以那不是 CPU，是新文件首次读取代价）。
        #   "create"   —— 建完立刻校验（**默认**）。H-02 那条"复制不完整/损坏要在写之前
        #                 发现"就是它：坏的快照会被 fail-close 挡在写操作之前。
        #   "rollback" —— 只在**恢复时**校验。`rollback()` 里那一步无论如何都在
        #                 （见 rollback 第 1 步），所以坏的快照仍然**永远不会被静默恢复**。
        # 换成 "rollback"：夹具实测 snapshot() 约 2.0 s → 约 0.2 s。
        # 代价说清楚：不是"少校验"，是"校验挪到使用点"，坏快照暴露得更晚（/undo 那一刻）。
        if verify_policy not in ("create", "rollback"):
            print(f"⚠ 未知的 snapshot_verify={verify_policy!r}，按默认 create 处理",
                  file=sys.stderr)
            verify_policy = "create"
        self.verify_policy = verify_policy
        for d in (self.snap_dir, self.backup_dir, self.objects_dir):
            d.mkdir(parents=True, exist_ok=True)

    def _sign(self, content: str) -> str:
        """对快照元信息做 HMAC-SHA256 签名（防伪造）"""
        return hmac.new(self.signing_key.encode("utf-8"),
                        content.encode("utf-8"), hashlib.sha256).hexdigest()

    # ---------- 工具 ----------

    def _collect_files(self) -> List[Path]:
        """收集项目完整文件树（排除构建/缓存/自身存储目录/敏感凭据文件）"""
        files: List[Path] = []
        for dirpath, dirnames, filenames in os.walk(self.project_root):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for fn in filenames:
                p = Path(dirpath) / fn
                if _is_sensitive_file(p):
                    continue
                files.append(p)
        return files

    @staticmethod
    def _sha256(path: Path) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()

    def _sha256_many(self, paths: "Iterable[Path]") -> List[str]:
        """批量哈希（线程池）—— 用于**读回校验**这种整批顺序访问。

        · 走 `self._sha256` 而不是内联实现：测试会用子类覆盖它（H-02 的"复制中途失败"
          用例），覆盖必须继续生效。
        · 线程起不来就退回顺序：**校验本身绝不能因为"并行失败"而消失**（这是安全网，
          不是优化开关）。
        · 单文件不走线程池：起池的开销比省下的多。
        """
        items = list(paths)
        if len(items) <= 1 or _HASH_WORKERS <= 1:
            return [self._sha256(p) for p in items]
        try:
            with ThreadPoolExecutor(max_workers=min(_HASH_WORKERS, len(items))) as ex:
                return list(ex.map(self._sha256, items))
        except RuntimeError:
            return [self._sha256(p) for p in items]

    # ---------- 增量对象库（WP-AGENCY 刀2） ----------

    def _load_index(self) -> Dict:
        """读 `(size, mtime_ns) → sha256` 缓存。**缓存不是真相**：坏了就退回全量哈希。"""
        if self._index is None:
            try:
                raw = json.loads(self._index_path.read_text(encoding="utf-8"))
                self._index = raw if isinstance(raw, dict) else {}
            except (OSError, json.JSONDecodeError):
                self._index = {}
        return self._index

    def _save_index(self) -> None:
        if not self._index_dirty or self._index is None:
            return
        self.objects_dir.mkdir(parents=True, exist_ok=True)
        tmp = self._index_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self._index, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._index_path)
        self._index_dirty = False

    def _object_path(self, sha: str) -> Path:
        return self.objects_dir / sha[:2] / sha

    def _link_into(self, src: Path, dst: Path) -> None:
        """把对象接进快照：优先硬链接（零拷贝），这一卷不支持就退回 copy2。

        单独成方法是为了让测试可以覆盖（"硬链接失败也要能出快照"那条）。
        第一次失败就记住 `_link_ok=False`，后面全部走拷贝，免得逐文件白试。
        """
        if self._link_ok is not False:
            try:
                os.link(src, dst)
                self._link_ok = True
                return
            except OSError:
                if self._link_ok is None:
                    self._link_ok = False
        shutil.copy2(src, dst)

    def _stage_file(self, src: Path, rel_posix: str, dst: Path) -> Tuple[str, int]:
        """把一个源文件"装进"快照，返回 `(sha256, size)`。

        - `(size, mtime_ns)` 与 index 一致且对象还在 → 直接硬链接，**不读不哈希**
          （这正是增量化省下的钱：哈希只发生在真变了的文件上）；
        - 否则 → 哈希一次 + 拷进对象库（temp+rename 原子落盘）+ 更新 index。
        对象**只写一次、永不二次打开写**：硬链接共享数据，快照文件因此在回滚前
        不会被后续写入污染——这是硬链接方案安全的前提，别改成原地写对象。
        """
        st = src.stat()
        index = self._load_index()
        entry = index.get(rel_posix)
        if (entry and isinstance(entry, dict)
                and entry.get("size") == st.st_size
                and entry.get("mtime_ns") == st.st_mtime_ns):
            cand = self._object_path(str(entry.get("sha256") or ""))
            if cand.is_file():
                dst.parent.mkdir(parents=True, exist_ok=True)
                self._link_into(cand, dst)
                return str(entry["sha256"]), st.st_size
        sha = self._sha256(src)
        obj = self._object_path(sha)
        if not obj.is_file():
            obj.parent.mkdir(parents=True, exist_ok=True)
            tmp = obj.with_name(f".tmp_{uuid.uuid4().hex}")
            shutil.copy2(src, tmp)
            os.replace(tmp, obj)
        index[rel_posix] = {"size": st.st_size, "mtime_ns": st.st_mtime_ns,
                            "sha256": sha}
        self._index_dirty = True
        dst.parent.mkdir(parents=True, exist_ok=True)
        self._link_into(obj, dst)
        return sha, st.st_size

    def count_credential_only_files(self) -> int:
        """数出"文件存在、却只因为像凭据而进不了快照"的个数（H-06）。

        `_collect_files()` 返回空有两种含义，而 `snapshot()` 都用 `None` 表达，
        调用方分不出来。但两者**危险程度完全不同**，不能一概而论：

        - 目录被排除（`.git`/`.poc_reports`/`.agent_flywheel`/缓存/会话）——
          项目里没有用户内容，也就没有可失去的东西，写入应当放行。
          实测踩到过：测试里复用的 sandbox 目录在跑到写工具时已有 `.poc_reports/`，
          若把这类运行时产物算成"内容"，会把合法的空项目写入全部拒掉。
        - **有文件、但每一个都命中凭据名单**（`.env` / `*.pem` / `.npmrc` /
          `.git-credentials` …）—— 这是"有内容却没有回滚点"：工具放行对它们的
          写入（`.env` 是故意放行的"正常开发对象"），而快照永远不会有它们，
          于是那次写入**无法撤销**。这一种才该按快照不可用处理。

        本方法只统计后者的个数。
        """
        total = 0
        for dirpath, dirnames, filenames in os.walk(self.project_root):
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
            for fn in filenames:
                if _is_sensitive_file(Path(dirpath) / fn):
                    total += 1
        return total

    # ---------- 快照 ----------

    def _load_anchor_key(self) -> str:
        """从锚取密钥；锚里没有就**迁移**项目内的旧密钥，再把旧文件删掉。

        为什么"迁移"必须是**搬**而不是拷贝：旧文件与锚里是**同一把密钥**，留在项目目录里就等于
        把秘密继续放在 agent 够得着的地方 —— 那样锚白搬。所以写完读回校验一致后立刻 `unlink()`；
        删不掉就大声告警（此时锚已就位，但那副本仍在，边界并未真正建立）。
        """
        key_path = self.anchor / "signing_key"
        legacy = self.store / "signing_key"
        self.anchor.mkdir(parents=True, exist_ok=True)

        if key_path.is_file():
            key = key_path.read_text(encoding="utf-8").strip()
            if key:
                if legacy.is_file():
                    old = legacy.read_text(encoding="utf-8").strip()
                    if old and old != key:
                        print(f"⚠ 项目内仍有一份**不同**的旧密钥（{legacy}）：以锚为准，"
                              f"旧文件未删（旧快照可能用旧密钥签的）", file=sys.stderr)
                return key

        if legacy.is_file():
            key = legacy.read_text(encoding="utf-8").strip()
            if key:
                key_path.write_text(key, encoding="utf-8")
                _restrict_key_file(key_path)
                if key_path.read_text(encoding="utf-8").strip() != key:
                    raise OSError(f"锚写入后读回不一致：{key_path}")
                try:
                    legacy.unlink()
                    self.anchor_migrated = True
                    print(f"✓ 签名密钥已移出工作区（旧快照仍可验证）：{legacy} → {key_path}")
                except OSError as e:
                    print(f"⚠ 旧密钥删不掉（{legacy}: {e}）—— 锚已就位，但同一把密钥仍留在"
                          f"agent 可写处，边界未真正建立；请手动删除该文件。", file=sys.stderr)
                return key

        key = secrets.token_hex(32)
        key_path.write_text(key, encoding="utf-8")
        _restrict_key_file(key_path)
        return key

    def snapshot(self, tag: str = "",
                 touched: Optional[Iterable[str]] = None) -> Optional[str]:
        """创建物理快照（完整拷贝文件树），返回快照 id；无可备份内容返回 None

        H-02：任何失败都在这里就地清掉 `dest_root`，再把异常抛出去。此前只有
        "创建后自检失败"那一支做清理，而 `shutil.copy2` 中途失败（Windows 上文件
        被别的进程占用是常态）会留下一个**没有 meta.json** 的半成品目录 ——
        `list_snapshots()` 只认带 meta.json 的目录，于是 `prune()` 永远看不见它，
        只吃磁盘、不报警。历史遗留的这类目录用 `guardian --gc` 或
        `gc_orphans()` 清。
        """
        # RG-01 / fail-close：锚不可用时**拒绝**创建快照，而不是悄悄生成一份未签名快照。
        # 未签名快照的摘要可以随内容一起被改（伪造成本为零），那等于把这道安全网变成装饰。
        # 抛出去之后走执行层已有的"快照不可用 → 503"那条路，语义与沙箱档位一致。
        if self.anchor_error:
            raise SnapshotError(f"签名锚不可用，拒绝生成未签名的快照：{self.anchor_error}")
        files = self._collect_files()
        if not files:
            return None  # 空项目没有可备份内容
        tag = re.sub(r"[^\w\-]+", "_", tag or "snap")[:40]
        # 随机后缀：防止同一毫秒内多次快照 id 撞车，同时避免 id 可预测
        snap_id = f"{int(time.time() * 1000)}_{tag}_{uuid.uuid4().hex[:6]}"
        dest_root = self.snap_dir / snap_id
        files_dest = dest_root / "files"
        meta = {
            "id": snap_id,
            "tag": tag,
            "created": time.time(),
            "created_iso": time.strftime("%Y-%m-%d %H:%M:%S"),
            "root": str(self.project_root),
            "file_count": len(files),
            "files": {},
            # H-08：这个快照能按多小的范围回滚。`"tree"` = 整树还原；`"paths"` = 只回滚
            # `touched` 里列出的路径（这一轮明确动过的那些）。
            # 记进快照而不是靠调用方记得传：`/undo`、`/rollback <id>` 是**事后**从另一个
            # 入口调的，那时早就没有 ctx 了 —— 让快照自己说得清，才不会退化成整树。
            # 缺这个键的旧快照按 `"tree"` 处理（向后兼容）。
            "rollback_scope": "tree",
            "touched": [],
        }
        if touched is not None:
            rel_touched, _outside = self._relative_targets(touched)
            if _outside:
                print(f"⚠ 快照范围里有 {_outside} 个路径在项目外，快照盖不住它们",
                      file=sys.stderr)
            meta["rollback_scope"] = "paths"
            meta["touched"] = rel_touched
        created = False
        try:
            for src in files:
                rel = src.relative_to(self.project_root)
                dst = files_dest / rel
                # 增量：未变文件直接硬链接对象库（不读不哈希），只有真变的文件付拷贝+哈希。
                sha, size = self._stage_file(src, rel.as_posix(), dst)
                meta["files"][rel.as_posix()] = {
                    "size": size,
                    "sha256": sha,
                }
            # 元信息原子写入（配置签名密钥时附 HMAC 签名）
            meta_path = dest_root / "meta.json"
            tmp_path = meta_path.with_suffix(".json.tmp")
            meta_text = json.dumps(meta, ensure_ascii=False, indent=2)
            tmp_path.write_text(meta_text, encoding="utf-8")
            tmp_path.replace(meta_path)
            if self.signing_key:
                (dest_root / "meta.json.sig").write_text(
                    self._sign(meta_text), encoding="utf-8")
            # 创建后立即自检（`snapshot_verify="rollback"` 时挪到使用点，见 __init__：
            # 校验一步都没少，只是从"每次写"变成"每次恢复"）
            if self.verify_policy == "create":
                ok, reason = self.verify_snapshot(snap_id)
                if not ok:
                    raise SnapshotError(f"快照创建后完整性校验失败: {reason}")
            created = True
            # index 是缓存：快照建成才落盘；半途失败的话，内存里已更新的条目留给
            # 下一次快照再落盘（对象本身已有效，条目不亏）。
            self._save_index()
        finally:
            if not created:
                shutil.rmtree(dest_root, ignore_errors=True)
        # 自动清理：快照数量超出上限时删除最旧的（防备份爆炸）
        if self.max_snapshots > 0:
            self.prune(keep=self.max_snapshots)
        return snap_id

    # ---------- 完整性预检 ----------

    def verify_snapshot(self, snap_id: str) -> Tuple[bool, str]:
        """回滚前完整性预检：快照非空、元信息完整、文件校验和一致"""
        dest_root = self.snap_dir / snap_id
        meta_path = dest_root / "meta.json"
        if not meta_path.exists():
            return False, "快照元信息不存在"
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            return False, f"快照元信息损坏: {e}"
        required = {"id", "root", "file_count", "files"}
        if not required.issubset(meta) or not isinstance(meta["files"], dict):
            return False, "快照元信息不完整"
        # 签名校验（配置了签名密钥时）
        if self.signing_key:
            sig_path = dest_root / "meta.json.sig"
            if not sig_path.exists():
                return False, "快照缺少签名文件（当前开启签名校验）"
            expected = self._sign(meta_path.read_text(encoding="utf-8"))
            if sig_path.read_text(encoding="utf-8").strip() != expected:
                return False, "快照签名校验失败（元信息可能被篡改）"
        elif (dest_root / "meta.json.sig").exists():
            # RG-01 补的 fail-close：快照**带签名**、我们却拿不到密钥（锚不可用，或有人把
            # signing_key 显式配空了）时，不能"跳过签名校验、只比摘要"就放行 —— 摘要可以随着
            # 内容一起被改（实测：改副本 + 修 meta 里的 sha256 即可）。拿不到密钥就说拿不到。
            return False, "快照带签名，但当前没有可用密钥（锚不可用或签名被关闭），拒绝验证"
        files_dest = dest_root / "files"
        if not files_dest.is_dir() or meta["file_count"] <= 0 or not meta["files"]:
            return False, "快照为空（无文件内容）"
        # 存在性检查（元数据 stat，便宜）先按 meta 顺序跑完，再**整批并行读回**，
        # 最后按同一顺序逐条比对 —— 于是"第一个不匹配的文件"依旧是确定的，
        # 不随线程调度顺序变（错误文案与顺序在测试里被依赖）。
        checked: List[Tuple[str, Path, str]] = []
        for rel, info in meta["files"].items():
            fp = files_dest / rel
            if not fp.exists():
                return False, f"快照文件缺失: {rel}"
            want = info.get("sha256")
            if want:
                checked.append((rel, fp, want))
        digests = self._sha256_many([c[1] for c in checked])
        for (rel, _fp, want), got in zip(checked, digests):
            if got != want:
                return False, f"快照文件校验和不匹配: {rel}"
        return True, "ok"

    # ---------- 回滚 ----------

    def _relative_targets(self, only: "Iterable[str]") -> Tuple[List[str], int]:
        """把一批"本轮动过的路径"归一到**项目相对**的 posix 路径（去重、保序）。

        必须走 `canonical_path(..., base=self.project_root)`（H-10）：调用方给的是
        **模型写在参数里的原始串**，可能带 `..`、8.3 短名、大小写差异、尾点或绝对
        路径。不归一就直接和 `meta["files"]` 的键比，匹配不上的后果不是报错而是
        **静默不做事** —— 回滚报告成功、文件却没动。

        相对路径的起点是**项目根**而不是进程 cwd：两者在 `--project-root` 与 cwd
        不同的场景下（无头、测试）并不相等，用 cwd 会把项目内的文件解析到项目外。

        返回 `(相对路径, 落在项目外的个数)`。项目外的路径不在快照里、无法从这个
        快照恢复，也不该在这里删 —— 但调用方要知道"这次回滚盖不住它们"。
        """
        out: List[str] = []
        outside = 0
        for raw in only:
            if not str(raw or "").strip():
                continue
            resolved = canonical_path(raw, base=self.project_root)
            if resolved is None:
                continue
            try:
                rel = resolved.relative_to(self.project_root).as_posix()
            except ValueError:
                outside += 1
                continue
            if rel and rel not in out:
                out.append(rel)
        return out, outside

    def rollback(self, snap_id: str, only: Optional[Iterable[str]] = None) -> bool:
        """回滚到指定快照：预检 → 备份当前状态 → 恢复 → 验证 → 清理备份

        **H-08：`only` 给了路径集合时只回滚这些路径**（"只回滚本轮"），其余文件一个
        都不碰 —— 用户在同一时间对别的文件的编辑不再被一起抹掉。
        `only=None` 保持既有的**整树还原**语义："把整个项目退回那个时间点"。

        为什么默认仍然是整树，而不是干脆一律精确：精确回滚的前提是"知道这一轮动了
        哪些路径"。对 `file_write`/`str_replace`/`file_delete`/`file_move`，
        `core.targets.destructive_targets()` 给得出；对 `terminal_exec` /
        `code_execute` / `subagent` 这类能任意写盘的工具给不出 —— 那时"精确回滚"会
        **静默什么都不做**，把"已回滚"变成假承诺。宁可多退回一点（用户看得见、
        备份还在、可恢复），也不能少退（用户以为撤掉了，其实还在盘上）。
        所以调用方只在**能确定范围**的时候传 `only`（见 `execution_layer._stage_snapshot`）。

        整树与精确共用同一套动作，只有集合不同：
          - 快照里有的路径 → 从快照写回
          - 快照里没有的路径 → 删掉（那是快照之后新增的）
        比"先全删、再全恢复"少一个"已删除、未恢复"的窗口：快照里有的文件不再先被删。
        """
        # 1. 完整性预检
        ok, reason = self.verify_snapshot(snap_id)
        if not ok:
            raise SnapshotError(f"回滚前完整性预检失败: {reason}")
        meta = json.loads((self.snap_dir / snap_id / "meta.json").read_text(encoding="utf-8"))
        files_dest = self.snap_dir / snap_id / "files"

        # 折算成本次真正要落地的两个集合。
        # H-08：调用方没给范围时，**听快照自己记的**（`/undo`、`/rollback <id>` 走这条）。
        # 缺键的旧快照 = "tree"，与改动前的行为逐字一致。
        if only is None and meta.get("rollback_scope") == "paths":
            only = tuple(meta.get("touched") or ())
        if only is None:
            to_restore = list(meta["files"].keys())
            to_delete = [p.relative_to(self.project_root).as_posix()
                         for p in self._collect_files()
                         if p.relative_to(self.project_root).as_posix() not in meta["files"]]
        else:
            wanted, outside = self._relative_targets(only)
            if outside:
                print(f"⚠ 本次回滚的目标里有 {outside} 个在项目外，快照盖不住它们，未处理",
                      file=sys.stderr)
            to_restore = [rel for rel in wanted if rel in meta["files"]]
            to_delete = [rel for rel in wanted if rel not in meta["files"]]

        # 2. 备份"即将被覆盖或删除"的当前版本
        #    整树回滚时这个集合就等于"当前所有文件"（与旧行为一致）；
        #    精确回滚时只备份受影响的那几个，不再消耗整棵树的拷贝。
        ts = time.strftime("%Y%m%d_%H%M%S")
        backup_path = self.backup_dir / f"{ts}_{snap_id}"
        for rel in list(to_delete) + list(to_restore):
            cur = self.project_root / rel
            if not cur.is_file():
                continue
            dst = backup_path / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cur, dst)

        # 3. 删除与恢复都逐个来、都兜异常：一个文件被编辑器/杀软占用（Windows 上很常见）
        # 不该让其余文件停在"已删除、未恢复"的状态里。失败项登记下来，最后统一报，
        # 并且**保留删除前的备份**给人工恢复（SEC-016）。
        failed: List[Tuple[str, str]] = []
        for rel in to_delete:
            try:
                (self.project_root / rel).unlink(missing_ok=True)
            except OSError as e:
                failed.append((rel, f"删除失败: {e}"))
        for rel in to_restore:
            try:
                dst = self.project_root / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(files_dest / rel, dst)
            except OSError as e:
                failed.append((rel, str(e)))
        # 4. 验证恢复（同样逐项兜异常：恢复后仍可能被占用/被替换成目录）
        restored = 0
        for rel in to_restore:
            fp = self.project_root / rel
            try:
                if fp.is_file() and self._sha256(fp) == meta["files"][rel]["sha256"]:
                    restored += 1
            except OSError as e:
                failed.append((rel, f"校验失败: {e}"))
        leftover = [rel for rel in to_delete
                    if (self.project_root / rel).exists()]
        if failed or restored != len(to_restore) or leftover:
            scope = ("整树" if only is None
                     else f"本轮动过的 {len(to_restore) + len(to_delete)} 个路径")
            print(f"⚠ 回滚未完成（{scope}）：{len(to_restore) - restored} 个文件未恢复"
                  f"（失败 {len(failed)} 项）", file=sys.stderr)
            if leftover:
                print(f"  另有 {len(leftover)} 个本轮新增的文件没能删掉", file=sys.stderr)
            for rel, why in failed[:5]:
                print(f"    {rel}: {why}", file=sys.stderr)
            if len(failed) > 5:
                print(f"    … 另有 {len(failed) - 5} 项", file=sys.stderr)
            print(f"  删除前的完整备份保留在: {backup_path}", file=sys.stderr)
            print("  人工恢复：把该备份目录里的文件按相对路径拷回项目即可", file=sys.stderr)
            return False
        # 5. 清理备份
        shutil.rmtree(backup_path, ignore_errors=True)
        return True

    # ---------- 管理 ----------

    def list_snapshots(self) -> List[Dict]:
        out: List[Dict] = []
        for d in sorted(self.snap_dir.iterdir()):
            mp = d / "meta.json"
            if d.is_dir() and mp.exists():
                try:
                    meta = json.loads(mp.read_text(encoding="utf-8"))
                    out.append({
                        "id": meta["id"],
                        "tag": meta.get("tag"),
                        "created_iso": meta.get("created_iso"),
                        "file_count": meta["file_count"],
                    })
                except (json.JSONDecodeError, KeyError):
                    continue
        return out

    def prune(self, keep: int = 10) -> int:
        snaps = self.list_snapshots()
        to_remove = snaps if keep <= 0 else snaps[:-keep]
        removed = 0
        for s in to_remove:
            shutil.rmtree(self.snap_dir / s["id"], ignore_errors=True)
            removed += 1
        if removed:
            self.gc_objects()
        return removed

    def gc_objects(self) -> int:
        """删除没有任何存活快照引用的内容对象，返回清理数量。

        对象库是内容寻址的：快照被 `prune()` 删掉后，只剩它引用的对象成了孤儿。
        这里按**存活快照的 meta** 重建引用集再删——比数硬链接可靠（硬链接数在
        拷贝语义/跨平台下不可依赖）。进程内这是安全的（prune 在 snapshot 尾声
        调用，刚建的快照 meta 已落盘）；两个引擎进程写同一项目时存在极窄的竞态
        （刚 put 的对象被另一个进程 gc 掉），后果是该次快照失败重试，不产生错误数据。
        """
        if not self.objects_dir.is_dir():
            return 0
        referenced: set = set()
        if self.snap_dir.is_dir():
            for d in self.snap_dir.iterdir():
                mp = d / "meta.json"
                if not (d.is_dir() and mp.exists()):
                    continue
                try:
                    meta = json.loads(mp.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    continue
                for info in (meta.get("files") or {}).values():
                    sha = str((info or {}).get("sha256") or "")
                    if sha:
                        referenced.add(sha)
        removed = 0
        for sub in self.objects_dir.iterdir():
            if not sub.is_dir() or len(sub.name) != 2:
                continue            # index.json / tmp / 陌生文件一律不动
            for obj in sub.iterdir():
                if obj.is_file() and obj.name not in referenced:
                    try:
                        obj.unlink()
                        removed += 1
                    except OSError:
                        pass
            try:
                sub.rmdir()         # 清空了的分片目录顺手删
            except OSError:
                pass
        return removed

    def gc_orphans(self) -> int:
        """删除没有 meta.json 的孤儿快照目录，返回清理数量（H-02）。

        这些目录对 `list_snapshots()` 不可见（它只认带 meta.json 的），所以
        `prune()` 永远不会动它们 —— 这是"失败快照只吃磁盘不报警"的另一半。
        H-02 之后 `snapshot()` 自己会收拾，此方法用于清理**历史遗留**的那些，
        以及"创建过程中进程被强杀"这类来不及走 finally 的情况。
        """
        if not self.snap_dir.is_dir():
            return 0
        removed = 0
        for d in sorted(self.snap_dir.iterdir()):
            if d.is_dir() and not (d / "meta.json").exists():
                shutil.rmtree(d, ignore_errors=True)
                removed += 1
        return removed


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Guardian 物理快照回滚")
    parser.add_argument("--project", default=".")
    parser.add_argument("--list", action="store_true", help="列出所有快照")
    parser.add_argument("--gc", action="store_true",
                        help="清理没有 meta.json 的孤儿快照目录")
    args = parser.parse_args()
    g = Guardian(args.project)
    if args.gc:
        n1 = g.gc_orphans()
        n2 = g.gc_objects()
        print(f"清理孤儿快照目录: {n1} 个；回收无引用内容对象: {n2} 个")
    elif args.list:
        print(json.dumps(g.list_snapshots(), ensure_ascii=False, indent=2))
    else:
        sid = g.snapshot("manual")
        print(f"快照创建: {sid}")
