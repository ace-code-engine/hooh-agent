#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""core.ace_engine —— Rust 元处理引擎（`engine/`）的 Python 适配层。

## 这个引擎是什么

处理**"关于这次运行自身"**的东西：会话事件流的索引与派生、快照元数据、会话/目标状态、
运行度量。它不是一个更快的执行器 —— 那件事归 `executor/`（Go）。

## 边界（引擎总则，改这里之前先读）

引擎**只算不裁**：不判权限、不看路径、不碰文件系统、不联网。裁决永远在执行层
（`execution_layer.py`）。所以它可以被杀、被替换、坏掉只会变慢。

## 这一层的职责（三件）

1. **发现**二进制：`ACE_ENGINE` 环境变量 > `engine/target/release/ace-engine[.exe]` > PATH；
2. **喂原料**：会话日志按**原始行**送过去（Python 侧一个 JSON 都不解 —— 那正是扫一遍
   日志最贵的部分）；
3. **拿不到就降级**：引擎不存在/起不来/协议不对 → 用纯 Python 算**同一份口径**。
   降级只该变慢，不该变成"没有这个功能"，更不该变成一个没人数过的静默分支。

与 `core/ace_executor.py` 同形（发现 / 握手 / 失败即降级），方向相反：那个把执行挪出去
是为了**孤立**，这个挪出去只是为了**算**。
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

__all__ = ["EngineError", "ENGINE_BIN", "engine_path", "engine_available",
           "EngineClient", "session_meta", "session_verify", "session_events",
           "session_metrics", "KNOWN_KINDS"]

ENGINE_BIN = "ace-engine"
ENV_OVERRIDE = "ACE_ENGINE"
PROTOCOL = 1
MAX_LINES = 200_000          # 单次送过去的行数上限（防一份畸形日志把内存吃光）


def _int_field(ev: Dict[str, Any], key: str) -> int:
    """取整数字段（与 Rust 的 `as_i64` 同口径：非整数/缺失都算 0）。"""
    v = ev.get(key)
    if isinstance(v, bool) or not isinstance(v, int):
        return 0
    return int(v)

# 与 engine/src/events.rs 的 KNOWN_KINDS 一一对应。它只用来回答"有没有我不认识的
# kind"，**不是白名单** —— 测试会拦两边漂移。
KNOWN_KINDS = frozenset({
    "session/start", "user/message", "assistant/message", "request/snapshot",
    "system/snapshot", "tool/call", "tool/result", "permission/decision",
    "security/denied", "guard/verdict", "snapshot/create", "snapshot/rollback",
    "snapshot/unavailable", "goal/round", "model/error", "model/usage",
    "compaction/event", "model/switch",
})


class EngineError(RuntimeError):
    """引擎侧的失败。**调用方不该把它抛给用户** —— 降级才算正确处置。"""


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def engine_path() -> Optional[str]:
    """找引擎二进制。找不到返回 None（调用方据此降级，不报错）。"""
    override = os.environ.get(ENV_OVERRIDE, "").strip()
    if override:
        p = Path(override)
        if p.is_file():
            return str(p)
        return None                       # 显式指定却不存在：当作没有，别去找别的
    exe = ENGINE_BIN + (".exe" if os.name == "nt" else "")
    for cand in (_repo_root() / "engine" / "target" / "release" / exe,
                 _repo_root() / "engine" / "target" / "debug" / exe):
        if cand.is_file():
            return str(cand)
    found = shutil.which(ENGINE_BIN)
    return found or None


def engine_available() -> bool:
    """是否存在可用的引擎二进制（不做握手 —— 那要起进程）。"""
    return engine_path() is not None


class EngineClient:
    """NDJSON over stdio 的极简客户端。协议与 `engine/README.md` 一致。

    只给两种用法：`session_meta`/`session_verify` 内部用一次即关；测试可以直接持有。
    """

    def __init__(self, exe: Optional[str] = None) -> None:
        self.exe = exe or engine_path()
        if not self.exe:
            raise EngineError("找不到 ace-engine 二进制")
        try:
            self.proc = subprocess.Popen(
                [self.exe, "serve"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
        except (OSError, ValueError) as e:
            raise EngineError(f"引擎起不来: {e}") from e
        self._id = 0
        info = self.call("initialize", {"protocol": PROTOCOL})
        self.info = info

    def call(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        self._id += 1
        rid = str(self._id)
        frame = {"v": PROTOCOL, "type": "req", "id": rid, "method": method,
                 "params": params or {}}
        try:
            self.proc.stdin.write(json.dumps(frame, ensure_ascii=False) + "\n")
            self.proc.stdin.flush()
            line = self.proc.stdout.readline()
        except (OSError, ValueError) as e:
            raise EngineError(f"引擎通信失败: {e}") from e
        if not line:
            raise EngineError("引擎无响应（进程已退出？）")
        try:
            resp = json.loads(line)
        except json.JSONDecodeError as e:
            raise EngineError(f"引擎回了非 JSON: {e}") from e
        if not resp.get("ok"):
            err = resp.get("error") or {}
            raise EngineError(f"{err.get('code')}: {err.get('message')}")
        return resp.get("result") or {}

    def close(self) -> None:
        try:
            self.call("shutdown", {})
        except Exception:  # noqa: BLE001 —— 收尾失败不影响结论
            pass
        try:
            self.proc.terminate()
            self.proc.wait(timeout=3)
        except Exception:  # noqa: BLE001
            try:
                self.proc.kill()
            except Exception:  # noqa: BLE001
                pass

    def __enter__(self) -> "EngineClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


# ---------------------------------------------------------------- 读日志

def _read_lines(path: Path) -> List[str]:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    return raw.splitlines()


# ---------------------------------------------------------------- 纯 Python 降级实现
# 与 engine/src/events.rs **同口径**。改一边必须改另一边 —— `engine/tools/xcheck.py`
# 会在真实日志上对拍两份输出（字段级相等），漂移当场变红。

def _python_events(lines: List[str]) -> Dict[str, Any]:
    """本地解析（引擎不可用时的兜底）。字段口径与 `engine/src/events.rs` **一一对应** ——
    `engine/tools/xcheck.py` 与 `test_all` 的 E1 会在真实日志上对拍两份输出，漂移当场变红。

    返回 {events, bad_json, missing_fields, duplicate_lines, total_bytes, unique_bytes}。
    """
    events: List[Dict[str, Any]] = []
    bad_json = missing = dup_lines = total_bytes = 0
    seen: Dict[str, int] = {}            # 内容指纹 → 首次出现的字节数
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            ev = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            bad_json += 1
            continue
        if not isinstance(ev, dict) or "seq" not in ev or "kind" not in ev:
            missing += 1
            continue
        seq = ev.get("seq")
        if isinstance(seq, bool) or not isinstance(seq, int):
            missing += 1
            continue
        nbytes = len(raw.encode("utf-8"))          # 与 Rust 的 raw.len() 同口径（字节）
        # 内容指纹：**除 seq/ts 外的全部字符串值**按顺序拼接后再哈希。
        # 不是整行哈希 —— 整行带着唯一的 seq，同内容写 20 遍也永远"不重复"，
        # 冗余会恒等于 0（实测在真实日志上就是这么暴露的）。
        # 只取字符串值：数字的序列化格式两种语言细节不同，取字符串才能逐字节对上。
        content = "\x01".join(
            str(val) for key, val in ev.items()
            if key not in ("seq", "ts") and isinstance(val, str))
        # nosec B324 —— 去重指纹（内容是否出现过），非密码学用途；无碰撞对抗需求。
        digest = hashlib.md5(content.encode("utf-8")).hexdigest()  # nosec B324
        total_bytes += nbytes
        if digest in seen:
            dup_lines += 1
        else:
            seen[digest] = nbytes
        status = ev.get("status")
        if not isinstance(status, str):
            status = ev.get("decision")
        events.append({
            "seq": seq,
            "kind": str(ev.get("kind")),
            "ts": str(ev.get("ts") or ""),
            "tool": str(ev.get("tool") or ""),
            "status": str(status or ""),
            "level": str(ev.get("level") or ""),
            "model": str(ev.get("model") or ""),
            "subagent": str(ev.get("subagent") or ""),
            "bytes": nbytes,
            # 度量字段：与 engine/src/events.rs 的抽取一一对应。
            # 耗时/用量此前根本不在日志里（`ts` 只有秒级粒度，推不出"哪个工具慢"），
            # 所以先把它们落进 tool/result 与 model/usage，这里才有得抽。
            "elapsed_ms": _int_field(ev, "elapsed_ms"),
            "in_tokens": _int_field(ev, "in_tokens"),
            "out_tokens": _int_field(ev, "out_tokens"),
            "measured_in_tokens": _int_field(ev, "measured_in_tokens"),
            "measured_out_tokens": _int_field(ev, "measured_out_tokens"),
            "system_len": _int_field(ev, "system_len"),
            "messages_count": _int_field(ev, "messages_count"),
        })
    return {"events": events, "bad_json": bad_json, "missing_fields": missing,
            "duplicate_lines": dup_lines, "total_bytes": total_bytes,
            "unique_bytes": sum(seen.values())}


def _python_meta(lines: List[str]) -> Dict[str, Any]:
    parsed = _python_events(lines)
    events = parsed["events"]
    bad_json = parsed["bad_json"]
    missing = parsed["missing_fields"]
    dup_lines = parsed["duplicate_lines"]
    total_bytes = parsed["total_bytes"]

    kinds: Dict[str, List[int]] = {}
    for e in events:
        slot = kinds.setdefault(e["kind"], [0, 0])
        slot[0] += 1
        slot[1] += e["bytes"]
    kinds_sorted = sorted(([k, v[0], v[1]] for k, v in kinds.items()),
                          key=lambda x: (-x[1], x[0]))

    tools: Dict[str, Dict[str, int]] = {}
    for e in events:
        if not e["tool"]:
            continue
        slot = tools.setdefault(e["tool"], {"calls": 0, "results": 0, "errors": 0,
                                           "elapsed_ms_total": 0, "elapsed_ms_max": 0})
        if e["kind"] == "tool/call":
            slot["calls"] += 1
        elif e["kind"] == "tool/result":
            slot["results"] += 1
            if e["status"] and e["status"] != "success":
                slot["errors"] += 1
            if e["elapsed_ms"] > 0:
                slot["elapsed_ms_total"] += e["elapsed_ms"]
                slot["elapsed_ms_max"] = max(slot["elapsed_ms_max"], e["elapsed_ms"])
    tools_sorted = sorted(({"tool": k, **v} for k, v in tools.items()),
                          key=lambda x: (-x["calls"], x["tool"]))

    seqs = [e["seq"] for e in events]
    duplicates: List[int] = []
    gaps: List[List[int]] = []
    monotonic = True
    seen_seq = set()
    prev = None
    for s in seqs:
        if s in seen_seq:
            if s not in duplicates and len(duplicates) < 20:
                duplicates.append(s)
        seen_seq.add(s)
        if prev is not None:
            if s <= prev:
                monotonic = False
            elif s > prev + 1 and len(gaps) < 20:
                gaps.append([prev, s])
        prev = s

    unknown = sorted({e["kind"] for e in events} - KNOWN_KINDS)
    return {
        "events": len(events),
        "bad_json": bad_json,
        "missing_fields": missing,
        "duplicate_lines": dup_lines,
        "kinds": [{"kind": k, "count": c, "bytes": b} for k, c, b in kinds_sorted],
        "tools": tools_sorted,
        "bytes": {"total": total_bytes, "unique": parsed["unique_bytes"],
                  "redundant": total_bytes - parsed["unique_bytes"]},
        "seq": {"count": len(events),
                "first": seqs[0] if seqs else None,
                "last": seqs[-1] if seqs else None,
                "monotonic": monotonic,
                "duplicates": duplicates,
                "gaps": gaps},
        "unknown_kinds": unknown,
    }


def _empty_meta() -> Dict[str, Any]:
    return _python_meta([])


# ---------------------------------------------------------------- 对外 API

def session_meta(path: Any) -> Dict[str, Any]:
    """会话日志的元信息。**永不抛异常**。

    返回结构（引擎与降级实现完全一致）：
      events / bad_json / missing_fields / duplicate_lines / kinds / tools /
      bytes{total,unique,redundant} / seq{...} / unknown_kinds
    额外带 `source`：`"ace-engine"` 或 `"python"`（降级）—— 调用方要能如实说出来。
    """
    p = Path(path) if path else None
    if p is None or not p.is_file():
        out = _empty_meta()
        out["source"] = "python"
        return out
    lines = _read_lines(p)[:MAX_LINES]
    exe = engine_path()
    if exe:
        try:
            with EngineClient(exe) as c:
                c.call("events.load", {"lines": lines, "mode": "replace"})
                meta = c.call("events.stats", {})
            meta["source"] = "ace-engine"
            return meta
        except Exception:  # noqa: BLE001 —— 引擎的任何问题都退化成"变慢"
            pass
    out = _python_meta(lines)
    out["source"] = "python"
    return out


def session_verify(path: Any) -> Dict[str, Any]:
    """append-only 契约体检：坏行 / 缺字段 / seq 重复 / 缺口 / 回退。

    返回 {ok, checked, problems:[{code, detail}], source}。同样**永不抛**。
    """
    meta = session_meta(path)
    problems: List[Dict[str, Any]] = []
    if meta.get("bad_json"):
        problems.append({"code": "bad_json", "detail": meta["bad_json"]})
    if meta.get("missing_fields"):
        problems.append({"code": "missing_seq_or_kind", "detail": meta["missing_fields"]})
    seq = meta.get("seq") or {}
    if seq.get("duplicates"):
        problems.append({"code": "seq_duplicate", "detail": seq["duplicates"]})
    if seq.get("gaps"):
        problems.append({"code": "seq_gap", "detail": seq["gaps"]})
    if seq.get("monotonic") is False:
        problems.append({"code": "seq_not_monotonic", "detail": "seq 出现回退"})
    return {"ok": not problems, "checked": seq.get("count", 0),
            "problems": problems, "source": meta.get("source", "python")}


# ---------------------------------------------------------------- 度量聚合

# 归一化后的事件字段（两条路径必须产出**完全相同的键**，否则对拍没意义）
_NORM_KEYS = ("seq", "kind", "ts", "tool", "status", "level", "model", "subagent", "bytes",
              "elapsed_ms", "in_tokens", "out_tokens", "measured_in_tokens",
              "measured_out_tokens", "system_len", "messages_count")


def session_events(path: Any, client: Any = None) -> Any:
    """归一化事件序列 → `(events, source)`。**永不抛**。

    优先用引擎的 `events.timeline`（解析在引擎里做），引擎不可用则在本地解析同一批行。
    两条路径返回的字段集由 `_NORM_KEYS` 固定，聚合逻辑因此只有一份。

    `client` 可传入一个**已起的** `EngineClient` 复用 —— 跨会话汇总时尤其重要：
    不给它就会"每份日志起一个进程"（262 份 = 262 个进程，实测过这个坑）。
    """
    p = Path(path) if path else None
    if p is None or not p.is_file():
        return [], "python"
    lines = _read_lines(p)[:MAX_LINES]
    try:
        if client is not None:
            client.call("events.load", {"lines": lines, "mode": "replace"})
            items = (client.call("events.timeline", {"limit": 0}) or {}).get("items") or []
        else:
            exe = engine_path()
            if not exe:
                raise EngineError("没有引擎二进制")
            with EngineClient(exe) as c:
                # 必须先 load：每个 EngineClient 都是**新进程**，索引是空的。
                # （第一版漏了这一步，于是 source 报 ace-engine、而事件数为 0 —— 实测抓到的）
                c.call("events.load", {"lines": lines, "mode": "replace"})
                items = (c.call("events.timeline", {"limit": 0}) or {}).get("items") or []
        out = []
        for it in items:
            if not isinstance(it, dict):
                continue
            out.append({k: (_int_field(it, k) if k in
                            ("seq", "bytes", "elapsed_ms", "in_tokens", "out_tokens",
                             "measured_in_tokens", "measured_out_tokens",
                             "system_len", "messages_count")
                            else str(it.get(k) or "")) for k in _NORM_KEYS})
        return out, "ace-engine"
    except Exception:  # noqa: BLE001 —— 引擎的任何问题都退化成"变慢"
        pass
    return _python_events(lines)["events"], "python"


def session_metrics(path: Any, client: Any = None) -> Dict[str, Any]:
    """运行度量聚合（轮次 / 工具 / 授权 / 模型 / 上下文 / 用量）。

    边界：**抽取在引擎、聚合在这里**。实测过引擎的强项是"解析那 122 行 JSON"，
    而在这份已解析的数据上做算术，两种实现没有差别（聚合是廉价操作），
    所以别为了"搬而搬"把它塞进 Rust。

    为什么这些度量今天算不出来：`elapsed` 与 token 用量此前只活在内存里
    （`result.metadata["elapsed"]` / `self._cost`），而 `ts` 只有秒级粒度
    （实测 262 份真实日志：平均 11.2 事件却只有 1.8 个不同 ts）——推不出"哪个工具慢"。
    """
    events, source = session_events(path, client)
    m: Dict[str, Any] = {
        "source": source,
        "events": len(events),
        "rounds": 0, "subagent_rounds": 0,
        "user_messages": 0, "assistant_messages": 0,
        "tool_calls": 0, "tool_results": 0, "tool_errors": 0, "tool_elapsed_ms": 0,
        "tools": {}, "decisions": {}, "levels": {}, "models": {},
        "usage": {"rounds": 0, "in_tokens": 0, "out_tokens": 0,
                  "measured_in_tokens": 0, "measured_out_tokens": 0, "by_model": {}},
        "context": {"rounds": 0, "max_system_len": 0, "max_messages": 0},
        "counts": {},
    }
    for e in events:
        kind = e["kind"]
        m["counts"][kind] = m["counts"].get(kind, 0) + 1
        if kind == "user/message":
            m["user_messages"] += 1
        elif kind == "assistant/message":
            m["assistant_messages"] += 1
        elif kind == "request/snapshot":
            m["rounds"] += 1
            if e["subagent"]:
                m["subagent_rounds"] += 1
            m["context"]["rounds"] += 1
            m["context"]["max_system_len"] = max(m["context"]["max_system_len"], e["system_len"])
            m["context"]["max_messages"] = max(m["context"]["max_messages"], e["messages_count"])
            if e["model"]:
                m["models"][e["model"]] = m["models"].get(e["model"], 0) + 1
        elif kind == "model/usage":
            m["usage"]["rounds"] += 1
            m["usage"]["in_tokens"] += e["in_tokens"]
            m["usage"]["out_tokens"] += e["out_tokens"]
            m["usage"]["measured_in_tokens"] += e["measured_in_tokens"]
            m["usage"]["measured_out_tokens"] += e["measured_out_tokens"]
            # 按模型分开记：成本要在**调用方**按价格表算（引擎只带事实，不持有价格）
            _bm = m["usage"]["by_model"].setdefault(
                e["model"] or "?", {"rounds": 0, "in_tokens": 0, "out_tokens": 0,
                                    "measured_in_tokens": 0, "measured_out_tokens": 0})
            _bm["rounds"] += 1
            _bm["in_tokens"] += e["in_tokens"]
            _bm["out_tokens"] += e["out_tokens"]
            _bm["measured_in_tokens"] += e["measured_in_tokens"]
            _bm["measured_out_tokens"] += e["measured_out_tokens"]
            if e["model"]:
                m["models"][e["model"]] = m["models"].get(e["model"], 0) + 1
        elif kind == "permission/decision":
            if e["status"]:
                m["decisions"][e["status"]] = m["decisions"].get(e["status"], 0) + 1
            if e["level"]:
                m["levels"][e["level"]] = m["levels"].get(e["level"], 0) + 1
        elif kind == "tool/call":
            m["tool_calls"] += 1
            m["tools"].setdefault(e["tool"], {"calls": 0, "errors": 0, "elapsed_ms": 0})
            if e["tool"]:
                m["tools"][e["tool"]]["calls"] += 1
        elif kind == "tool/result":
            m["tool_results"] += 1
            slot = m["tools"].setdefault(e["tool"], {"calls": 0, "errors": 0, "elapsed_ms": 0})
            if e["status"] and e["status"] != "success":
                m["tool_errors"] += 1
                slot["errors"] += 1
            if e["elapsed_ms"] > 0:
                m["tool_elapsed_ms"] += e["elapsed_ms"]
                slot["elapsed_ms"] += e["elapsed_ms"]
    m["tools"] = dict(sorted(m["tools"].items(),
                             key=lambda kv: (-kv[1]["calls"], kv[0])))
    return m


def cross_session_metrics(paths: Any, *, pricing: Any = None,
                          client: Any = None) -> Dict[str, Any]:
    """把多份会话日志的度量汇总起来 —— **跨会话**的轮次/工具/token/成本。

    为什么要它：`self._cost` 只活在当前进程的内存里，会话一结束就没了；而 token 用量
    此前也从不落日志（本轮才补上 `model/usage`）。所以"我在这台机器上花了多少"这个问题
    以前根本答不出来。

    **成本在这里算、不在引擎里算**：价格表是 `core/ace_cost` 的单一来源，引擎只带事实
    （token 数），不该持有价格 —— 否则价格一改就得改两个地方，还得跨语言对齐浮点。

    `paths` 可以是路径列表或目录；坏日志/不存在的路径**跳过**（不影响其余汇总）。
    同样**永不抛**。

    实测（本机，262 份真实日志 / 2938 事件）：引擎路径 **164 ms**，本地解析 **76 ms**
    —— **多份小日志场景下引擎更慢**。原因清楚：每份日志两次 IPC 往返的开销盖过了
    "解析快一点"的收益。所以这里保留两条路径但没有提速神话：解析归引擎的价值在
    **单份大日志**（Python 侧零 JSON 解析），不在"把小文件搬来搬去"。
    对 `/status` 用的 ~11 份规模，两者都在 20 ms 以内，差别可忽略。
    """
    if isinstance(paths, (str, Path)):
        p = Path(paths)
        files = sorted(p.glob("*.jsonl")) if p.is_dir() else [p]
    else:
        files = [Path(x) for x in (paths or [])]

    from core import ace_cost as _cost_mod

    total: Dict[str, Any] = {
        "sessions": 0, "events": 0, "rounds": 0, "subagent_rounds": 0,
        "tool_calls": 0, "tool_errors": 0, "tool_elapsed_ms": 0,
        "user_messages": 0, "assistant_messages": 0,
        "usage": {"rounds": 0, "in_tokens": 0, "out_tokens": 0,
                  "measured_in_tokens": 0, "measured_out_tokens": 0, "by_model": {}},
        "sources": set(),
    }
    # 一个进程服务全部日志：每份都起一个引擎进程的话，262 份就是 262 个进程（实测过）。
    own: Any = None
    if client is None:
        exe = engine_path()
        if exe:
            try:
                own = EngineClient(exe)
                client = own
            except Exception:  # noqa: BLE001 —— 起不来就走本地解析
                client = None
    try:
        for f in files:
            if not f.is_file():
                continue
            m = session_metrics(f, client)
            if not m.get("events"):
                continue
            total["sessions"] += 1
            total["events"] += m["events"]
            for k in ("rounds", "subagent_rounds", "tool_calls", "tool_errors",
                      "tool_elapsed_ms", "user_messages", "assistant_messages"):
                total[k] += m.get(k, 0)
            total["usage"]["rounds"] += m["usage"]["rounds"]
            total["usage"]["in_tokens"] += m["usage"]["in_tokens"]
            total["usage"]["out_tokens"] += m["usage"]["out_tokens"]
            total["usage"]["measured_in_tokens"] += m["usage"].get("measured_in_tokens", 0)
            total["usage"]["measured_out_tokens"] += m["usage"].get("measured_out_tokens", 0)
            for model, t in (m["usage"].get("by_model") or {}).items():
                slot = total["usage"]["by_model"].setdefault(
                    model, {"rounds": 0, "in_tokens": 0, "out_tokens": 0,
                            "measured_in_tokens": 0, "measured_out_tokens": 0})
                for kk in ("rounds", "in_tokens", "out_tokens",
                           "measured_in_tokens", "measured_out_tokens"):
                    slot[kk] += t.get(kk, 0)
            total["sources"].add(m.get("source", "python"))
    finally:
        if own is not None:
            own.close()

    table = _cost_mod.resolve_pricing(pricing)
    usd = 0.0
    priced = False
    for model, t in total["usage"]["by_model"].items():
        c = _cost_mod.estimate_cost(t["in_tokens"], t["out_tokens"],
                                    _cost_mod.price_for(model, table))
        if c is not None:
            usd += c
            priced = True
    total["usd"] = usd if priced else None            # 没有价格表就如实返回 None，不编
    total["sources"] = sorted(total["sources"])
    return total


if __name__ == "__main__":               # 手工看一眼：python -m core.ace_engine <log>
    target = sys.argv[1] if len(sys.argv) > 1 else ""
    if target and len(sys.argv) > 2 and sys.argv[2] == "metrics":
        print(json.dumps(session_metrics(target), ensure_ascii=False, indent=2))
    elif target and len(sys.argv) > 2 and sys.argv[2] == "cross":
        print(json.dumps(cross_session_metrics(target), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(session_meta(target), ensure_ascii=False, indent=2))
