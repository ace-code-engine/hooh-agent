#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
agent_runner.py —— Agent 交互循环（把 LLM 和执行层接起来）

职责：
    用户输入 → L3 模型生成 <INTERNAL>/<EXTERNAL> → ExecutionLayer 解析/裁决/执行
    → 结果回填模型 → 循环，直到模型给出最终回复（模式 B）

模型来源（优先级从高到低）：
    1. --mock                         脚本化假模型，离线演示完整循环
    2. --base-url / --api-key / --model  OpenAI 兼容 API（OpenAI/DeepSeek/Ollama/vLLM...）
    3. 环境变量 AGENT_BASE_URL / AGENT_API_KEY / AGENT_MODEL

用法：
    python agent_runner.py --mock                          # 离线演示（无需网络/密钥）
    python agent_runner.py --mock --verbose --input 现在几点了
    python agent_runner.py --base-url https://api.deepseek.com/v1 \
        --api-key sk-xxx --model deepseek-chat              # 接真实模型
    python agent_runner.py --base-url http://localhost:11434/v1 \
        --api-key ollama --model Qwen2.5-coder:7b --tools   # 本地 Ollama（原生工具调用）
    python agent_runner.py --mock --max-history 12          # 离线演示 + 历史裁剪
"""

import argparse
import hashlib
import json
import logging
import os
import shutil
import re
import sys
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("ace")

# Windows GBK 控制台兼容：强制 UTF-8 输出（否则 emoji 会 UnicodeEncodeError）
for _stream in (sys.stdout, sys.stderr):
    try:
        if _stream.encoding and _stream.encoding.lower() not in ("utf-8", "utf8"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

FOLDER = Path(__file__).resolve().parent
sys.path.insert(0, str(FOLDER))
# 终端编码防线：绝不因为一个字符把一次运行打断（见 core/ace_io.py）
try:
    from core import ace_io as _ace_io
    _ace_io.harden_streams()
except Exception:  # noqa: BLE001 —— 加固失败也要能跑
    pass


from execution_layer import ExecutionLayer  # noqa: E402
import execution_layer  # noqa: E402  （模块级纯函数：无人值守边界判断）
from core.ace_isolation import untrusted_source, wrap_untrusted  # noqa: E402
from core import ace_client  # noqa: E402  （模型 HTTP 客户端：与 ai_code 共用唯一一份）
from core import ace_model  # noqa: E402
from tools.base import repair_backslash_json  # noqa: E402
from tools.registry import openai_tools  # noqa: E402
from tools.status import (REFUSAL_CLASS_AUTH_PENDING,  # noqa: E402
                          REFUSAL_CLASS_BOUNDARY, REFUSAL_CLASS_CAPABILITY,
                          REFUSAL_CLASS_MALFORMED, REFUSAL_CLASS_POLICY,
                          REFUSAL_CLASS_TRANSIENT, classify_refusal, outcome_for)
from ui import ace_grace  # noqa: E402  （纯逻辑：危险对话框的防误触宽限期）


PROMPT_DIR = FOLDER / "prompts"
SYSTEM_PROMPT_PATH = PROMPT_DIR / "agent_system_prompt_v7.md"
SYSTEM_PROMPT_V8_PATH = PROMPT_DIR / "agent_system_prompt_v8.md"
SYSTEM_PROMPT_TOOLS_PATH = PROMPT_DIR / "agent_system_prompt_tools.md"
MAX_ROUNDS = 20

# 授权通过/拒绝的提示词（语义与 execution_layer 的 PROMPT_PERM_* 同一件事）。
# 脚本化模型据此知道"刚才那个调用被拦下了"，从而**重发同一个调用** —— 真模型就是
# 这么做的（`PROMPT_PERM_GRANTED` 的字面要求）。脚本不重发就会造出"批准了、但从没
# 执行过"的假流程，让反幻觉闸门（正确地）把它拦下，一路烧到轮数上限。
_MOCK_GRANT_MARKERS = ("用户已授权", "请重试刚才被拦截的工具")


def load_system_prompt(tools_mode: bool = False) -> str:
    """加载系统提示词；tools_mode=True 用原生工具调用精简版，否则用文本协议版（v8 优先，v7 兜底）"""
    candidates = [SYSTEM_PROMPT_TOOLS_PATH if tools_mode else SYSTEM_PROMPT_V8_PATH,
                  SYSTEM_PROMPT_PATH]
    for p in candidates:
        if p.exists():
            return p.read_text(encoding="utf-8")
    return "你是一个沙盒 AI Agent，按 <INTERNAL>/<EXTERNAL> 格式输出。"


class ToolsUnsupported(Exception):
    """模型端点不支持原生工具调用，触发自动降级到文本协议"""


class TruncatedOutput(Exception):
    """模型输出被 `max_tokens` 截断（H-19）。

    **为什么必须单独区分**：截断时工具调用的 JSON 是**未闭合**的，`tool_calls_to_protocol`
    的 JSON 修复两条路都会失败，于是 `args` 退化成 `{}` —— 那次工具调用必然报 400。
    而执行层的"同工具同错误连续失败"计数会因此涨，**3 次之后该工具被整会话熔断**
    （"工具 file_write 已连续失败 3 次，已被熔断"）。更糟的是每次回喂的 prompt 都在变长，
    所以截断是**确定性复现**的 —— 模型永远修不好，工具永远被禁。

    真实原因（"输出太长被截断"）与"参数写错了"完全是两回事，回喂的证据必须分开，
    而且**绝不能**计进那个熔断计数。
    """


def retry_notice(decision, attempt: int) -> None:
    """把 ace_http 的退避决定告诉用户。ai_code 也用这一份。

    必须写 stderr：ai_code 那边 stdout 正被流式渲染器（打字机效果 / 状态行）占着，
    往里插一行会把画面搅乱。而完全不提示更糟 —— 一次 429 带 Retry-After: 30 的退避，
    在用户看来和卡死没有区别，他会去按 Ctrl-C。
    """
    src = "服务端指定" if decision.source == "retry_after" else "退避"
    print(f"\n  ⏳ 第 {attempt} 次请求失败，{src} {decision.delay:.1f}s 后重试"
          f"（{decision.reason}）", file=sys.stderr, flush=True)


def _post_chat(base_url: str, api_key: str, model: str, messages: List[Dict],
               tools: Optional[List[Dict]] = None, timeout: int = 120) -> Dict:
    """OpenAI 兼容的对话补全端点 —— 实现在 core/ace_client.py，与 ai_code 共用一份。

    这里只留"这次请求长什么样"：一次性（非流式）、把 system 提示词拼进 messages、
    温度 0.2。URL/头/重试/错误规范化都在 ace_client 里，两个前端不会再各写一遍。

    429 / 5xx / 连接抖动由 ace_http（在 ace_client 里面）退避重试；4xx 抛
    `ace_client.ChatHTTPError`，它带的 `.body` 就是错误正文 —— _generate_tools 的
    tools 降级判断靠它照常工作。
    """
    return ace_client.chat_once(base_url, api_key, model, "openai",
                                "", messages, tools=tools, timeout=timeout,
                                on_retry=retry_notice)


# ============================================================
# 原生工具调用（OpenAI 兼容 function calling，Ollama/Qwen 等均支持）
# ============================================================

TOOLS = openai_tools()  # 由 tools/registry.py 的 TOOL_SPECS 派生，勿在此手写工具


def tools_for_permission(level: str) -> List[Dict]:
    """按权限等级裁剪发给模型的工具列表。

    理由：把全部工具直接发给 7B 小模型是认知超载（数量随 registry 增长）（记不住参数、乱选工具的根源），
    而 readonly 权限下写工具反正会被执行层 403 —— 让模型"看得见但用不了"
    只会诱导它去申请权限。按等级裁剪后模型只在真实可用的工具里决策。
    控制类工具（plan_propose / request_permission）任何等级都保留。
    """
    from execution_layer import (CONTROL_TOOLS, HIGH_RISK_TOOLS,
                                 READ_TOOLS, WRITE_TOOLS)
    level = (level or "readonly").lower()
    if level == "full":
        allowed = READ_TOOLS | WRITE_TOOLS | HIGH_RISK_TOOLS | CONTROL_TOOLS
    elif level == "write":
        allowed = READ_TOOLS | WRITE_TOOLS | CONTROL_TOOLS
    else:
        allowed = READ_TOOLS | CONTROL_TOOLS
    return [t for t in TOOLS if t["function"]["name"] in allowed]



TOOL_NAMES = {t["function"]["name"] for t in TOOLS}


def tool_calls_to_protocol(tool_calls: List[Dict]) -> str:
    """把原生工具调用转换为 <INTERNAL>/<EXTERNAL> 协议文本，复用执行层同一代码路径。

    **每轮只执行第一个调用** —— 执行层管线是单调用契约（权限/快照/审计按一次一个
    裁决），`agent_system_prompt_tools.md` 也明确要求模型一次只发一个。模型一次发了
    多个时**不再静默丢弃**（那会让模型以为都执行了——正是反幻觉闸门要抓的"说了没做"
    的机器版）：多余的调用在 INTERNAL 里点名留痕（进会话日志可查）并打 stderr；
    执行结果只含第一个调用，模型据此逐个重发（提示词同时写明这条规则）。
    """
    if not tool_calls:
        return ""
    extras = tool_calls[1:]
    tc = tool_calls[0]
    fn = tc.get("function") or {}
    name = fn.get("name", "")
    raw_args = fn.get("arguments")
    if isinstance(raw_args, dict):
        args = raw_args
    else:
        try:
            args = json.loads(raw_args or "{}")
        except (json.JSONDecodeError, TypeError):
            # 模型可能把 Windows 绝对路径写进 arguments 字符串（C:\Users → \U 非法转义）
            try:
                args = json.loads(repair_backslash_json(raw_args or "{}"))
            except (json.JSONDecodeError, TypeError):
                args = {}
    # 兼容部分端点直接把 name/arguments 放在顶层
    if not name:
        name = tc.get("name", "")
    if not args and isinstance(tc.get("arguments"), dict):
        args = tc["arguments"]
    if not isinstance(args, dict):
        args = {}
    # 多余调用：点名 + 留痕，绝不静默（模型会以为"都做了"）
    extra_note = ""
    if extras:
        names = ", ".join(str((c.get("function") or {}).get("name") or c.get("name")
                              or "?") for c in extras)
        extra_note = (f"[ACT] ⚠ 另有 {len(extras)} 个并行调用被暂存（每轮只执行一个）：{names}。"
                      f"结果回来后请逐个重发。")
        print(f"  ⚠ 模型一次发了 {len(extras) + 1} 个工具调用：执行第一个（{name}），"
              f"其余已暂存并要求逐个重发", file=sys.stderr, flush=True)
    body = json.dumps({"tool": name, **args}, ensure_ascii=False)
    return (f"<INTERNAL>\n[INTERNAL_THINKING]\n"
            f"[ACT] 原生工具调用: {name}\n"
            + (extra_note + "\n" if extra_note else "")
            + f"[/INTERNAL_THINKING]\n</INTERNAL>\n"
            f"<EXTERNAL>\nanswer.\n{body}\n</EXTERNAL>")


def final_reply_protocol(content: str) -> str:
    """把模型无工具调用的纯文本回答包装为协议模式 B（最终回复）"""
    return (f"<INTERNAL>\n[INTERNAL_THINKING]\n"
            f"[REASON] 信息已足够，输出最终回复\n[/INTERNAL_THINKING]\n</INTERNAL>\n"
            f"<EXTERNAL>\nanswer.\n{content.strip()}\n</EXTERNAL>")


# 模型"声称已完成写操作"的措辞检测：判据在 `core/ace_claims.py`（H-20）。
# 为什么搬走：**执行层也要用它**。此前这道闸门只在 CLI 里，headless / CI / SDK
# 完全没有防线（零工具调用 + "我已经创建了 x.py" ⇒ 直接 print 然后 return，退出码 0）。
# 而 `execution_layer` 不能 import `agent_runner`（会成环），所以判据收进 core，两边都取它。
# 这里保留同名转发，让 `agent_runner.claims_completed_action` 这类历史调用点照旧可用。
from core.ace_claims import claims_completed_action as _claims_core  # noqa: E402
from core.ace_claims import PROMPT_UNVERIFIED_CLAIM as _CORE_PROMPT_UNVERIFIED_CLAIM  # noqa: E402


def claims_completed_action(content: str) -> bool:
    """模型是否在"没有调用任何工具"的前提下声称自己完成了文件/命令操作。

    判据在 `core/ace_claims.py`（唯一来源），这里只转发 —— 见本段上方的说明。
    """
    return _claims_core(content)



def sanitize_plain_content(content: str) -> str:
    """tools 模式下模型偶尔输出思考标签/协议残片，清洗成纯文本。
    完整协议则提取 EXTERNAL 正文；思考块包裹正文时删除整块；
    若整段输出都是思考块（小模型把回答写进思考块），则取其内容作为回复。"""
    text = (content or "")
    m = re.search(r"<EXTERNAL>\s*(?:answer\.)?(.*?)</EXTERNAL>",
                  text, re.DOTALL | re.IGNORECASE)
    if m:
        text = m.group(1)
    # 捕获思考块正文（兼容缺失闭合括号，如 [INTERNAL_THINKING 无 ]）
    thinking_m = re.search(
        r"\[/?\s*INTERNAL_THINKING\s*\]?\s*(.*?)\s*\[/?\s*INTERNAL_THINKING\s*\]?",
        text, re.DOTALL | re.IGNORECASE)
    # 删除思考块（含内容）
    text = re.sub(
        r"\[/?\s*INTERNAL_THINKING\s*\]?.*?\[/?\s*INTERNAL_THINKING\s*\]?",
        "", text, flags=re.DOTALL | re.IGNORECASE)
    # 删除残留标签与状态标签
    text = re.sub(r"\[?/?\s*INTERNAL_THINKING\s*\]?", "", text, flags=re.IGNORECASE)
    for label in ("PLAN", "REASON", "ACT", "OBSERVE", "REPLAN", "CHECK",
                  "EXPLORE", "DESIGN", "REVIEW", "FINALIZE", "EXECUTE"):
        text = re.sub(rf"\[{label}\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?INTERNAL\s*>?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?EXTERNAL\s*>?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^\s*answer\.\s*", "", text)
    cleaned = text.strip()
    if not cleaned and thinking_m and thinking_m.group(1).strip():
        cleaned = thinking_m.group(1).strip()
    return cleaned


def _extract_json_objects(text: str) -> List[str]:
    """从文本中提取所有最外层完整平衡的 {...} JSON 对象片段。
    正确处理字符串内的花括号/转义/```围栏，防止模型把 markdown 围栏
    嵌进 JSON 字符串（如 plan 步骤里带 ```python 代码）时提取错乱。"""
    objs: List[str] = []
    n = len(text)
    i = 0
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        depth = 0
        in_str = False
        esc = False
        start = i
        j = i
        while j < n:
            c = text[j]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        objs.append(text[start:j + 1])
                        i = j
                        break
            j += 1
        i += 1
    return objs


def content_to_tool_protocol(content: str) -> str:
    """部分本地模型（如 Ollama 上的 Qwen）把工具调用写成 JSON 文本而非结构化 tool_calls。
    识别两种文本 schema：项目自有 {"tool": ...} 与 Ollama 原生 {"name", "arguments"}；
    从 ``` 围栏块 + 平衡花括号扫描中提取候选并逐个尝试；
    只转换已注册的工具名，防止误伤正常 JSON 回答。"""

    def _convert(obj: dict) -> str:
        if not isinstance(obj, dict):
            return ""
        if isinstance(obj.get("tool"), str) and obj["tool"].strip() in TOOL_NAMES:
            extra = {k: v for k, v in obj.items() if k != "tool"}
            return tool_calls_to_protocol([
                {"function": {"name": obj["tool"],
                              "arguments": json.dumps(extra, ensure_ascii=False)}}])
        name = obj.get("name")
        args = obj.get("arguments")
        if (isinstance(name, str) and name.strip() in TOOL_NAMES
                and isinstance(args, dict)):
            return tool_calls_to_protocol([
                {"function": {"name": name,
                              "arguments": json.dumps(args, ensure_ascii=False)}}])
        return ""

    text = (content or "").strip()
    candidates: List[str] = []
    if "```" in text:
        for m in re.finditer(r"```[a-zA-Z0-9_+-]*\s*(.*?)```", text, re.DOTALL):
            candidates.append(m.group(1).strip())
    else:
        candidates.append(text)
    # 增强：平衡花括号扫描，防嵌套围栏/正文干扰导致漏识别
    for obj in _extract_json_objects(text):
        candidates.append(obj)
    for cand in candidates:
        if not cand.startswith("{"):
            continue
        try:
            obj = json.loads(cand)
        except json.JSONDecodeError:
            # Windows 绝对路径（C:\Users → \U 非法转义）会导致解析失败，修复后重试
            try:
                obj = json.loads(repair_backslash_json(cand))
            except json.JSONDecodeError:
                continue
        converted = _convert(obj)
        if converted:
            return converted
    return ""


class ModelProvider:
    """L3 模型接入：mock（离线演示）或 OpenAI 兼容 API"""

    def __init__(self, args) -> None:
        self.mode = "mock" if args.mock else "api"
        self.base_url = args.base_url or os.environ.get("AGENT_BASE_URL")
        self.api_key = args.api_key or os.environ.get("AGENT_API_KEY")
        self.model = args.model or os.environ.get("AGENT_MODEL") or "default"
        self.tools = bool(getattr(args, "tools", False))             # 原生工具调用开关
        self.max_history = int(getattr(args, "max_history", 0) or 0)  # 0 = 不裁剪
        self.tools_ok = self.tools                                   # 端点不支持时自动降级
        # 按权限等级裁剪发给模型的工具列表（readonly 只给只读+控制工具）
        self.permission_level = getattr(args, "permission", "readonly") or "readonly"
        # 把真实工作目录注入系统提示词，防止小模型臆造路径
        project_root = str(getattr(args, "project_root", "."))
        self.system_suffix = (f"\n\n【工作目录】{os.path.abspath(project_root)}\n"
                              f"文件操作请使用该目录下的相对路径或该绝对路径，不要臆造路径。")
        self.history: List[Dict[str, str]] = []
        # HL-03 硬规则②（THREE-LAYERS §3.4）：**降级必须声明**，不许静默回退。
        # 与 `execution_layer._note_degrade` 同一份契约、同一套出口：结构化账本
        # （`degradations`，供外壳/审计/测试读）+ stderr 一行（人当场看得见）。
        # 为什么 `agent_runner` 这份不能省：tools→文本协议那条降级此前**只在注释里**
        # （"本次自动降级"），用户看到的是"模型突然改用另一种格式"，没人告诉他为什么、
        # 也没人能量出这个会话到底降级过没有。
        self.degradations: List[Dict[str, str]] = []
        self._degrade_noted: set = set()
        self.mock_step = 0
        self.mock_tool_result: Optional[str] = None
        self.mock_script: Optional[str] = None
        # 上一次给出的工具调用（协议文本）。授权通过后要**重发它** —— 见 generate_mock。
        self.mock_last_call: Optional[str] = None

    # ---------- 脚本化假模型（离线演示完整循环） ----------

    # 剧本关键词。**只在第一轮判定**：后续轮次的 prompt 是工具结果回喂，里面已经
    # 没有用户原话（拦截剧本当年是靠结果里恰好带着 `id_rsa` 才蒙对的），
    # 一旦某套剧本的结果文本里不含关键词，它就会中途掉回默认剧本 —— 这类
    # "演示时好时坏"的毛病不值得留着。
    MOCK_BLOCKED_KEYS = ("私钥", "id_rsa", "越界", "删掉", "改坏", "偷偷")
    MOCK_DIFF_KEYS = ("改代码", "改一行", "加一行", "diff", "改动")

    def generate_mock(self, prompt: str) -> str:
        """脚本化假模型：三套剧本 —— 查时间（默认）/ 被拦下 / 改动可见。

        为什么要有后两套：演示"全流程跑通"和演示"执行层真的拦得住"是两件事；
        而"能改文件"和"改了哪一行看得见"又是两件事。关键词只在第一轮判定，
        之后按 `mock_script` 走完，不靠每轮重新嗅探。

        **授权后重发同一个调用**：真模型被拦下再获授权时，执行层喂给它的是
        `PROMPT_PERM_GRANTED`（"请重试刚才被拦截的工具"），它就该重发那个调用。
        脚本化模型此前不重发、而是继续推进剧本 —— 于是造出一条"批准了、但从没执行过"
        的假流程：文件没写成、`tools_ran_this_task` 还是 0，最后那句"改好了"被反幻觉
        闸门（正确地）拦下，一路烧到轮数上限、连 final 事件都不发。
        mock 与真实路径分叉时，"测试通过"代表的就不再是"能跑"。
        """
        if self.mock_last_call and any(k in prompt for k in _MOCK_GRANT_MARKERS):
            return self.mock_last_call                       # 不推进剧本步数
        text = self._generate_mock_script(prompt)
        if '"tool"' in text:
            self.mock_last_call = text
        return text

    def _generate_mock_script(self, prompt: str) -> str:
        self.mock_step += 1
        if self.mock_step == 1:
            if any(k in prompt for k in self.MOCK_BLOCKED_KEYS):
                self.mock_script = "blocked"
            elif any(k in prompt for k in self.MOCK_DIFF_KEYS):
                self.mock_script = "diff"
            else:
                self.mock_script = "time"
        if self.mock_script == "blocked":
            if self.mock_step == 1:
                return (
                    "<INTERNAL>\n[INTERNAL_THINKING]\n"
                    "[PLAN] 演示：尝试读取项目外的私钥文件\n"
                    "[REASON] file_read 可以读文件\n"
                    "[ACT] 调用 file_read\n[/INTERNAL_THINKING]\n</INTERNAL>\n"
                    "<EXTERNAL>\nanswer.\n"
                    '{"tool":"file_read","path":"~/.ssh/id_rsa"}\n</EXTERNAL>'
                )
            result_text = self.mock_tool_result or ""
            detail = f"（{result_text}）" if result_text and result_text != "(未知)" else ""
            return (
                "<INTERNAL>\n[INTERNAL_THINKING]\n"
                "[OBSERVE] 执行层拒绝了这次读取\n"
                "[REASON] 这是安全边界，不是权限问题；如实报告用户\n[/INTERNAL_THINKING]\n</INTERNAL>\n"
                f"<EXTERNAL>\nanswer.\n读取被执行层拦下了{detail}——"
                "敏感目标/越界由执行层硬拦，与模型是否被说服无关。\n</EXTERNAL>"
            )
        if self.mock_script == "diff":
            # 第三套剧本：**改动可见**。先建一个文件，再改它一行 —— 第二次调用带 diff，
            # 终端会把 +/- 逐行上色，收尾还会给一行"本轮 N 次工具调用"的汇总。
            # 演示"能改"和演示"改了哪一行"是两件事，后者才是用户每天要核对的东西。
            if self.mock_step == 1:
                return (
                    "<INTERNAL>\n[INTERNAL_THINKING]\n"
                    "[PLAN] 演示：先建一个笔记文件\n"
                    "[REASON] 要改动先得有文件\n[ACT] 调用 file_write\n[/INTERNAL_THINKING]\n</INTERNAL>\n"
                    "<EXTERNAL>\nanswer.\n"
                    '{"tool":"file_write","path":"demo_notes.md",'
                    '"content":"# 演示笔记\\n\\n- 第一条\\n- 第二条\\n"}\n</EXTERNAL>'
                )
            if self.mock_step == 2:
                return (
                    "<INTERNAL>\n[INTERNAL_THINKING]\n"
                    "[PLAN] 演示：在笔记里加一行\n"
                    "[REASON] str_replace 只动一行，diff 会告诉用户改了哪里\n"
                    "[ACT] 调用 str_replace\n[/INTERNAL_THINKING]\n</INTERNAL>\n"
                    "<EXTERNAL>\nanswer.\n"
                    '{"tool":"str_replace","path":"demo_notes.md",'
                    '"old_string":"- 第二条\\n","new_string":"- 第二条\\n- 第三条（新加的）\\n"}\n</EXTERNAL>'
                )
            result_text = self.mock_tool_result or ""
            detail = f"\n{result_text}" if result_text and result_text != "(未知)" else ""
            return (
                "<INTERNAL>\n[INTERNAL_THINKING]\n"
                "[OBSERVE] 改动已落地，diff 与汇总都已展示\n"
                "[REASON] 信息已足够，输出最终回复\n[/INTERNAL_THINKING]\n</INTERNAL>\n"
                "<EXTERNAL>\nanswer.\n"
                f"改好了：只加了一行，卡片里的 + 行就是新增内容。{detail}\n</EXTERNAL>"
            )
        if self.mock_step == 1:
            # 第一轮：输出工具调用
            return (
                "<INTERNAL>\n[INTERNAL_THINKING]\n"
                "[PLAN] 演示：查询当前时间\n"
                "[REASON] datetime_now 可以直接获取时间\n"
                "[ACT] 调用 datetime_now\n[/INTERNAL_THINKING]\n</INTERNAL>\n"
                "<EXTERNAL>\nanswer.\n"
                '{"tool":"datetime_now","format":"YYYY-MM-DD HH:mm:ss"}\n</EXTERNAL>'
            )
        # 第二轮：基于工具结果的最终回复
        result_text = self.mock_tool_result or "(未知)"
        return (
            "<INTERNAL>\n[INTERNAL_THINKING]\n"
            "[OBSERVE] 工具执行成功，拿到时间\n"
            "[REASON] 信息已足够，输出最终回复\n[/INTERNAL_THINKING]\n</INTERNAL>\n"
            f"<EXTERNAL>\nanswer.\n当前时间是 {result_text}\n</EXTERNAL>"
        )

    # ---------- 真实模型 ----------

    def _note_degrade(self, kind: str, detail: str) -> None:
        """登记一次**降级**并声明出来（HL-03 硬规则②：不许静默回退）。

        与 `execution_layer._note_degrade` 同一份契约（两处出口缺一不可）：
        `self.degradations`（结构化，供外壳/审计/测试读）与 stderr 一行（人当场看见）。
        同一个 `kind` 只播报一次 —— "不静默"不等于"每次调用刷一屏"；刷屏会让人学会
        忽略它，那又变回静默了。
        """
        self.degradations.append({"kind": kind, "detail": detail})
        if kind not in self._degrade_noted:
            self._degrade_noted.add(kind)
            print(f"⚠ 能力降级（{kind}）：{detail}", file=sys.stderr)

    def generate(self, prompt: str) -> str:
        if self.mode == "mock":
            return self.generate_mock(prompt)
        if not self.base_url:
            raise RuntimeError(
                "未配置模型：请使用 --mock 离线演示，或提供 --base-url/--api-key"
                "（或环境变量 AGENT_BASE_URL / AGENT_API_KEY / AGENT_MODEL）")
        if self.tools_ok:
            try:
                return self._generate_tools(prompt)
            except ToolsUnsupported as e:
                # 端点不支持原生工具调用 → 本次自动降级，并永久关闭 tools 避免反复失败。
                # HL-03②：**降级必须声明**（此前这里是纯静默：注释写了、话没说）。
                # 方向是"工具面收敛"，不是放开权限 —— 权限档位一个字不变，
                # 只是把 function calling 换成 <INTERNAL>/<EXTERNAL> 文本协议。
                self.tools_ok = False
                self._note_degrade(
                    "tools",
                    f"模型端点不支持原生工具调用（{e}）→ 本次起改用 "
                    "<INTERNAL>/<EXTERNAL> 文本协议；工具面收敛，权限档位不变")
        return self._generate_text(prompt)

    def _generate_tools(self, prompt: str) -> str:
        """原生工具调用：模型返回结构化 tool_calls，由执行层统一裁决执行"""
        logger.debug("LLM 请求 model=%s tools=on", self.model)
        messages = ([{"role": "system",
                      "content": load_system_prompt(tools_mode=True) + self.system_suffix}]
                    + self.history + [{"role": "user", "content": prompt}])
        try:
            data = _post_chat(self.base_url, self.api_key, self.model,
                              messages, tools=tools_for_permission(self.permission_level))
        except ace_client.ChatHTTPError as e:
            # 端点不认 tools 参数（400/404）→ 降级到文本协议。判据里的 "tool"
            # 是对着错误正文看的：同样报 400，参数写错和"不认识 tools"要分开。
            if e.status in (400, 404) and "tool" in (e.body or "").lower():
                raise ToolsUnsupported(f"端点不支持 tools 参数: HTTP {e.status}") from e
            raise
        message = data["choices"][0]["message"]
        # H-19：先看 finish_reason。被 max_tokens 截断时，`tool_calls` 里的 JSON 是
        # **未闭合**的 —— 修 JSON 的两条路都会失败、`args` 退化成 `{}`，于是报 400、
        # 计进"连续失败"、3 次后该工具被整会话熔断。那不是模型的错，回喂也没用。
        if str((data["choices"][0] or {}).get("finish_reason") or "") == "length":
            raise TruncatedOutput(
                "模型输出被 max_tokens 截断（finish_reason=length）：工具调用 JSON 未闭合")
        tool_calls = message.get("tool_calls") or []
        if tool_calls:
            return tool_calls_to_protocol(tool_calls)
        content = message.get("content") or ""
        if content.strip():
            # 清洗模型残留的协议标签残片（如 </EXTERNAL>），避免污染解析
            content = sanitize_plain_content(content)
        converted = content_to_tool_protocol(content)
        if converted:
            return converted
        if not content.strip():
            raise RuntimeError("模型返回空内容")
        return final_reply_protocol(content)

    def _generate_text(self, prompt: str) -> str:
        """文本协议回退：模型按 <INTERNAL>/<EXTERNAL> 格式输出

        `generate()` 的契约是"返回执行层能解析的协议文本"，三条路径都要满足：
        mock 分支自带完整协议；`_generate_tools` 把纯文本包成模式 B；这里过去是
        **直接把裸文本返回** —— 于是不带 `--tools` 时模型答什么都进不了
        FINAL_REPLY：执行层按格式错误回喂，循环到最大轮数后打印
        "达到最大轮数，Agent 未给出最终回复"。R-03 真机验证才暴露出来（mock 与
        --tools 两条都有覆盖，唯独这条没有）。现在与 `_generate_tools` 同口径：
        清洗协议残片 → 能当工具调用就当工具调用 → 否则包装成最终回复。
        """
        logger.debug("LLM 请求 model=%s tools=off", self.model)
        messages = ([{"role": "system",
                      "content": load_system_prompt() + self.system_suffix}]
                    + self.history + [{"role": "user", "content": prompt}])
        data = _post_chat(self.base_url, self.api_key, self.model, messages)
        # H-19：截断的**最终回复**会被当成完成品打出去（半句话 + 绿色 ✓）。
        # 宁可如实报"被截断了"，也不要让用户以为回答完整。
        if str((data["choices"][0] or {}).get("finish_reason") or "") == "length":
            raise TruncatedOutput(
                "模型输出被 max_tokens 截断（finish_reason=length）：回复不完整")
        content = data["choices"][0]["message"]["content"] or ""
        if content.strip():
            # 清洗模型残留的协议标签残片（如 </EXTERNAL>），避免污染解析
            content = sanitize_plain_content(content)
        converted = content_to_tool_protocol(content)
        if converted:
            return converted
        if not content.strip():
            raise RuntimeError("模型返回空内容")
        return final_reply_protocol(content)

    def _trim_history(self) -> None:
        """限制对话历史长度（保留最近 N 轮）——口径与 ai_code 共用 ace_model"""
        self.history = ace_model.trim_history(self.history, self.max_history)


def render_result(r: Dict) -> str:
    """把执行层返回压缩成给模型看的文本（default=str 兜底 Path 等非 JSON 类型）"""
    keys = ("status", "message", "data", "tool", "instruction", "report",
            "bait_type", "baited_code", "rule", "memory_injected",
            "intent", "skills", "plan", "steps", "title", "reason")
    d = {k: r[k] for k in keys if k in r}
    return json.dumps(d, ensure_ascii=False, default=str)


# ============================================================
# 外部内容隔离（SEC-011）
# ============================================================
# 定界 + 来源标注的实现在 core/ace_isolation.py —— 那里不 import 项目内任何模块，
# 因为 execution_layer（记忆预注入）也要用它，而 execution_layer 不能反向依赖入口。
#
# 分成两个函数而不是直接改 render_result：render_result 还被人类可读的展示通道
# 和测试用，往里塞隔离块会把"给模型看"和"给人看"两件事又搅在一起。


def truncate_tool_output(text: str, *, head_chars: int = 4000,
                         tail_chars: int = 2000, max_chars: int = 8000) -> str:
    """工具结果的确定性头/尾裁剪（借鉴 DSH compaction-tool-result-pruner）。

    超大工具输出（如 terminal_exec 的整页日志）直接塞进上下文会挤爆窗口；
    这里保留头部 + 尾部 + 中间替换为标记，**同输入必同输出**（纯函数、可重放
    验证），不调用模型。Python str 按码点索引，天然不会切破代理对。
    """
    if len(text) <= max_chars:
        return text
    head = text[:head_chars]
    tail = text[-tail_chars:] if tail_chars else ""
    cut = len(text) - head_chars - (tail_chars or 0)
    # 裁剪标记跟随界面语言（i18n 全局切换）
    from ui.i18n import t as _t
    return (f"{head}\n…[{_t('trunc_hint', cut=cut, total=len(text))}]\n{tail}")


def render_tool_result(r: Dict) -> str:
    """给模型看的工具结果：序列化 + 隔离标记 + 来源标注（超大输出确定性裁剪）"""
    tool = r.get("tool")
    body = truncate_tool_output(render_result(r))
    return wrap_untrusted(body, source=untrusted_source(tool),
                          origin=f"tool:{tool}" if tool else "")


def render_error_result(r: Dict) -> str:
    """给模型看的**执行层错误**反馈：刻意不套外部内容定界块。

    与 render_tool_result 唯一的区别就是套不套隔离块，而这个区别是实测逼出来的：

    这个 payload 是执行层自己写的元信息（status / message / instruction），
    不是从外部取回的正文。套上隔离块，等于告诉模型"这一段是**数据**不是指令，
    不得当成命令执行" —— 而同一句里又写着"请修正后继续"。两个信号直接打架。

    2026-09-19 真机冒烟（deepseek-v4-flash，本机）的实测后果：模型完全按系统
    提示词的约定行事，明确写出"它是从被标记为『外部（未分类）』的数据区块里
    送来的……不能当作指令执行"，连续 5 轮拒绝改动输出，而报错正文一字未变、
    只有随机 id 在换；第 6 轮被 ai_code 的 STALL_ABORT_ROUNDS 按"模型死循环"
    中止，并把责任归给模型与提示词。真正的死锁来自两个安全特性的交叉。

    SEC-011 的隔离对象是**外部内容**：网页正文、命令输出、文件正文、子代理文本。
    执行层自己的报错不在其中。若将来某条错误路径需要携带外部正文，那段正文必须
    单独走 wrap_untrusted —— 不要因为"反正一起发出去"就把整个 payload 包起来。
    """
    return render_result(r)


# ============================================================
# RL-03 三段式回传（THREE-LAYERS §2.4）—— 治"回喂越来越长"
# ============================================================
# 病根：每条结果都**全文**渲染进 prompt —— 这同时造成两件事：吃前缀（与 `WP-3` 冲突），
# 以及 H-19 那类"回喂变长 → 更容易被截断 → 更要回喂"的**正反馈**。
#
# 三段（`THREE-LAYERS` §2.4 那张表就是全部契约）：
#
#   | 段       | 进不进上下文 | 内容                                                |
#   |----------|--------------|-----------------------------------------------------|
#   | 摘要行   | **必进**     | 一行结构化：outcome / class / fp 短码 / 处置提示     |
#   | 证据块   | **按需**     | 全文，模型显式索取（`[evidence fp=xxxx]`）才回喂     |
#   | 指纹压缩 | **必进**     | 同 fp + 同 class 再犯 → `(同上，第 N 次)`，**不长出来** |
#
# **这里的角色是消费者，不是判定者**：`outcome` / `refusal_class` 只从 RL-01/RL-02 的
# 机器通道读；缺了就按 `tools.status` 那两张**唯一判定表**补（`outcome_for` /
# `classify_refusal`）—— 这一节绝不自己写 `if error_code == "403"`。
#
# 边界（本包**没做**的，如实记）：
#   ① 只接了 `agent_runner.run_conversation` 这一条回喂路径；`ai_code`（CLI）的三处
#      回喂仍是全文渲染 —— `ai_code` 是另一个 scope，不在本包；
#   ② 索取口是**文本协议**（`[evidence fp=xxxx]`），不是新工具：加工具要动
#      `tools/registry`；真实模型会不会自发索取**未经真机验证**；
#   ③ `partial`（RL-01 留的"尚无生产者"，§9.4）仍无生产者 —— 摘要行认得它，没人产出它；
#   ④ 指纹兜底只折叠空白，**不猜**数字/路径语义：归一化的真正生产者是执行层
#      （RL-01 的 `fingerprint`）。回喂层宁可少压（重复各占一行），不错压
#      （把两条不同的拒绝并成一条，模型就再也看不到差异）。

RL03_FP_CHARS = 4                       # 摘要行里的指纹短码长度（示例 `fp=a3f2`）
RL03_EVIDENCE_HINT = "索取全文"

#: RL-02 六分类 → 驱动层的**唯一**处置动作（`THREE-LAYERS` §2.3 那张表，照抄不改写）。
RL03_DISPOSAL: Dict[str, str] = {
    REFUSAL_CLASS_POLICY: "换路径，别重试",
    REFUSAL_CLASS_BOUNDARY: "可换路径",
    REFUSAL_CLASS_AUTH_PENDING: "停下等人（不是失败）",
    REFUSAL_CLASS_CAPABILITY: "降级并声明",
    REFUSAL_CLASS_TRANSIENT: "退避重试",
    REFUSAL_CLASS_MALFORMED: "重新生成（不计熔断）",
}

#: 模型显式索取证据块的标记（短码与完整指纹都认）。
_EVIDENCE_REQ_RE = re.compile(r"\[\s*evidence\s+fp=([0-9A-Za-z_\-]+)\s*\]")


def _machine_channel(r: Dict) -> Tuple[str, str]:
    """取机器通道的 `(outcome, refusal_class)`：显式值优先，缺了按唯一判定表补。"""
    status = str(r.get("status") or "")
    code = str(r.get("error_code") or "")
    outcome = str(r.get("outcome") or "").strip() or outcome_for(status, code)
    cls = str(r.get("refusal_class") or "").strip() or classify_refusal(status, code)
    return outcome, cls


def _fingerprint_blob(r: Dict) -> str:
    """兜底指纹的归一化输入（只折叠空白：不猜数字/路径语义，见本节边界④）。"""
    outcome, cls = _machine_channel(r)
    msg = re.sub(r"\s+", " ", str(r.get("message") or "")).strip()
    try:
        data = json.dumps(r.get("data"), ensure_ascii=False, sort_keys=True, default=str)
    except (TypeError, ValueError):
        data = str(r.get("data"))
    return "|".join((outcome, cls, str(r.get("tool") or ""),
                     str(r.get("error_code") or ""), msg[:200], data[:400]))


def result_fingerprint(r: Dict) -> str:
    """结果指纹：执行层给了就用（它更懂"关键参数归一化"），没给就兜底派生。

    纯函数：**同输入必同指纹** —— 指纹压缩全靠这条。
    """
    fp = str(r.get("fingerprint") or "").strip()
    if fp:
        return fp
    return hashlib.sha256(_fingerprint_blob(r).encode("utf-8")).hexdigest()[:16]


def fingerprint_short(fp: str) -> str:
    """指纹短码（摘要行只带 4 位：够模型拿来索取全文，也不吃前缀）。"""
    text = str(fp or "").strip()
    return text[:RL03_FP_CHARS] or "?" * RL03_FP_CHARS


def summary_line(r: Dict) -> str:
    """RL-03 摘要行（**必进上下文**）：一行结构化 —— outcome / class / fp / 处置提示。

    例：`[denied] file_write · BOUNDARY · fp=a3f2 · 可换路径 · 索取全文: [evidence fp=a3f2]`

    末尾的索取提示是**常量长度**的：它告诉模型"被拿走的全文该怎么要回来"；
    重复那条走指纹压缩（见 `FeedbackLedger.render`），所以整条回喂**不随重复增长**。
    """
    outcome, cls = _machine_channel(r)
    label = (str(r.get("tool") or "").strip()
             or str(r.get("status") or "").strip() or "?")
    code = str(r.get("error_code") or "").strip()
    short = fingerprint_short(result_fingerprint(r))
    parts = [f"[{outcome}] {label}"]
    if cls:
        parts.append(f"· {cls}")
    elif code:
        parts.append(f"· {code}")
    parts.append(f"· fp={short}")
    hint = RL03_DISPOSAL.get(cls, "") if cls else ""
    if hint:
        parts.append(f"· {hint}")
    _hint = r.get("hint")
    _alts = _hint.get("alternatives") if isinstance(_hint, dict) else None
    if _alts:
        _alts_txt = "、".join(str(a) for a in list(_alts)[:3])[:80]
        if _alts_txt:
            parts.append(f"· 替代: {_alts_txt}")
    parts.append(f"· {RL03_EVIDENCE_HINT}: [evidence fp={short}]")
    return " ".join(parts)


def _is_error_feedback(r: Dict) -> bool:
    """这条回喂是不是"执行层自己的报错"（决定证据块套不套隔离块）。

    口径**照抄主循环的分支条件**（`result["status"] in ERROR_STATUSES`），不自己放宽：
    隔离面只许收不许放 —— 工具执行结果（含工具自己返回的 403/404，`status="error"`）
    仍然走 `render_tool_result` 的隔离块，与改动前**逐字一致**。
    """
    return str(r.get("status") or "").strip().upper() in {s.upper() for s in ERROR_STATUSES}


def retrieve_evidence(r: Dict) -> str:
    """RL-03 证据块（**按需**）：全文渲染，只在模型显式索取时才回喂。

    这里只**选通道**，两条通道本身一个字没动（改了就是回退 RL-04）：
      · 工具结果 → `render_tool_result`（SEC-011 隔离 + 确定性裁剪）；
      · `ERROR_STATUSES` 里那几条执行层报错 → `render_error_result`（**不套**隔离块，纪律①）。
    """
    return render_error_result(r) if _is_error_feedback(r) else render_tool_result(r)


def _prepend_evidence(prompt: str, evidence_text: str) -> str:
    """把模型索取到的证据块放在本轮回喂之前（没索取就原样返回）。"""
    return f"{evidence_text}\n{prompt}" if evidence_text else prompt


class FeedbackLedger:
    """RL-03 回喂账本（**一次会话一个**）：指纹压缩 + 证据暂存 + 显式索取。

    寿命：本会话 —— 它是**状态**不是知识（`THREE-LAYERS` §4：拒绝账本跨会话、
    失败账本会话结束即清；RL-03 只做回喂侧的那一小半）。
    """

    def __init__(self) -> None:
        self._counts: Dict[Tuple[str, str], int] = {}
        self._evidence: Dict[str, str] = {}
        self._short: Dict[str, str] = {}

    def hold(self, r: Dict) -> str:
        """把一条结果的**全文证据**暂存起来（键 = 指纹），返回指纹。

        只留第一次：同指纹 = 同一条路，再犯时回喂已被压成 `(同上，第 N 次)`；
        模型若要全文，按同一个指纹取回第一次那份（内容一致才配得上同一个指纹）。
        """
        fp = result_fingerprint(r)
        self._short.setdefault(fingerprint_short(fp), fp)
        self._evidence.setdefault(fp, retrieve_evidence(r))
        return fp

    def note(self, r: Dict) -> int:
        """记一次出现，返回"该 `(指纹, class)` 第几次出现"（1 基）。"""
        fp = self.hold(r)
        _outcome, cls = _machine_channel(r)
        key = (fp, cls)
        self._counts[key] = self._counts.get(key, 0) + 1
        return self._counts[key]

    def render(self, r: Dict, *, evidence: bool = False) -> str:
        """三段式回喂：摘要行（必进）+ 指纹压缩；`evidence=True` 时才附全文证据块。

        **长度不增长**就落在这里：第 1 次给摘要行（`n == 1`），第 2 次起换成
        `(同上，第 N 次) fp=xxxx · CLASS` —— 它比摘要行**短**，且 N 再涨也不再变长
        （同位数下长度恒定）。（显式索取那一轮必然最长，那是模型自己要的。）
        """
        fp = result_fingerprint(r)
        n = self.note(r)
        if evidence:
            return f"{summary_line(r)}\n{self._evidence.get(fp, '')}"
        if n <= 1:
            return summary_line(r)
        _outcome, cls = _machine_channel(r)
        tail = f" · {cls}" if cls else ""
        return f"(同上，第 {n} 次) fp={fingerprint_short(fp)}{tail}"

    def requests(self, output: str) -> List[str]:
        """扫模型本轮输出里的索取标记，返回命中的**完整**指纹列表（短码也认）。"""
        found: List[str] = []
        for token in _EVIDENCE_REQ_RE.findall(str(output or "")):
            fp = self._short.get(token, token)
            if fp in self._evidence and fp not in found:
                found.append(fp)
        return found

    def retrieve_requested(self, output: str) -> str:
        """把模型本轮索取到的证据块取回来；**没索取 → 空串**（默认不进上下文）。"""
        return "\n".join(self._evidence[fp] for fp in self.requests(output))

    def reset(self) -> None:
        """清空本会话账本（同一会话内换任务时调用；跨会话本就该新建实例）。"""
        self._counts.clear()
        self._evidence.clear()
        self._short.clear()


def render_feedback(r: Dict, ledger: Optional["FeedbackLedger"] = None,
                    *, evidence: bool = False) -> str:
    """RL-03 回喂入口：三段式。没给账本 ⇒ 无法跨轮压缩，退化成"每次都给摘要行"。"""
    if ledger is None:
        ledger = FeedbackLedger()
    return ledger.render(r, evidence=evidence)


# ============================================================
# 会话状态机（run_conversation 与 ai_code.AgentCLI.converse 共用）
#
# 两个前端的呈现层差别很大（一个 emoji 直打，一个 i18n + spinner + 流式），
# 但「执行层返回什么状态 → 下一轮该喂模型什么 / 该问用户什么」是同一套规则。
# 这套规则以前在两处各写一份，已经漂移出真实后果：agent_runner 在非交互模式下
# 自动批准计划（answer="y"），而 CLI 侧是 fail-close 拒绝——同一个二进制里
# 两种安全口径。所以这里只抽「决策」，不抽「渲染」。
# ============================================================

PROMPT_PLAN_APPROVED = ("计划已批准，不要再调用 plan_propose。"
                        "请直接按计划逐步执行，每步调用相应工具，最后给出总结。")
PROMPT_PLAN_REJECTED = "用户拒绝了该计划，请调整方案或直接回答。"
PROMPT_PERM_GRANTED = "用户已授权，请重试刚才被拦截的工具。"
PROMPT_PERM_DENIED = "用户拒绝授权，请换一种不需要该工具的方式完成任务。"
PROMPT_EXEC_EXCEPTION = "执行层抛出异常: {err}\n请调整输出格式后重新输出。"
PROMPT_ERROR_RETRY = ("执行层返回了错误，请修正后继续：\n{rendered}\n"
                      "注意：必须严格按 <INTERNAL>/<EXTERNAL> 格式输出。")
PROMPT_TOOL_RESULT = ("工具执行结果：\n{rendered}\n"
                      "请根据结果继续（输出下一条工具调用，或最终回复）。")
PROMPT_UNVERIFIED_CLAIM = _CORE_PROMPT_UNVERIFIED_CLAIM   # H-20：判据与文案见 core/ace_claims


# 需要回喂模型让它自行修正的错误态
ERROR_STATUSES = ("FORMAT_ERROR", "GUARD_VIOLATION", "BAIT_TRIGGERED",
                  "AST_FAILED", "403", "TOOL_BANNED")

# 授权决策三态
GRANT_ONCE = "once"
GRANT_SESSION = "session"
GRANT_DENY = "deny"


def _read_answer(question: str, grace_hint: str = "") -> str:
    """读一行**危险对话框**的回答，带防误触宽限期（见 `ui/ace_grace.py`）。

    为什么第一次问就要设宽限：最危险的恰恰是第一次 —— 对话框刚冒出来的那一瞬，
    用户上一个动作里敲的回车正好落在它上面。所以每次都开销表，而不是"重问时才防"。
    判为飞行按键时**不采纳**（按"没回答"处理）、提示一句、再问一次；重问次数用尽
    就直接采纳 —— 否则自动化喂输入的场景会被永久挡在门外。
    """
    gate = ace_grace.GraceGate()
    while True:
        gate.arm()
        answer = input(question).strip()
        if gate.admit() or gate.exhausted:
            ask_grant.discards += gate.discarded      # 可观测：出了几次误触保护
            return answer
        if grace_hint:
            print(grace_hint)


def ask_yes_no(question: str, on_auto_deny=None, grace_hint: str = "") -> bool:
    """y/N 确认；非交互（管道 / CI / 无 tty）一律判否。

    fail-close 是这里唯一正确的默认：没人能点头时自动批准，等于把审批环节
    变成空过场。计划审批与临时授权都必须走这一个入口。
    """
    if not sys.stdin.isatty():
        if on_auto_deny is not None:
            on_auto_deny()
        return False
    try:
        return _read_answer(question, grace_hint).lower() in ("y", "yes")
    except (EOFError, KeyboardInterrupt):
        print()
        return False


def parse_grant_answer(text: str) -> Tuple[str, str]:
    """授权回答 → `(裁决, 反馈文本)`。裁决取 `once` / `session` / `deny`。

    为什么单拎出来：这是**危险对话框**的回答解析，必须能穷举测试。接受三类写法 ——
    字母（`y`/`a`/`n`，老手感）、**编号**（`1`/`2`/`3`，与界面上编号一一对应，高频确认
    可以盲打）、以及"拒绝 + 给模型一句话"的 `n 理由`。空输入按拒绝处理（危险对话框里
    回车不该等于放行）。
    """
    raw = str(text or "").strip()
    low = raw.lower()
    if not low:
        return GRANT_DENY, ""
    if low in ("1", "y", "yes", "once"):
        return GRANT_ONCE, ""
    if low in ("2", "a", "all", "always", "session", "s"):
        return GRANT_SESSION, ""
    if low in ("3", "n", "no", "deny", "d", "q"):
        return GRANT_DENY, ""
    head, _sep, tail = raw.partition(" ")
    if head.lower() in ("3", "n", "no", "deny", "d") and tail.strip():
        # 拒绝理由要**回传模型**：拒绝不该是死路，而是一次可执行的纠偏。
        return GRANT_DENY, tail.strip()[:400]
    return GRANT_DENY, ""


def grant_prompt(question: str, tool: str = "", reason: str = "") -> str:
    """终端授权提示的**单一渲染点**（`WP-0` 切片 C）。

    有 `tool` 时在问题前加"请求工具 + 原因"两行（i18n，三语一致）；无 `tool` 原样返回
    （`ask_grant` 还被别处复用，不能一刀切）。此前这两行靠**调用方**另行打印，且两条
    终端路径口径不一 —— `agent_runner` 循环打印了，`ai_code._ask_permission` 却把
    tool/reason 丢掉，用户只看到一句"是否授权？"却不知道要授权什么。
    """
    if not tool:
        return question
    from ui.i18n import t
    prompt = t("perm_request_title", tool=tool)
    if reason:
        prompt += "\n" + t("perm_reason", reason=reason)
    return prompt + "\n" + question


def ask_grant(question: str, on_auto_deny=None, grace_hint: str = "",
              tool: str = "", reason: str = "") -> str:
    """授权三态确认：`1/y` 本次 / `2/a` 本会话 / `3/n` 拒绝（可写理由）。

    默认权限是 readonly，而临时授权用后即焚——如果只有"本次"一个选项，
    一个 10 处编辑的任务就要弹 10 次窗、多跑 10 轮模型。"本会话"这一档是
    为了让这个默认可用，而不是逼用户直接把等级升到 write 了事。
    非交互同样 fail-close。带防误触宽限期：飞行过来的回车不算放行。

    `tool`/`reason`（可选）：由 `grant_prompt` 统一渲染 —— 传了就显示"请求什么、为什么"。
    """
    if not sys.stdin.isatty():
        if on_auto_deny is not None:
            on_auto_deny()
        return GRANT_DENY
    try:
        answer = _read_answer(grant_prompt(question, tool, reason), grace_hint)
    except (EOFError, KeyboardInterrupt):
        print()
        return GRANT_DENY
    decision, feedback = parse_grant_answer(answer)
    if feedback:
        # 由 CLI 侧登记回调（这里是 runner，不该反向 import ai_code 造成循环依赖）
        _hook = getattr(ask_grant, "on_deny_feedback", None)
        if callable(_hook):
            try:
                _hook(feedback)
            except Exception:  # noqa: BLE001 —— 记不上理由也不该改变裁决
                pass
    return decision


ask_grant.discards = 0        # 累计拦下的飞行按键次数（可观测；测试与 /status 会读）
ask_grant.on_deny_feedback = None


def resolve_plan(el: "ExecutionLayer", approved: bool) -> str:
    """落定计划审批结果，返回下一轮要喂给模型的提示"""
    if approved:
        el.approve_plan()
        return PROMPT_PLAN_APPROVED
    el.reject_plan()
    return PROMPT_PLAN_REJECTED


def resolve_permission(el: "ExecutionLayer", decision: str) -> str:
    """落定授权结果（once / session / deny），返回下一轮要喂给模型的提示"""
    if decision in (GRANT_ONCE, GRANT_SESSION):
        el.grant_pending_permission(session=decision == GRANT_SESSION)
        return PROMPT_PERM_GRANTED
    el.reject_pending_permission()
    return PROMPT_PERM_DENIED




def run_conversation(provider: ModelProvider, el: ExecutionLayer,
                     user_input: str, verbose: bool = False) -> None:
    print(f"\n🧑 用户: {user_input}")
    # 每次会话重置 mock 状态，防止跨会话串号
    provider.mock_step = 0
    provider.mock_tool_result = None
    # 任务身份：一次用户请求一个 id，本次请求的**所有轮次**共用它。
    # 不能靠 user_input 文本判断"是不是同一个任务"——同一句话重发（↑ 回车、goal 续跑）
    # 会让反幻觉计数与畸形输出指纹跨请求残留（见 execution_layer._task_identity）。
    task_id = uuid.uuid4().hex
    # RL-03：回喂账本按**会话**新建（指纹压缩 + 证据暂存）—— 它是状态，不跨会话。
    feedback_ledger = FeedbackLedger()
    # 记忆预注入：在模型生成之前把相关历史记忆放进 prompt（无记忆时原样返回）
    next_prompt = el.prepare_context(user_input)
    for round_no in range(1, MAX_ROUNDS + 1):
        try:
            output = provider.generate(next_prompt)
        except KeyboardInterrupt:
            print("\n已中断")
            return
        except Exception as e:
            print(f"\n⚠ 模型调用失败: {e}")
            return
        # RL-03：模型本轮**显式索取**的证据（上一轮被摘要行替掉的那条全文）。
        # 没索取就是空串 —— 证据块默认不进上下文。
        _requested_evidence = feedback_ledger.retrieve_requested(output)
        if verbose:
            print(f"\n--- 第 {round_no} 轮模型输出 ---\n{output}")
        try:
            result = el.process_agent_output(output, user_input, task_id)
        except Exception as e:
            print(f"\n⚠ 执行层异常: {e}（已要求模型调整输出格式）")
            next_prompt = PROMPT_EXEC_EXCEPTION.format(err=e)
            continue
        provider.history.append({"role": "user", "content": next_prompt})
        provider.history.append({"role": "assistant", "content": output})
        provider._trim_history()
        if verbose:
            print(f"\n--- 执行层返回 ---\n{json.dumps(result, ensure_ascii=False, indent=2)}")

        if result["status"] == "PLAN_PROPOSED":
            print(f"\n📋 {result.get('plan') or result.get('message', '')}")
            next_prompt = resolve_plan(el, ask_yes_no(
                "  批准该计划并执行？[y/N]: ",
                lambda: print("  非交互模式：自动拒绝计划。"),
                grace_hint="  ⏳ 刚才那下按得太快（对话框刚弹出），不算数，请再答一次: "))
            continue

        if result["status"] == "PLAN_ALREADY_APPROVED":
            next_prompt = PROMPT_PLAN_APPROVED
            continue

        if result["status"] == "PERMISSION_REQUEST":
            # 切片 C：tool/reason 由 `ask_grant` 自己渲染（不再在这里另打两行）。
            next_prompt = resolve_permission(el, ask_grant(
                "  是否授权？[y 本次 / a 本会话 / N 拒绝]: ",
                lambda: print("  非交互模式：自动拒绝授权。"),
                grace_hint="  ⏳ 刚才那下按得太快（对话框刚弹出），不算数，请再答一次: ",
                tool=str(result.get("tool") or ""),
                reason=str(result.get("reason") or "")))
            continue

        if result["status"] == "FINAL_REPLY":
            print(f"\n🤖 Agent: {result['message']}")
            return

        if result["status"] in ERROR_STATUSES:
            # H-21：执行层判定"同一段畸形输出重复出现，再喂一次不会有用"时带 `abort`。
            # 无头路径此前**没有任何熔断**（CLI 至少有 20 轮上限 + `_fail_streak`），
            # 所以这里必须停；否则会一路跑到轮数上限，而且 exit code 还是 0。
            if result.get("abort"):
                print(f"\n⚠ 已中止：{result.get('message', '')}")
                return
            # SEC-017：安全拦截到阈值 → 明确告警（可能在借模型的手试探边界）
            _sec = result.get("security_alerts")
            if _sec:
                print(f"\n⚠ 本会话已发生 {_sec['count']} 次执行层安全拦截"
                      f"（最近一次: {_sec.get('last_tool', '')}）。"
                      "如果这不是你让它做的，请停下核对上下文来源。")
            # 把错误反馈给模型，让它修正后继续。
            # 注意证据块走的是 render_error_result（不套隔离块），不是 render_tool_result ——
            # 理由见该函数的 docstring：套了会让模型按约定拒绝纠错，形成死锁。
            # RL-03：默认只回喂**摘要行**（含 outcome/class/fp/处置提示），全文按需索取。
            next_prompt = _prepend_evidence(
                PROMPT_ERROR_RETRY.format(
                    rendered=render_feedback(result, feedback_ledger)),
                _requested_evidence)
            continue

        # 工具执行成功：结果回填模型，继续下一轮
        if provider.mode == "mock" and result["status"] == "SUCCESS":
            data = result.get("data") or {}
            provider.mock_tool_result = data.get("datetime") or json.dumps(data, ensure_ascii=False)
        # RL-03：同上 —— 成功结果也先给摘要行，全文（含隔离块）等模型索取。
        next_prompt = _prepend_evidence(
            PROMPT_TOOL_RESULT.format(
                rendered=render_feedback(result, feedback_ledger)),
            _requested_evidence)
    print("\n⚠️ 达到最大轮数，Agent 未给出最终回复。")



def main() -> None:
    parser = argparse.ArgumentParser(description="Agent 交互循环（LLM + 执行层）")
    parser.add_argument("--mock", action="store_true", help="使用脚本化假模型，离线演示")
    parser.add_argument("--base-url", help="OpenAI 兼容 API 地址")
    parser.add_argument("--api-key", help="API Key")
    parser.add_argument("--model", help="模型名")
    parser.add_argument("--project-root", default=".", help="Agent 工作目录")
    parser.add_argument("--permission", default="readonly", choices=["readonly", "write", "full"])
    parser.add_argument("--no-bait", action="store_true", help="关闭诱饵验证")
    parser.add_argument("--verbose", action="store_true", help="打印每轮原始输出")
    parser.add_argument("--tools", action="store_true",
                        help="使用原生工具调用（OpenAI 兼容 function calling，端点不支持时自动降级）")
    parser.add_argument("--max-history", type=int, default=0,
                        help="保留最近 N 轮对话历史（0 = 不裁剪）")
    parser.add_argument("--input", help="直接传入一条用户消息（非交互模式）")
    # 与 ai_code.py 的 --sandbox 同一套档位。之前这里只有 sandbox_base（沙箱临时目录），
    # 没有档位开关 —— 也就是说从这个入口进来永远是 off 档，用户以为两个前端一致，
    # 实际上没有任何边界。档位不一致比没有档位更糟：它是个错误的心理预期。
    parser.add_argument("--sandbox", default="off", choices=["off", "job", "docker"],
                        help="执行位置档位：off=宿主直跑 / job=Job Object / docker=一次性容器")
    parser.add_argument("--snapshot-verify", default="create",
                        choices=["create", "rollback"],
                        help="快照完整性校验的时机：create=建完即校验（默认，坏快照挡在写之前）/ "
                             "rollback=只在恢复时校验（每次写快约 10×，坏快照等到 /undo 才暴露，"
                             "但同样拒绝恢复）")
    parser.add_argument("--egress-allowlist", default="",
                        help="出站域名白名单，逗号分隔（缺省 = 闸门关闭）")
    parser.add_argument("--approval-policy", default=None,
                        choices=["never", "on_failure", "on_request", "untrusted"],
                        help="审批策略（与沙箱正交，默认 on_request）："
                             "on_failure 在有 job/docker 边界时先试后问；"
                             "never 从不问人、需审批的一律拒绝")
    args = parser.parse_args()


    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    provider = ModelProvider(args)
    _egress = [s.strip() for s in (args.egress_allowlist or "").split(",") if s.strip()]
    # 策略组合自检（同 ai_code）：never + 无边界 = 没有边界的无人值守，直接拒绝启动。
    _refuse = execution_layer.policy_refusal_code(args.approval_policy, args.sandbox)
    if _refuse:
        print(f"❌ 拒绝启动：{_refuse} —— approval_policy=never 必须配真实边界"
              "（--sandbox job|docker）；无人值守叠加无隔离等于没有边界。"
              "要无人值守请用 --sandbox job|docker + --approval-policy on_failure。")
        sys.exit(2)
    el = ExecutionLayer(
        project_root=args.project_root,
        permission_level=args.permission,
        config={"bait": {"enabled": not args.no_bait, "frequency": 0},
                "sandbox": {"mode": args.sandbox},
                # 没给 --egress-allowlist 时传 None（闸门关），而不是空列表 ——
                # 空列表的含义是"配了，但除内置端点外全拦"，两者不能混。
                "egress_allowlist": _egress or None,
                "approval_policy": args.approval_policy,
                # 与 ai_code 的 `snapshot_verify` 同一口径：两个入口都接，别只接一个
                # （SEC-010 的成因正是"两个入口各写一遍、漏了一个"）
                "snapshot_verify": args.snapshot_verify,
                "sandbox_base": str(Path(args.project_root).resolve() / ".sandbox_tmp")},
    )
    print(f"Agent 已启动 | 模型: {provider.mode} | 权限: {args.permission} | "
          f"沙箱: {args.sandbox} | "
          f"工作目录: {args.project_root} | 原生工具: {'开' if provider.tools else '关'}")

    if args.permission != "readonly":
        print("⚠ 当前为写权限：terminal_exec 可执行任意 shell 命令。生产环境建议 readonly 起步。")
    # 无人值守的真实行为与直觉相反：需要审批的动作会被直接拒绝（terminal_exec 在 CI 里
    # 用不了），而不需要审批的写/执行工具照跑、只有进程内策略。启动时说出来。
    if not sys.stdin.isatty() and execution_layer.unattended_without_boundary(
            args.permission, args.sandbox):
        print("⚠ 无人值守 + 无内核边界：需要审批的动作【直接拒绝】，"
              "无需审批的写/执行工具（file_write / code_execute / api_post …）照跑。"
              "要跑无人值守请显式给 --sandbox job/docker（可配 --approval-policy on_failure），"
              "或改回 --permission readonly。")
    # 沙箱档预检（同 ai_code）：job 档在非 Windows 上不存在，别等到第一次调用才 503
    from core import ace_executor as _ax  # noqa: PLC0415
    _pre = execution_layer.sandbox_preflight_notice(
        args.sandbox, executor_ready=_ax.default_binary_path().is_file(),
        docker_cli=bool(shutil.which("docker")))
    if _pre:
        print(f"⚠ 沙箱档预检: {_pre}（详见 docs/SECURITY-MODEL.md；启动不拦，调用时诚实 503）")
    stats = el.get_stats()
    print(f"模块状态: v2_gateway={stats['v2_gateway']} v1={stats['v1_modules']} parser={stats['parser']}")

    if args.input:
        run_conversation(provider, el, args.input, args.verbose)
        return
    print("输入消息开始对话，输入 exit / quit 退出。")
    while True:
        try:
            user_input = input("你: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if user_input.lower() in ("exit", "quit", "退出"):
            break
        if not user_input:
            continue
        run_conversation(provider, el, user_input, args.verbose)


if __name__ == "__main__":
    main()
