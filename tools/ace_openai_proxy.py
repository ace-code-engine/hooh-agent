#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_openai_proxy —— 把 ace 的引擎包成一个 **OpenAI 兼容端点**（给 dsh-TUI 当 provider 用）

## 这是什么（B 方案）

用户要的是"**UI 全用 dsh-TUI 的，引擎还是 ace 的**"。dsh-TUI 的 `/provider` 向导支持
自定义 `baseURL` + `apiKey` + `models` —— 所以这里给它一个本地端点：**它以为自己在跟一个
OpenAI 兼容模型说话，实际上每一轮都进了 ace 的完整引擎**（工具、权限、沙箱、审计、回滚
都在 ace 这边；DSH 那条工具链不会被用到，因为回过去的是**纯文本最终回复**，
DSH 看不到任何 `tool_calls`，`finish_reason` 直接是 `stop`）。

**审批**：`permission_request` 出来时旁边没有人在答。默认**一律拒绝**（`--allow` 才放行）——
"没人看着就自动放行写操作"是这个端点最不该有的行为。

## 鉴权（WP-AGENCY 之后的加固，别拆）

本地端口 ≠ 只有你自己够得着：**本机任意进程**都能连，而浏览器里的恶意页面可以用
`text/plain` 的「简单请求」绕过 CORS 预检直接 POST（本处理器不挑 Content-Type），
DNS rebinding 还能伪造 Host。所以三道闸都是必须的：

1. **Bearer token**（默认开）：token 持久存于锚式目录
   （`%LOCALAPPDATA%\ace-agent\state\<sha256(项目根)[:16]>\proxy_key`，与签名密钥同一处），
   跨启动稳定；`--api-key` 可显式指定（测试/脚本用）。请求必须带
   `Authorization: Bearer <token>`，不匹配一律 401（`hmac.compare_digest` 恒时比较）。
   dsh-TUI 侧用 `apiKeyEnv: ACE_PROXY_KEY` 把 token 送进来（`dsh_bridge_setup.py` 会写好）。
2. **Host 头校验**：只认环回名（`127.0.0.1` / `localhost` / `[::1]`）加本端口——
   rebinding 页面带来的陌生 Host 一律 403。
3. **`--allow` × 非环回 = 拒绝启动**：「没人看着就放行写操作」 PLUS 「监听在局域网上」
   不允许同时成立；组合直接退出而不是告警。

另有会话池上限（`--max-sessions`，每个 user 一个引擎子进程——放任就是 DoS）与
请求体上限（`--max-body`）。`/healthz` 是唯一免鉴权端点（只回 ok+模型名，无信息量）。

## 用法

```bash
python tools/ace_openai_proxy.py --project-root <项目> --permission readonly
#    启动即打印 token；把它设进 ACE_PROXY_KEY 后再起 dsh-tui。
python tools/ace_openai_proxy.py --show-key          # 只打印当前 token
# dsh-tui 侧：python tools/dsh_bridge_setup.py（写好 apiKeyEnv 路由）
```

`--mock` 可以离线跑通（不需要密钥），用来验证链路本身。
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import queue
import secrets
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

HERE = Path(__file__).resolve().parent.parent          # 仓库根（tools/ 的上一层）

MAX_SESSIONS_DEFAULT = 4
MAX_BODY_DEFAULT = 1 * 1024 * 1024                     # 1 MB —— 聊天请求绰绰有余


def proxy_key_path(project_root: str) -> Path:
    """token 的落盘位置：锚式目录（与 core.guardian 的锚**同一口径**）。

    6 行复制换来本脚本**零仓库依赖** —— 它要在任意 cwd 下被 dsh/用户直接拉起，
    import core 会把 sys.path 变成前提条件。两处口径由 test_all 的守卫测试钉住
    （proxy_key_path(project) == guardian.anchor_dir_for(project) 的兄弟文件）。
    """
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    else:
        base = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    ident = os.path.normcase(str(Path(project_root).resolve()))
    return (Path(base) / "ace-agent" / "state"
            / hashlib.sha256(ident.encode("utf-8")).hexdigest()[:16] / "proxy_key")


def load_or_create_key(project_root: str, explicit: str = "") -> str:
    """取鉴权 token：显式指定 > 锚式目录里的持久 token（没有就生成，跨启动稳定）。"""
    if explicit.strip():
        return explicit.strip()
    p = proxy_key_path(project_root)
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.is_file():
        val = p.read_text(encoding="utf-8").strip()
        if val:
            return val
    val = secrets.token_hex(24)
    p.write_text(val, encoding="utf-8")
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass
    return val


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
    """按 `user`（OpenAI 请求里的会话标识）分进程；没有就用一个默认会话。

    **上限**：`key` 来自请求体（攻击者可控），不放上限的话，一个循环就能把机器刷出
    几百个引擎子进程。满了先回收已退出的死会话，再按创建时间淘汰最旧的活会话；
    都不行才 503。淘汰用 `terminate()`（引擎自己会收尾，这里不等人）。
    """

    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self._lock = threading.Lock()
        self._sessions: Dict[str, AceSession] = {}
        self._born: Dict[str, float] = {}

    def get(self, key: str) -> AceSession:
        with self._lock:
            s = self._sessions.get(key)
            if s is None or s.proc.poll() is not None:
                if s is not None:
                    self._drop(key)                    # 死会话占位，先清
                while len(self._sessions) >= max(1, int(self.args.max_sessions)):
                    victim = min(self._sessions, key=lambda k: self._born.get(k, 0))
                    self._drop(victim)
                s = AceSession(self.args, key)
                self._sessions[key] = s
                self._born[key] = time.monotonic()
            return s

    def _drop(self, key: str) -> None:
        s = self._sessions.pop(key, None)
        self._born.pop(key, None)
        if s is not None:
            try:
                s.close()
            except Exception:                          # noqa: BLE001 —— 淘汰失败不拦新会话
                pass


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


def make_handler(pool: Pool, model: str, api_key: str = "",
                 max_body: int = MAX_BODY_DEFAULT) -> type:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *a: Any) -> None:      # noqa: A003
            sys.stderr.write("[ace-proxy] %s\n" % (fmt % a))

        # ---- 鉴权与边界（顺序固定：Host → 鉴权 → 请求体大小 → 业务） ----

        def _host_ok(self) -> bool:
            """只认环回名 + 本端口（DNS rebinding 的 Host 是攻击者域名 → 403）。

            `Host` 头由 HTTP 客户端按它**以为**在连的地址填：浏览器带 rebinding 的
            页面会填攻击者域名；直连 127.0.0.1 的 curl/进程填环回名。绑非环回地址时
            （显式 --host），那个 host:port 也放行 —— 用户自己开的口。
            """
            host = str(self.headers.get("Host") or "").strip().lower()
            if not host:
                return False
            port = self.server.server_address[1]
            allowed = {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}",
                       f"::1:{port}"}
            bind = str(self.server.server_address[0]).lower()
            # nosec B104 —— 这不是绑定调用，是 **Host 允许清单**：把实际绑定地址
            #（含用户显式选的 0.0.0.0 场景）加进"谁的 Host 头算合法"的集合，
            # 是 DNS rebinding 防御本身的一部分。
            if bind not in ("", "0.0.0.0", "::"):  # nosec B104
                allowed.add(f"{bind}:{port}")
            return host in allowed

        def _authed(self) -> bool:
            auth = str(self.headers.get("Authorization") or "")
            return bool(api_key) and hmac.compare_digest(auth, f"Bearer {api_key}")

        def _gate(self) -> bool:
            """三道闸都过了才放行业务；失败时已经回过响应，返回 False。"""
            if not self._host_ok():
                self._json(403, {"error": {"message": "host not allowed"}})
                return False
            if not self._authed():
                self.send_response(401)
                self.send_header("WWW-Authenticate", "Bearer")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return False
            return True

        def _json(self, code: int, obj: Any) -> None:
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:                              # noqa: N802
            if self.path.rstrip("/") in ("/healthz", "/"):
                # 唯一免鉴权端点：只回 ok + 模型名，没有可泄露的信息（探活用）。
                self._json(200, {"ok": True, "model": model})
                return
            if not self._gate():
                return
            if self.path.rstrip("/") in ("/v1/models", "/models"):
                self._json(200, {"object": "list", "data": [
                    {"id": model, "object": "model", "created": 0, "owned_by": "ace"}]})
                return
            self._json(404, {"error": {"message": "not found"}})

        def do_POST(self) -> None:                             # noqa: N802
            if not self._gate():
                return
            if self.path.rstrip("/") not in ("/v1/chat/completions", "/chat/completions"):
                self._json(404, {"error": {"message": "not found"}})
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length > max_body:
                self._json(413, {"error": {"message": f"body too large (> {max_body} bytes)"}})
                return
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
    ap.add_argument("--api-key", default="",
                    help="显式指定鉴权 token（缺省：持久 token 存锚式目录，--show-key 可看）")
    ap.add_argument("--show-key", action="store_true",
                    help="只打印当前 token 然后退出（给 ACE_PROXY_KEY 用）")
    ap.add_argument("--max-sessions", type=int, default=MAX_SESSIONS_DEFAULT,
                    help="引擎子进程池上限（每个 user 一个；防请求刷子）")
    ap.add_argument("--max-body", type=int, default=MAX_BODY_DEFAULT,
                    help="请求体字节数上限")
    ap.add_argument("--mock", action="store_true", help="离线演示（不需要密钥）")
    ap.add_argument("--python", default="", help="用哪个解释器起引擎（默认当前解释器）")
    ap.add_argument("--model", default="ace", help="对外暴露的模型名")
    args = ap.parse_args(argv)

    if args.show_key:
        print(load_or_create_key(args.project_root, args.api_key))
        return 0
    if args.allow and args.host not in ("127.0.0.1", "localhost", "::1"):
        # 「没人看着就放行」叠加「监听在局域网」——这个组合不存在合理用途，
        # 拒绝启动而不是告警（与 never+off 启动即拒是同一条立场）。
        print("[ace-proxy] 拒绝启动：--allow（无人值守放行审批）不能与"
              "非环回的 --host (%s) 组合。要么去掉 --allow，要么绑回 127.0.0.1。"
              % args.host, file=sys.stderr)
        return 2

    api_key = load_or_create_key(args.project_root, args.api_key)
    pool = Pool(args)
    # nosec B104 —— 绑定面受三道闸保护（文件头注释 §闸门）：① 每请求 Bearer token
    #（启动时生成、落盘 0600）；② Host 头只认环回名（DNS rebinding → 403）；
    # ③ --allow（无人值守放行审批）与非环回 --host 的组合被显式拒绝（上方 438 行）。
    # 默认 --host 是 127.0.0.1；绑 0.0.0.0 是用户显式选择（如容器内），闸门照常生效。
    srv = ThreadingHTTPServer((args.host, args.port),  # nosec B104 —— 三道闸：Bearer token / Host 环回校验 / --allow×非环回组合显式拒绝（见下方说明与文件头）
                              make_handler(pool, args.model, api_key, args.max_body))  # nosec B104
    sys.stderr.write("[ace-proxy] http://%s:%d/v1  model=%s  root=%s  permission=%s%s\n"
                     % (args.host, args.port, args.model, args.project_root,
                        args.permission, "  MOCK" if args.mock else ""))
    sys.stderr.write("[ace-proxy] auth=Bearer（token 持久存于 %s；"
                     "dsh 侧用 ACE_PROXY_KEY，`--show-key` 可打印）\n" % proxy_key_path(args.project_root))
    sys.stderr.flush()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
        for s in list(pool._sessions.values()):        # noqa: SLF001 —— 收尾清池
            try:
                s.close()
            except Exception:                          # noqa: BLE001
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
