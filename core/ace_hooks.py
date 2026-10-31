#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ace_hooks —— 事件钩子：把"你自己的检查"插进 ACE 的关键节点

为什么需要：ACE 内置的闸门是**通用**的（权限档、路径边界、AST 检查、快照）。但每个
团队都有自己的规矩 —— "不许改 migrations/ 下的文件"、"提交前必须过一遍 lint"、
"每次跑命令都要记一条审计"。这些规矩写进核心就是把某个团队的习惯变成所有人的负担；
写成钩子，才是"你的规矩你的脚本"。

四个事件（都在**执行层之外**，钩子是用户自己的代码）：

| 事件 | 时机 | 能做什么 |
|---|---|---|
| `session_start` | 会话建立 | 记一笔、准备环境（改不了任何决定） |
| `user_prompt` | 用户输入进模型**之前** | 改写/补充上下文（`additional_context`）或直接拦下（`decision: block`） |
| `pre_tool` | 工具**执行之前**（权限已放行） | 拦截这一次调用（`decision: block` + 理由回给模型） |
| `post_tool` | 工具执行之后 | 看结果、记审计、补充上下文（改不了已经发生的事） |

协议（刻意做成"任何语言都能写"）：

- 钩子命令从 **stdin** 读一个 JSON 对象（`{"event": ..., "tool": ..., "params": {...}}`）
- 从 **stdout** 回一个 JSON 对象（可空）：`{"decision": "allow"|"block",
  "reason": "...", "additional_context": "..."}`
- **退出码**：`0` = 放行；`2` = 拦截（stderr 当理由，与 Claude Code 的约定一致）；
  其它非零 = 出错，按 `on_error` 处理

失败语义（默认值是有意的）：

- `on_error` 默认 **`block`**（fail-close）。钩子崩了/超时了，**不能**当成"检查通过" ——
  那正好是"我加了检查、检查其实没跑"的最坏情形。要宽松就显式写 `"on_error": "warn"`。
- 拦截理由会回给模型（`pre_tool` 的 instruction 里），让它换路子而不是反复重试同一个调用。

边界（写在明面上）：钩子和 MCP server 一样是**用户配置的本地命令，不在 ACE 的沙箱里**。
执行层管不了它们内部干什么，只决定"要不要执行钩子、以及钩子说的话算不算数"。

纯逻辑（输出解析、配置规整、占位符替换）与进程 I/O 分开：前者可单测，后者用真脚本端到端验。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

__all__ = ["EVENTS", "HookSpec", "HookResult", "parse_hook_output", "load_hooks",
           "run_hook", "HookRunner", "DEFAULT_TIMEOUT", "MAX_STDOUT_BYTES"]

# 事件名（顺序即执行顺序的语义：session_start → user_prompt → pre_tool → post_tool → session_end）
EVENTS = ("session_start", "user_prompt", "pre_tool", "post_tool", "session_end")

DEFAULT_TIMEOUT = 10.0
MAX_STDOUT_BYTES = 200_000
# 回给模型/界面的理由长度上限：钩子可以话多，但上下文不该被它吃掉
MAX_REASON_CHARS = 600


@dataclass
class HookSpec:
    """一条钩子：命令 + 超时 + 出错怎么办。"""
    event: str
    command: str
    timeout: float = DEFAULT_TIMEOUT
    on_error: str = "block"          # block / warn
    name: str = ""

    def label(self) -> str:
        return self.name or self.command[:60]


@dataclass
class HookResult:
    """钩子跑完的结果。`decision` 只有 allow / block 两种，外加可选的补充上下文。"""
    decision: str = "allow"          # allow / block
    reason: str = ""
    additional_context: str = ""
    returncode: int = 0
    error: str = ""
    raw_stdout: str = ""
    elapsed: float = 0.0
    events: List[str] = field(default_factory=list)

    @property
    def blocked(self) -> bool:
        return self.decision == "block"


def _as_spec_list(raw: Any, event: str) -> List[HookSpec]:
    """把配置里的一条/多条钩子规整成 HookSpec 列表。

    支持三种写法，越短越常见：
      "python .ace/hooks/x.py"                       # 字符串
      {"command": "...", "timeout": 5, "on_error": "warn"}
      ["...", {...}, ...]                            # 列表（外面已经拍平一层）
    """
    items: List[Any]
    if raw is None:
        return []
    if isinstance(raw, (str, dict)):
        items = [raw]
    elif isinstance(raw, list):
        items = list(raw)
    else:
        return []
    out: List[HookSpec] = []
    for it in items:
        if isinstance(it, str):
            if it.strip():
                out.append(HookSpec(event=event, command=it.strip()))
        elif isinstance(it, dict):
            cmd = str(it.get("command") or "").strip()
            if not cmd:
                continue
            try:
                timeout = float(it.get("timeout") or DEFAULT_TIMEOUT)
            except (TypeError, ValueError):
                timeout = DEFAULT_TIMEOUT
            on_error = str(it.get("on_error") or "block").strip().lower()
            if on_error not in ("block", "warn"):
                on_error = "block"
            out.append(HookSpec(event=event, command=cmd, timeout=max(0.5, timeout),
                                on_error=on_error, name=str(it.get("name") or "")))
    return out


def load_hooks(hooks_cfg: Any, project_file: Optional[str] = None) -> Dict[str, List[HookSpec]]:
    """合并「用户配置的 hooks」与「项目内 .ace/hooks.json」，按事件分组。

    项目级**追加**在用户级之后（不是覆盖）："我个人习惯"和"这个仓库的规矩"本来就该
    一起生效。两个来源里不认识的事件名会被忽略 —— 配置写错时少跑一条钩子，
    比整场会话起不来要好，但 `/hooks` 会把无效项列出来。
    """
    raw: Dict[str, Any] = {}
    if isinstance(hooks_cfg, dict):
        for k, v in hooks_cfg.items():
            raw.setdefault(str(k), [])
            if isinstance(v, list):
                raw[str(k)].extend(v)
            else:
                raw[str(k)].append(v)
    if project_file:
        try:
            p = Path(project_file)
            if p.is_file():
                data = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    src = data.get("hooks") if isinstance(data.get("hooks"), dict) else data
                    for k, v in (src or {}).items():
                        raw.setdefault(str(k), [])
                        if isinstance(v, list):
                            raw[str(k)].extend(v)
                        else:
                            raw[str(k)].append(v)
        except (OSError, json.JSONDecodeError):
            pass
    out: Dict[str, List[HookSpec]] = {e: [] for e in EVENTS}
    for event, value in raw.items():
        if event not in EVENTS:
            continue
        out[event].extend(_as_spec_list(value, event))
    return out


def parse_hook_output(returncode: int, stdout: str, stderr: str,
                      on_error: str = "block") -> HookResult:
    """把「退出码 + stdout + stderr」翻译成 HookResult（纯函数，可单测）。

    规则（与文档里那张表一一对应）：
    - `0` 且 stdout 是合法 JSON 对象 → 用它的 decision / reason / additional_context
    - `0` 且 stdout 是普通文本 → 当补充说明（不改变决定）
    - `0` 且 stdout 为空 → 放行
    - `2` → 拦截，理由取 stderr（空则取 stdout）
    - 其它非零 → 按 `on_error`：`block` 拦截 / `warn` 放行但记 error
    """
    res = HookResult(returncode=int(returncode or 0))
    out = (stdout or "").strip()
    err = (stderr or "").strip()
    if returncode == 2:
        res.decision = "block"
        res.reason = (err or out or "钩子拒绝了这次调用（exit 2）")[:MAX_REASON_CHARS]
        return res
    if returncode != 0:
        msg = err or out or f"钩子退出码 {returncode}"
        res.error = msg[:MAX_REASON_CHARS]
        if on_error == "block":
            res.decision = "block"
            res.reason = f"钩子执行失败（exit {returncode}）：{res.error}"
        return res
    if not out:
        return res
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        # 退出 0 但不是 JSON：当成"附带说明"，不当错误 —— 钩子作者可能只是 echo 了一句
        res.additional_context = out[:MAX_REASON_CHARS]
        return res
    if not isinstance(data, dict):
        res.additional_context = out[:MAX_REASON_CHARS]
        return res
    decision = str(data.get("decision") or "allow").strip().lower()
    if decision not in ("allow", "block"):
        decision = "allow"
    res.decision = decision
    res.reason = str(data.get("reason") or "")[:MAX_REASON_CHARS]
    ctx = data.get("additional_context") or data.get("context") or ""
    if isinstance(ctx, list):
        ctx = "\n".join(str(x) for x in ctx)
    res.additional_context = str(ctx)[:MAX_REASON_CHARS]
    if res.decision == "block" and not res.reason:
        res.reason = "钩子拒绝（未给理由）"
    return res


# H-17：**绝不递给钩子**的环境变量。ACE 自己的模型凭据是确定的名字，直接摘掉；
# 各家厂商的 key 把常见的也列上。注意这只是"少给一点"，**不是边界** ——
# 真正的边界是执行层的项目级信任门（未受信任的仓库里那些钩子根本不加载），
# 因为环境变量的全集无法穷举（这一点在 H-06/H-11 已经被证明过一次）。
_HOOK_ENV_DENY = frozenset({
    "AGENT_API_KEY", "ACE_API_KEY", "ACE_E2E_API_KEY", "AI_CODE_API_KEY",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY",
    "MOONSHOT_API_KEY", "DASHSCOPE_API_KEY", "SILICONFLOW_API_KEY",
    "OPENROUTER_API_KEY", "ZHIPUAI_API_KEY", "QWEN_API_KEY",
})


def run_hook(spec: HookSpec, payload: Dict[str, Any], cwd: str = ".",
             env_extra: Optional[Dict[str, str]] = None) -> HookResult:
    """执行一条钩子：JSON 从 stdin 进，JSON 从 stdout 出。

    - 用 `shell=True` 是**有意**的：钩子命令是用户自己写的（可能带管道、`&&`），
      和 `terminal_exec` 那种"模型给什么就跑什么"完全不是一回事。
    - 超时即杀：钩子卡住会拖住整轮工具调用，而它只是个检查。
    - stdout 超限直接判错：钩子不该往协议流里灌一兆数据。
    """
    import time as _t
    env = {k: v for k, v in os.environ.items() if k not in _HOOK_ENV_DENY}
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env["ACE_HOOK_EVENT"] = spec.event
    if env_extra:
        env.update({str(k): str(v) for k, v in env_extra.items()})
    t0 = _t.monotonic()
    try:
        # nosec B602 —— 钩子命令来自**用户自己写的** hooks.json（H-17：该文件不入
        # 版本库、信任工作区后才生效），shell=True 是功能语义（用户可写管道/&&），
        # 非模型可控输入。同口径已有 noqa: S602。
        proc = subprocess.run(                       # noqa: S602 —— 用户自己的命令
            spec.command, shell=True, cwd=cwd, env=env,  # nosec B602
            input=json.dumps(payload, ensure_ascii=False),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=spec.timeout)
    except subprocess.TimeoutExpired:
        return HookResult(decision="block" if spec.on_error == "block" else "allow",
                          reason=f"钩子超时（{spec.timeout}s）",
                          error=f"timeout after {spec.timeout}s",
                          elapsed=_t.monotonic() - t0)
    except (OSError, ValueError) as e:
        return HookResult(decision="block" if spec.on_error == "block" else "allow",
                          reason=f"钩子无法执行：{e}", error=str(e),
                          elapsed=_t.monotonic() - t0)
    stdout = proc.stdout or ""
    if len(stdout) > MAX_STDOUT_BYTES:
        return HookResult(decision="block" if spec.on_error == "block" else "allow",
                          reason=f"钩子输出过大（{len(stdout)} 字节）",
                          error="stdout too large", elapsed=_t.monotonic() - t0)
    res = parse_hook_output(proc.returncode, stdout, proc.stderr or "", spec.on_error)
    res.elapsed = _t.monotonic() - t0
    res.raw_stdout = stdout[:MAX_REASON_CHARS]
    return res


class HookRunner:
    """按事件跑一组钩子，并把结果合并成"能不能继续"。

    合并规则（简单且可预测）：
    - 任何一条 `block` → 整体拦截，理由按顺序拼接（用户要看到**所有**反对意见，
      而不是第一条就停下 —— 否则修完一条又跳一条）
    - 没有 block → 放行，所有 `additional_context` 按顺序拼起来交给调用方
    """

    def __init__(self, hooks: Dict[str, List[HookSpec]], cwd: str = ".") -> None:
        self.hooks = hooks or {}
        self.cwd = cwd
        self.last_results: List[Tuple[HookSpec, HookResult]] = []
        self.runs = 0

    def has(self, event: str) -> bool:
        return bool(self.hooks.get(event))

    def run(self, event: str, payload: Dict[str, Any]) -> HookResult:
        """跑该事件下的全部钩子，返回合并结果。"""
        specs = self.hooks.get(event) or []
        if not specs:
            return HookResult()
        merged = HookResult(returncode=0)
        reasons: List[str] = []
        contexts: List[str] = []
        self.last_results = []
        for spec in specs:
            body = dict(payload)
            body["event"] = event
            res = run_hook(spec, body, cwd=self.cwd)
            self.runs += 1
            self.last_results.append((spec, res))
            merged.elapsed += res.elapsed
            if res.blocked:
                reasons.append(f"[{spec.label()}] {res.reason or '拒绝'}")
            if res.additional_context:
                contexts.append(res.additional_context)
            if res.error and not res.blocked:
                merged.error = (merged.error + "；" + res.error).strip("；")
        if reasons:
            merged.decision = "block"
            merged.reason = "；".join(reasons)[:MAX_REASON_CHARS]
        merged.additional_context = "\n".join(contexts)[:MAX_REASON_CHARS]
        return merged

    def status(self) -> List[Dict[str, Any]]:
        """给 `/hooks` 用：每个事件几条钩子、上次跑的结果。

        没跑过的钩子 `last` 为空串（**不是** None —— 早先这里直接取 `res.blocked`，
        没跑过的那些会让 `/hooks` 当场 AttributeError，冒烟时抓到）。
        """
        out: List[Dict[str, Any]] = []
        last: Dict[Tuple[str, str], HookResult] = {}
        for spec, res in self.last_results:
            last[(spec.event, spec.label())] = res
        for event in EVENTS:
            for spec in self.hooks.get(event) or []:
                res = last.get((event, spec.label()))
                if res is None:
                    state, detail = "", ""
                else:
                    state = ("block" if res.blocked
                             else ("error" if res.error else "ok"))
                    detail = res.reason or res.error or ""
                out.append({
                    "event": event, "name": spec.label(),
                    "command": spec.command[:120], "timeout": spec.timeout,
                    "on_error": spec.on_error,
                    "last": state, "detail": detail,
                })
        return out


def hook_payload(event: str, **fields: Any) -> Dict[str, Any]:
    """统一的钩子输入载荷（少而稳：工具名 + 参数 + 会话信息）。

    **不塞文件内容**：`file_write` 的 content 可能很大、也可能含用户不想交给钩子的东西；
    钩子真要那份内容，自己去读文件。这个取舍写在这里，免得以后有人"顺手"加上。
    """
    payload: Dict[str, Any] = {"event": event, "ace_version": _version()}
    payload.update(fields)
    params = payload.get("params")
    if isinstance(params, dict):
        # 参数里超过 4000 字符的字段截断（同样是"别把上下文交给钩子"的取舍）
        payload["params"] = {k: (v if not isinstance(v, str) or len(v) <= 4000
                                 else v[:4000] + "…(已截断)")
                             for k, v in params.items()}
    return payload


def _version() -> str:
    try:
        from core import version
        return str(version.__version__)
    except Exception:  # noqa: BLE001 —— 版本号取不到不该让钩子跑不起来
        return "0"


# 旧接口兼容：把 `$ARGUMENTS` 之类的替换逻辑放在这里，命令模块直接复用
# 支持两族：`$ARGUMENTS` / `$1` / `$2`（旧），以及 `${1}` / `${1:-默认}`（WP-1 提示词模板）。
_PLACEHOLDER = re.compile(r"\$(\d+|ARGUMENTS)|\$\{(\d+)(?::-([^}]*))?\}")


def substitute_placeholders(text: str, arguments: str) -> str:
    """`$ARGUMENTS` / `$1` / `$2` / `${1}` / `${1:-默认}` 替换（自定义命令用；纯函数、可单测）。

    `${N:-默认}`：第 N 个参数缺失（或为空）时用 `-` 后的默认值，而不是空串 ——
    让可选参数有落脚点（ROADMAP WP-1 提示词模板的插值写法）。
    """
    args = (arguments or "").split()

    def _rep(m: "re.Match[str]") -> str:
        if m.group(1) is not None:                 # $ARGUMENTS / $1 / $2（旧写法）
            key = m.group(1)
            if key == "ARGUMENTS":
                return arguments or ""
            idx = int(key) - 1
            return args[idx] if 0 <= idx < len(args) else ""
        idx = int(m.group(2)) - 1                  # ${N} / ${N:-默认}
        if 0 <= idx < len(args) and args[idx]:
            return args[idx]
        return m.group(3) if m.group(3) is not None else ""

    return _PLACEHOLDER.sub(_rep, text)


if sys.version_info < (3, 9):        # pragma: no cover —— 仅提示，不阻断
    print("ace_hooks 需要 Python 3.9+", file=sys.stderr)
