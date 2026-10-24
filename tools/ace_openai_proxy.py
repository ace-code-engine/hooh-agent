#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_openai_proxy —— 把 ace 的引擎包成一个 **OpenAI 兼容端点**（给 dsh-TUI 当 provider 用）

## 这是什么（B 方案）

用户要的是"**UI 全用 dsh-TUI 的，引擎还是 ace 的**"。dsh-TUI 的 `/provider` 向导支持
自定义 `baseURL` + `apiKey` + `models` —— 所以这里给它一个本地端点：**它以为自己在跟一个
OpenAI 兼容模型说话，实际上每一轮都进了 ace 的完整引擎**（工具、权限、沙箱、审计、回滚
都在 ace 这边；DSH 那条工具链不会被用到，因为回过去的是**纯文本最终回复**，
DSH 看不到任何 `tool_calls`，`finish_reason` 直接是 `stop`）。

## 怎么说话

用引擎自己的 `--serve`（`core/ace_serve`，双向 NDJSON）：

```
→ {"v":1,"type":"req","id":"1","method":"initialize","params":{"protocol":1,"stream":true}}
← {"v":1,"type":"resp","id":"1","ok":true,...}
→ {"v":1,"type":"req","id":"2","method":"user.message","params":{"text":"你好"}}
← {"v":1,"type":"event","seq":1,"event":{"type":"model_delta","text":"你"}}
← {"v":1,"type":"event","seq":9,"event":{"type":"final","text":"你好。"}}     ← 拿这个当回答
← {"v":1,"type":"resp","id":"2","ok":true,...}                                ← 一轮结束
```

**审批**：`permission_request` 出来时旁边没有人在答。默认**一律拒绝**（`--allow` 才放行）——
"没人看着就自动放行写操作"是这个端点最不该有的行为。

## 用法

```bash
python tools/ace_openai_proxy.py --project-root G:\AI_Project\ace --permission readonly
# 然后在 dsh-TUI 里：/provider → 添加自定义 → baseURL http://127.0.0.1:8787/v1
#                  apiKey 随便填（ace 不校验）→ models: ace → 选 ace
```

`--mock` 可以离线跑通（不需要密钥），用来验证链路本身。
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

HERE = Path(__file__).resolve().parent.parent          # 仓库根（tools/ 的上一层）


# ── 引擎会话（一条 OpenAI 会话 = 一个 --serve 子进程）────────────────────────────

class AceSession:
    """一个 `ai_code.py --serve` 子进程 + 它的 NDJSON 收发。

    为什么一条会话一个进程：ace 的上下文在**进程内**（messages/执行层/审计都在里面）。
    OpenAI 那套每轮会把整段历史再发一遍，我们**不重放历史** —— 只把"新出现的那几条
    用户消息"喂进去（见 `_new_user_texts`），否则 ace 会把同一句话听两遍。
    """

    def __init__(self, args: argparse.Namespace, key: str) -> None:
        self.key = key
        self.args = args
        self._lock = threading.Lock()
        self._seq = 0
        self._frames: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self._seen_users = 0                      # 已经喂进去过几条 user 消息
        self.proc: subprocess.Popen = None        # type: ignore[assignment]
        self._spawn()

    def _cmd(self) -> List[str]:
        py = self.args.python or sys.executable
        cmd = [py, str(HERE / "ai_code.py"), "--serve",
               "--project-root", str(self.args.project_root),
               "--permission", str(self.args.permission)]
        if self.args.mock:
            cmd.append("--mock")
        return cmd

    def _spawn(self) -> None:
        env = dict(os.environ)
        env.setdefault("PYTHONIOENCODING", "utf-8")
        env["ACE_NO_ANIM"] = "1"                  # 端点里不播开屏动效
        proc = subprocess.Popen(                     # noqa: S603 —— 命令行是本文件拼的
            self._cmd(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, cwd=str(self.args.project_root),
            env=env, text=True, encoding="utf-8", bufsize=1,
        )
        # **先挂上再握手**：`request()` 要写 `self.proc.stdin`（第一版在赋值前就发了
        # initialize，直接 AttributeError —— 端点整个 500）。
        self.proc = proc
        threading.Thread(target=self._reader, args=(proc,), daemon=True).start()
        self.request("initialize", {"protocol": 1, "stream": True})

    def _reader(self, proc: subprocess.Popen) -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                self._frames.put(json.loads(line))
            except json.JSONDecodeError:
                continue
        self._frames.put({"type": "__eof__"})

    def request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        self._seq += 1
        rid = str(self._seq)
        frame = {"v": 1, "type": "req", "id": rid, "method": method, "params": params}
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(frame, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        return {"id": rid}

    def _next(self, timeout: float) -> Optional[Dict[str, Any]]:
        try:
            return self._frames.get(timeout=timeout)
        except queue.Empty:
            return None

    def turn(self, text: str, on_delta: Optional[Callable[[str], None]] = None,
             timeout: float = 900.0) -> str:
        """跑一轮，返回**最终回复文本**；`on_delta` 收到流式增量就回调（给 SSE 用）。"""
        with self._lock:
            rid = self.request("user.message", {"text": text})["id"]
            deadline = time.monotonic() + timeout
            final = ""
            while time.monotonic() < deadline:
                frame = self._next(1.0)
                if frame is None:
                    continue
                if frame.get("type") == "__eof__":
                    break
                if frame.get("type") == "event":
                    ev = frame.get("event") or {}
                    kind = ev.get("type")
                    if kind == "model_delta" and on_delta is not None:
                        on_delta(str(ev.get("text") or ""))
                    elif kind == "final":
                        final = str(ev.get("text") or "")
                    elif kind in ("permission_request", "choice_request"):
                        # 没人在旁边答：默认拒绝。**不静默放行写操作。**
                        decision = "deny" if not self.args.allow else "session"
                        if kind == "permission_request":
                            self.request("permission.answer", {"decision": decision})
                        else:
                            self.request("choice.answer", {"cancelled": True})
                elif frame.get("type") == "resp" and str(frame.get("id")) == rid:
                    break
            return final

    def new_user_texts(self, messages: List[Dict[str, Any]]) -> List[str]:
        """OpenAI 那段历史里**还没喂过**的用户消息（正常的客户端只会多出一条）。

        兜底：一条都没多（客户端把同一段历史又发了一遍）时，**喂最后那条用户消息**。
        宁可让 ace 再答一遍，也不要在界面上留一条空回答 —— 那是"看起来坏了"。
        """
        users = [str(m.get("content") or "") for m in messages if m.get("role") == "user"]
        fresh = users[self._seen_users:]
        self._seen_users = len(users)
        if not fresh and users:
            return [users[-1]]
        return fresh

    def close(self) -> None:
        try:
            self.request("shutdown", {})
        except Exception:                            # noqa: BLE001
            pass
        try:
            self.proc.terminate()
        except Exception:                            # noqa: BLE001
            pass


class Pool:
    """按 `user`（OpenAI 请求里的会话标识）分进程；没有就用一个默认会话。"""

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self._lock = threading.Lock()
        self._sessions: Dict[str, AceSession] = {}

    def get(self, key: str) -> AceSession:
        with self._lock:
            s = self._sessions.get(key)
            if s is None or s.proc.poll() is not None:
                s = AceSession(self.args, key)
                self._sessions[key] = s
            return s


# ── HTTP ──────────────────────────────────────────────────────────────────────

def _completion(model: str, content: str) -> Dict[str, Any]:
    return {
        "id": "chatcmpl-" + uuid.uuid4().hex[:24],
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content},
                     "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def make_handler(pool: Pool, model: str) -> type:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *a: Any) -> None:      # noqa: A003
            sys.stderr.write("[ace-proxy] %s\n" % (fmt % a))

        def _json(self, code: int, obj: Any) -> None:
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:                              # noqa: N802
            if self.path.rstrip("/") in ("/v1/models", "/models"):
                self._json(200, {"object": "list", "data": [
                    {"id": model, "object": "model", "created": 0, "owned_by": "ace"}]})
                return
            if self.path.rstrip("/") in ("/healthz", "/"):
                self._json(200, {"ok": True, "model": model})
                return
            self._json(404, {"error": {"message": "not found"}})

        def do_POST(self) -> None:                             # noqa: N802
            if self.path.rstrip("/") not in ("/v1/chat/completions", "/chat/completions"):
                self._json(404, {"error": {"message": "not found"}})
                return
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                self._json(400, {"error": {"message": "bad json"}})
                return
            messages = body.get("messages") or []
            stream = bool(body.get("stream"))
            key = str(body.get("user") or "default")
            session = pool.get(key)
            fresh = session.new_user_texts(messages)
            text = "\n".join(fresh).strip()

            if stream:
                self._stream(session, text, body.get("model") or model)
                return
            answer = session.turn(text) if text else ""
            self._json(200, _completion(body.get("model") or model, answer))

        def _stream(self, session: AceSession, text: str, model_name: str) -> None:
            """SSE —— 有的客户端（含 DSH）只认流式。"""
            cid = "chatcmpl-" + uuid.uuid4().hex[:24]
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()

            def chunk(delta: Dict[str, Any], finish: Optional[str] = None) -> None:
                payload = {"id": cid, "object": "chat.completion.chunk",
                           "created": int(time.time()), "model": model_name,
                           "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
                self.wfile.write(("data: " + json.dumps(payload, ensure_ascii=False) +
                                  "\n\n").encode("utf-8"))
                self.wfile.flush()

            try:
                chunk({"role": "assistant", "content": ""})
                if text:
                    session.turn(text, on_delta=lambda d: chunk({"content": d}))
                chunk({}, "stop")
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return

    return Handler


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="把 ace 引擎包成 OpenAI 兼容端点")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--project-root", default=os.getcwd(),
                    help="ace 的工作目录（**必须**给对：会话日志落在它的 .ace_sessions/）")
    ap.add_argument("--permission", default="readonly",
                    choices=["readonly", "write", "full"],
                    help="权限档；默认 readonly（端点无人值守，只读最安全）")
    ap.add_argument("--allow", action="store_true",
                    help="审批请求一律放行（**默认拒绝**：没人看着不该自动放行写操作）")
    ap.add_argument("--mock", action="store_true", help="离线演示（不需要密钥）")
    ap.add_argument("--python", default="", help="用哪个解释器起引擎（默认当前解释器）")
    ap.add_argument("--model", default="ace", help="对外暴露的模型名")
    args = ap.parse_args(argv)

    pool = Pool(args)
    srv = ThreadingHTTPServer((args.host, args.port), make_handler(pool, args.model))
    sys.stderr.write("[ace-proxy] http://%s:%d/v1  model=%s  root=%s  permission=%s%s\n"
                     % (args.host, args.port, args.model, args.project_root,
                        args.permission, "  MOCK" if args.mock else ""))
    sys.stderr.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
