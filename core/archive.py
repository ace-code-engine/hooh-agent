#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
archive.py —— SimHash 记忆注入引擎

契约（execution_layer.py）：
    from core.archive import MemoryArchive
    archive = MemoryArchive()
    archive.add(user_input)                  # 短输入保护：少于 10 字不存储
    archive.detect_topic_shift(user_input)   # -> "shifted" / "stable"
    archive.get_memory(top_k=3)              # -> 相关记忆列表（注入上下文用）
    archive.stats()                          # -> 统计

机制（与 system prompt 对齐）：
    · SimHash 指纹记录对话特征，主题相似度采用 token 包含系数（阈值 0.25）
    · 主题稳定时不注入记忆（节省 token），主题切换时注入相关记忆
    · 短输入保护：少于 10 字的对话不存入记忆
    · 紧急度信号：检测到催促词时提高记忆权重
"""

import hashlib
import json
import re
import time
import uuid
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

SIMHASH_BITS = 64
SHORT_INPUT_LEN = 10          # 少于 10 字的对话不存入记忆
SHIFT_THRESHOLD = 0.25        # SimHash 相似度低于该阈值 → 主题切换
URGENCY_KEYWORDS = ("快", "马上", "立刻", "立即", "尽快", "赶紧", "急",
                    "紧急", "速度", "asap", "urgent", "快点")
URGENCY_WEIGHT = 1.6          # 催促词记忆权重提升


@lru_cache(maxsize=8192)
def _tokenize(text: str) -> List[str]:
    """分词：拉丁单词 + 中文整段 + 中文二元组"""
    tokens: List[str] = []
    for w in re.findall(r"[a-z0-9_]+", text.lower()):
        tokens.append(f"w:{w}")
    for seg in re.findall(r"[\u4e00-\u9fff]+", text):
        tokens.append(f"c:{seg}")
        for i in range(len(seg) - 1):
            tokens.append(f"b:{seg[i:i+2]}")
    return tokens or ["empty"]


@lru_cache(maxsize=8192)
def simhash(text: str) -> int:
    """64 位 SimHash 指纹"""
    weights = [0] * SIMHASH_BITS
    for tok in _tokenize(text):
        # nosec B324 —— MD5 在这里是**相似度指纹的哈希底座**（SimHash 位折叠），
        # 不是密码学用途：输入是分词后的片段，无攻击面；快照完整性用的是 HMAC-SHA256
        #（见 guardian.py），与此无关。
        h = int.from_bytes(hashlib.md5(tok.encode("utf-8")).digest()[:8], "big")  # nosec B324
        for i in range(SIMHASH_BITS):
            weights[i] += 1 if (h >> i) & 1 else -1
    fp = 0
    for i in range(SIMHASH_BITS):
        if weights[i] > 0:
            fp |= 1 << i
    return fp


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def similarity(a: int, b: int) -> float:
    return 1.0 - hamming(a, b) / SIMHASH_BITS


def text_similarity(a: str, b: str) -> float:
    """主题相似度：token 集包含系数（对短中文文本比 64 位 SimHash 位差更稳定）"""
    ta = set(_tokenize(a or ""))
    tb = set(_tokenize(b or ""))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


@dataclass
class MemoryEntry:
    text: str
    simhash: int
    ts: float
    urgent: bool
    weight: float
    session: str = "default"


class MemoryArchive:
    """SimHash 记忆引擎（支持多会话隔离：不同 session_tag 互不污染）"""

    def __init__(self, path: Optional[str] = None,
                 threshold: float = SHIFT_THRESHOLD,
                 session_tag: str = "default") -> None:
        self.path = Path(path) if path else None
        self.threshold = threshold
        self.session_tag = session_tag
        self.entries: List[MemoryEntry] = []
        self.topic_anchors: Dict[str, Optional[int]] = {}   # 每会话独立主题锚点
        self.topic_texts: Dict[str, str] = {}
        self.shift_count = 0
        # 加载期的"如实上报"字段（供 /memory 显示）：跳过几条坏 entry、文件是否被隔离
        self.skipped_entries = 0
        self.load_error = ""
        self.quarantined = ""
        self._load()

    def set_session(self, tag: str) -> None:
        """切换当前会话标签（多会话并发时用不同 tag 隔离记忆）"""
        self.session_tag = tag or "default"

    # ---------- 记忆写入 ----------

    def add(self, text: str) -> bool:
        """写入一条记忆；短输入保护：少于 SHORT_INPUT_LEN 字不存储"""
        text = (text or "").strip()
        if len(text) < SHORT_INPUT_LEN:
            return False
        urgent = any(k in text for k in URGENCY_KEYWORDS)
        entry = MemoryEntry(
            text=text,
            simhash=simhash(text),
            ts=time.time(),
            urgent=urgent,
            weight=URGENCY_WEIGHT if urgent else 1.0,
            session=self.session_tag,
        )
        self.entries.append(entry)
        self._persist()
        return True

    # ---------- 主题切换检测（按会话隔离） ----------

    def detect_topic_shift(self, text: str) -> str:
        """检测主题是否切换：返回 "shifted" / "stable"（短输入恒为 stable）"""
        text = (text or "").strip()
        if len(text) < SHORT_INPUT_LEN:
            return "stable"
        fp = simhash(text)
        anchor = self.topic_anchors.get(self.session_tag)
        topic_text = self.topic_texts.get(self.session_tag, "")
        if anchor is None:
            self.topic_anchors[self.session_tag] = fp
            self.topic_texts[self.session_tag] = text
            return "stable"
        if text_similarity(text, topic_text) < self.threshold:
            self.topic_anchors[self.session_tag] = fp
            self.topic_texts[self.session_tag] = text
            self.shift_count += 1
            return "shifted"
        return "stable"

    # ---------- 记忆召回 / 注入 ----------

    def get_memory(self, query: Optional[str] = None, top_k: int = 5,
                   exclude_last: bool = False) -> List[Dict]:
        """按主题相似度 × 权重召回相关记忆（仅当前会话；exclude_last：排除刚写入的当前消息）"""
        if not self.entries:
            return []
        session_entries = [e for e in self.entries if e.session == self.session_tag]
        if exclude_last and len(session_entries) > 1:
            entries = list(session_entries[:-1])
        else:
            entries = list(session_entries)
        if not entries:
            return []
        anchor_text = query or self.topic_texts.get(self.session_tag, "") or ""
        ranked = []
        for e in entries:
            sim = text_similarity(e.text, anchor_text)
            ranked.append((sim * e.weight, sim, e))
        ranked.sort(key=lambda x: x[0], reverse=True)
        out: List[Dict] = []
        for score, sim, e in ranked[:top_k]:
            if score <= 0:
                break   # 无 token 交集的不相关记忆直接丢弃，不注入噪声
            out.append({
                **asdict(e),
                "similarity": round(sim, 4),
                "score": round(score, 4),
                "text": e.text[:200],
            })
        return out

    def inject_context(self, query: Optional[str] = None, top_k: int = 5) -> str:
        """生成可注入上下文的记忆文本"""
        mem = self.get_memory(query, top_k)
        if not mem:
            return ""
        lines = ["[记忆注入] 以下是相关的历史对话记忆："]
        for m in mem:
            mark = "⚡" if m["urgent"] else "·"
            lines.append(f"{mark} {m['text']}")
        return "\n".join(lines)

    # ---------- 统计与持久化 ----------

    def stats(self) -> Dict:
        session_entries = [e for e in self.entries if e.session == self.session_tag]
        return {
            "session": self.session_tag,
            "entries": len(session_entries),
            "total_entries": len(self.entries),
            "urgent_entries": sum(1 for e in session_entries if e.urgent),
            "shift_count": self.shift_count,
            "current_topic": self.topic_texts.get(self.session_tag, "")[:40],
            "threshold": self.threshold,
            "persist_path": str(self.path) if self.path else None,
            # 加载期异常必须能被看见：跳过几条、要不要去 recov 那个隔离文件
            "skipped_entries": self.skipped_entries,
            "load_error": self.load_error,
            "quarantined": self.quarantined,
        }

    # ---------- 持久化（容错 + 合并） ----------

    @staticmethod
    def _entry_key(e: "MemoryEntry") -> tuple:
        """条目身份：写回前合并去重用（同一批反复写不会翻倍）。"""
        return (e.session, round(float(e.ts or 0), 3), e.text)

    def _quarantine(self) -> str:
        """把**读不出来**的记忆文件挪到一边（绝不就地覆盖），返回新路径。

        为什么：老实现读失败就 `entries=[]`，而接着任何一次 `add()` 都会把内存里
        这份空表写回磁盘 —— 一次半截写/手改 = 用户全部记忆永久丢失。实测复现过：
        3 条里 1 条坏 → 内存 0 条 → 磁盘剩 1 条。挪走至少让原文还在，能被人工捡回来。
        """
        try:
            dst = self.path.with_name(f"{self.path.name}.corrupt-{int(time.time())}")
            self.path.replace(dst)
            return str(dst)
        except OSError:
            return ""

    def _merge_with_disk(self) -> List["MemoryEntry"]:
        """写回前，把磁盘上"别人的"条目并进来（按身份去重，磁盘顺序在前）。

        为什么必须：主会话与子代理各持一个 `MemoryArchive`（子代理每次新建），而老实现
        把**内存视图**整表写回 —— 子代理写完、主会话再写时，它那份旧视图会把子代理的
        条目整批抹掉。实测复现过：磁盘只剩主会话的两条，子代理那条不见了。
        合并之后是"只见增加、不见减少"；最后写者赢的只剩同一身份的重复项。
        """
        disk: List[MemoryEntry] = []
        if self.path and self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding="utf-8", errors="replace"))
                for item in (data.get("entries") or []):
                    if not isinstance(item, dict):
                        continue
                    item.setdefault("session", "default")
                    try:
                        disk.append(MemoryEntry(**item))
                    except TypeError:
                        continue            # 磁盘上单条坏 → 跳过，不影响其它
            except (json.JSONDecodeError, ValueError, OSError):
                disk = []
        seen = {self._entry_key(e) for e in disk}
        out = list(disk)
        for e in self.entries:
            k = self._entry_key(e)
            if k not in seen:
                seen.add(k)
                out.append(e)
        return out

    def _persist(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        merged = self._merge_with_disk()
        data = {
            "entries": [asdict(e) for e in merged],
            "topic_anchors": self.topic_anchors,
            "topic_texts": self.topic_texts,
            "shift_count": self.shift_count,
        }
        # 临文件名带随机后缀：共享的 `.json.tmp` 在两个实例同时写时会互相踩
        tmp = self.path.with_name(f"{self.path.name}.{uuid.uuid4().hex[:8]}.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)
        self.entries = merged        # 内存视图跟上磁盘，后续写不再拿旧视图

    def _load(self) -> None:
        """逐条容错加载：单条坏只丢那一条；整个文件读不出来则隔离原文，**绝不自我清空**。"""
        if not self.path or not self.path.exists():
            return
        try:
            raw = self.path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            self.load_error = f"{type(e).__name__}: {e}"
            return
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError) as e:
            self.load_error = f"{type(e).__name__}: {e}"
            self.quarantined = self._quarantine()
            self.entries = []
            return
        entries: List[MemoryEntry] = []
        skipped = 0
        for item in (data.get("entries") or []):
            if not isinstance(item, dict):
                skipped += 1
                continue
            item = dict(item)
            item.setdefault("session", "default")
            try:
                entries.append(MemoryEntry(**item))
            except TypeError:
                skipped += 1          # 单条坏（缺字段/多字段）→ 只丢这一条
        self.entries = entries
        self.skipped_entries = skipped
        self.topic_anchors = data.get("topic_anchors") or {}
        self.topic_texts = data.get("topic_texts") or {}
        self.shift_count = data.get("shift_count") or 0


if __name__ == "__main__":
    a = MemoryArchive()
    for t in ["帮我写一段爬虫代码抓取新闻", "爬虫代码写好了吗", "给我写一篇关于夏天的小说开头"]:
        print(f"{t}  ->  {a.detect_topic_shift(t)}")
        a.add(t)
    print(json.dumps(a.stats(), ensure_ascii=False))
