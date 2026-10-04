#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""ace_keys —— 键位表：内置语义键 + 用户覆盖 + 冲突判定 + 展示

为什么需要单独一层：键位散在三处 —— `ui/ace_input.KEYMAP` 是"给人看的说明表"、
`ai_code` 里的 `RESERVED_KEYS`/`parse_keybindings` 是"校验"，真绑定又各自写在
prompt_toolkit 的 `@kb.add` 上。于是"用户把 `c-o` 绑到别处"这种事，没有任何地方说得清
结果是什么（两个处理器都跑一半，或者其中一个悄悄失效）。这里把三件事合成一份数据：

- **谁能被覆盖**：`RESERVED_KEYS`（回车/退出等保命键）与 `APP_BOUND_KEYS`
  （`c-s`/`c-l`/`c-o`/`F1`–`F4` 这些已经接了真功能的键）不许覆盖 —— 覆盖它们不是
  "改键位"，是"把功能弄坏一半"，所以直接拒绝并**说明原因**，而不是默默接受；
- **冲突警告**：非法键名、值不是斜杠命令、条数超限、重复绑定，都返回结构化警告
  （带 code，由调用方翻成用户能读的句子）—— 配置里写错了要有人说；
- **展示**：`render_key_table` 纯函数出"待打印行"，`/keys` 只负责喂数据和上色。

纯函数、不读配置、不打印 —— 所以每一条规则都能在没有终端的环境里断言。
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "RESERVED_KEYS", "APP_BOUND_KEYS", "BUILTIN_KEYS", "KeyBinding",
    "KeyResolution", "resolve_bindings", "render_key_table", "KeyWarning",
    "SCOPES", "ActionBinding", "APP_KEYMAP", "bindings_for", "help_rows",
    "ChordMap", "CHORD_TIMEOUT",
]

# 保命键：改掉它们等于把"发不出去/退不出来"写进配置（回车、Esc、Ctrl+C/D…）
RESERVED_KEYS = frozenset(("enter", "c-c", "c-d", "escape", "c-j", "s-enter", "c-m"))

# 已接真功能的键：用户覆盖会让"两件事各做一半"。想换键位可以换到别的键上，
# 但这些键本身不让（与 `/vim` 文档里"保留键不许覆盖"是同一条纪律）。
APP_BOUND_KEYS = frozenset(("c-s", "c-l", "c-o", "f1", "f2", "f3", "f4", "f5"))

# 内置语义键的展示表：(键, 说明 i18n 键)。与 `ui/ace_input.KEYMAP` 同源，
# 但这里不 import 它 —— 后者是"输入层"的说明表，本模块是"键位系统"的模型，
# 两边各有一份会漂，所以 KEYMAP 改为从这里拿（见 ace_input.keys_table 的委托）。
BUILTIN_KEYS: List[Tuple[str, str]] = [
    ("Enter", "keys_enter"),
    ("Alt+Enter / Ctrl+J", "keys_newline"),
    ("↑ / ↓", "keys_history"),
    ("Ctrl+R", "keys_search_history"),
    ("/history <词>", "keys_history_fuzzy"),
    ("F1 / F2 / F3", "keys_axes"),
    ("F4", "keys_thinking"),
    ("Ctrl+O", "keys_expand"),
    ("Ctrl+S", "keys_stash"),
    ("Ctrl+L", "keys_clear_screen"),
    ("Esc", "keys_escape"),
    ("Ctrl+C", "keys_ctrl_c"),
    ("! <命令>", "keys_bash"),
    ("? <回车>", "keys_help"),
]

_KEY_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
MAX_USER_KEYS = 20


class KeyWarning:
    """一条键位警告：`code` 给调用方翻译，`detail` 是原始值（键名/命令/条数）。

    code 取值：
      reserved        想覆盖保命键（回车/Esc/Ctrl+C…）
      app_bound       想覆盖已接真功能的键（Ctrl+S/Ctrl+O/F1–F4…）
      invalid_key     键名写法不对（prompt_toolkit 的写法：`c-e`/`f5`/`c-s-f`）
      not_command     值不是斜杠命令（自定键位只能走命令，不能开新的执行面）
      too_many        条数超过上限
    """

    def __init__(self, code: str, detail: str = "") -> None:
        self.code = str(code)
        self.detail = str(detail)

    def __repr__(self) -> str:
        return f"KeyWarning({self.code!r}, {self.detail!r})"

    def __eq__(self, other: object) -> bool:
        return (isinstance(other, KeyWarning) and other.code == self.code
                and other.detail == self.detail)


class KeyBinding:
    """一条实际生效的键位：`key`（prompt_toolkit 写法）→ `command`（斜杠命令）。"""

    def __init__(self, key: str, command: str, source: str = "user") -> None:
        self.key = str(key)
        self.command = str(command)
        self.source = str(source)

    def __repr__(self) -> str:
        return f"KeyBinding({self.key!r} → {self.command!r}, {self.source})"

    def __eq__(self, other: object) -> bool:
        return (isinstance(other, KeyBinding) and other.key == self.key
                and other.command == self.command and other.source == self.source)


class KeyResolution:
    """解析结果：生效的键位 + 结构化警告（调用方负责翻译与打印）。"""

    def __init__(self, bindings: Sequence[KeyBinding] = (),
                 warnings: Sequence[KeyWarning] = ()) -> None:
        self.bindings = list(bindings)
        self.warnings = list(warnings)

    @property
    def ok(self) -> bool:
        return not self.warnings

    def commands(self) -> List[str]:
        return [b.command for b in self.bindings]

    def __repr__(self) -> str:
        return f"KeyResolution({self.bindings!r}, warn={len(self.warnings)})"


def resolve_bindings(raw: Any,
                     reserved: Sequence[str] = tuple(RESERVED_KEYS),
                     app_bound: Sequence[str] = tuple(APP_BOUND_KEYS),
                     limit: int = MAX_USER_KEYS) -> KeyResolution:
    """配置里的 `keybindings` → 生效键位 + 警告（**先拒绝再接受**，理由见模块说明）。

    `raw` 非 dict（写成了列表/字符串/数字）时返回空结果 + 一条 `invalid_key`：
    配置写错类型时最坏的结果是"键位没生效但没人知道"，所以这里必须留痕。
    """
    out: List[KeyBinding] = []
    warns: List[KeyWarning] = []
    if raw in (None, "", {}, []):
        return KeyResolution()
    if not isinstance(raw, dict):
        return KeyResolution([], [KeyWarning("invalid_key", type(raw).__name__)])

    _res, _app = set(reserved), set(app_bound)
    items = [(str(k or "").strip().lower(), str(v or "").strip())
             for k, v in raw.items()]
    if len(items) > int(limit):
        warns.append(KeyWarning("too_many", str(len(items))))
        items = items[:int(limit)]
    for key, cmd in items:
        if not key or not cmd:
            warns.append(KeyWarning("invalid_key", key or "<空>"))
            continue
        if not cmd.startswith("/"):
            warns.append(KeyWarning("not_command", f"{key}={cmd}"))
            continue
        if not _KEY_RE.match(key):
            warns.append(KeyWarning("invalid_key", key))
            continue
        if key in _res:
            warns.append(KeyWarning("reserved", key))
            continue
        if key in _app:
            warns.append(KeyWarning("app_bound", key))
            continue
        binding = KeyBinding(key, cmd, "user")
        if binding in out:
            continue
        out.append(binding)
    return KeyResolution(out, warns)


def render_key_table(bindings: Sequence[KeyBinding], width: int = 0,
                     translate: Optional[Callable[[str], str]] = None,
                     builtin: Optional[Sequence[Tuple[str, str]]] = None
                     ) -> List[str]:
    """键位表 → 待打印行：先内置（说明来自 i18n 键），再用户自定义。

    `translate` 缺省时直接显示 i18n 键名（测试里断言用），有它才翻成人话 ——
    本模块不碰 i18n，翻不翻由调用方决定。
    """
    tr = translate or (lambda k: k)
    rows = list(builtin if builtin is not None else BUILTIN_KEYS)
    lines = [tr("keys_header"), f"  {tr('keys_builtin')}"]
    for key, desc_key in rows:
        lines.append(f"    {key:<22}{tr(desc_key)}")
    lines.append(f"  {tr('keys_custom')}")
    if not bindings:
        lines.append(f"    {tr('keys_none')}")
    for b in bindings:
        lines.append(f"    {b.key:<22}{b.command}")
    lines.append(tr("keys_hint"))
    return lines


# ============================================================
# 作用域键位（上下文决定这一下按的是什么）+ 和弦 + 帮助
# ============================================================
#
# 为什么要有"作用域"：同一个 `Esc` 在四个地方是四件事 —— 输入框里是清空/退出多行、
# 菜单开着是收起菜单、有对话框是**按拒绝处理**、其余情况是收起面板。"一套全局键位"
# 解释不了这件事，于是旧实现只能让 Esc"什么都做一点"或者干脆不做。作用域把
# "此刻按下去会发生什么"变成一张可断言的表。
#
# 为什么要有"和弦"：`Ctrl+X` 之后接一个键做低频操作，比给每个低频功能抢一个
# `Ctrl+字母` 好 —— 后者会把常用键位挤满，用户还得记住哪些被占了（真实终端里
# `Ctrl+字母` 本来就没剩几个能用的）。

SCOPES: Tuple[str, ...] = ("global", "prompt", "overlay", "dialog", "transcript")
CHORD_TIMEOUT = 1.0                    # 和弦第一段的有效期（秒）


class ActionBinding:
    """一条**应用动作**键位：`key` → `action`（语义动作名，不是斜杠命令）。"""

    __slots__ = ("key", "action", "desc_key", "scope", "chord")

    def __init__(self, key: str, action: str, desc_key: str,
                 scope: str = "global", chord: str = "") -> None:
        self.key = str(key)
        self.action = str(action)
        self.desc_key = str(desc_key)
        self.scope = scope if scope in SCOPES else "global"
        self.chord = str(chord)        # 非空表示"这是和弦的第二段"

    def __repr__(self) -> str:
        return (f"ActionBinding({self.key!r} → {self.action!r}, "
                f"scope={self.scope!r})")


# 应用键位表：**唯一**来源。Textual 的 BINDINGS 与 `?` 帮助面板都从这里生成 ——
# 两处各写一份的结果是"帮助里写着的键其实没绑"，那比没有帮助更坏。
APP_KEYMAP: Tuple[ActionBinding, ...] = (
    ActionBinding("enter", "submit", "key_submit", "prompt"),
    ActionBinding("shift+tab", "cycle_permission", "key_cycle_perm", "prompt"),
    ActionBinding("escape", "cancel", "key_cancel", "prompt"),
    ActionBinding("up", "history_prev", "key_history", "prompt"),
    ActionBinding("down", "history_next", "key_history", "prompt"),
    ActionBinding("tab", "complete", "key_complete", "prompt"),
    ActionBinding("ctrl+j", "newline", "key_newline", "prompt"),
    ActionBinding("alt+enter", "newline", "key_newline", "prompt"),
    ActionBinding("shift+enter", "newline", "key_newline", "prompt"),
    # 行编辑（readline/emacs 那一套）：终端里最不容易被抢、也最不需要解释的键
    ActionBinding("ctrl+w", "delete_word_back", "key_del_word", "prompt"),
    ActionBinding("alt+backspace", "delete_word_back", "key_del_word", "prompt"),
    ActionBinding("alt+d", "delete_word_end", "key_del_word_end", "prompt"),
    ActionBinding("ctrl+k", "delete_to_end", "key_del_line_end", "prompt"),
    ActionBinding("ctrl+u", "delete_to_start", "key_del_line", "prompt"),
    ActionBinding("ctrl+y", "paste_killed", "key_paste_killed", "prompt"),
    ActionBinding("alt+y", "yank_pop", "key_yank_pop", "prompt"),
    ActionBinding("ctrl+_", "undo", "key_undo", "prompt"),
    ActionBinding("ctrl+shift+-", "undo", "key_undo", "prompt"),
    ActionBinding("alt+b", "word_left", "key_word_left", "prompt"),
    ActionBinding("alt+f", "word_right", "key_word_right", "prompt"),
    ActionBinding("ctrl+s", "stash_prompt", "key_stash", "prompt"),
    ActionBinding("ctrl+r", "search_history", "key_search", "prompt"),
    ActionBinding("ctrl+p", "prev", "key_prev", "prompt"),
    ActionBinding("ctrl+n", "next", "key_next", "prompt"),
    ActionBinding("ctrl+f", "find", "key_find", "global"),
    ActionBinding("ctrl+o", "expand", "key_expand", "global"),
    ActionBinding("ctrl+b", "toggle_board", "key_board", "global"),
    ActionBinding("ctrl+t", "tasks", "key_tasks", "global"),
    ActionBinding("ctrl+g", "external_editor", "key_editor", "global"),
    ActionBinding("alt+m", "model_pick", "key_model", "global"),
    ActionBinding("alt+n", "new_chat", "key_new", "global"),
    ActionBinding("alt+h", "history", "key_history_pick", "global"),
    ActionBinding("alt+t", "effort", "key_effort", "global"),
    ActionBinding("alt+w", "net_toggle", "key_net", "global"),
    ActionBinding("alt+l", "lang", "key_lang", "global"),
    ActionBinding("alt+1", "home", "key_home", "global"),
    # `alt+t` 此前**绑了两次**（`:260` 的 effort 与这一段的 toggle_thinking）——
    # 同键两义的后果是"按下去做哪件事取决于谁先查到"，而帮助面板会把两条都列出来。
    # 思考开关改挂 `alt+k`（它同一段里被写给了 tasks，而 tasks 已有 `ctrl+t`），
    # 于是两个动作各留一个键、一个键都不少。前端注册表（`frontend/src/keys/registry.ts`）
    # 的默认表与此逐条一致。
    ActionBinding("alt+k", "toggle_thinking", "key_thinking", "global"),
    ActionBinding("ctrl+l", "clear_transcript", "key_clear", "global"),
    ActionBinding("ctrl+c", "interrupt", "key_interrupt", "global"),
    ActionBinding("ctrl+d", "quit_if_empty", "key_quit", "global"),
    ActionBinding("f1", "help", "key_help", "global"),
    ActionBinding("f2", "toggle_thinking", "key_thinking", "global"),
    ActionBinding("pageup", "scroll_up", "key_scroll", "transcript"),
    ActionBinding("pagedown", "scroll_down", "key_scroll", "transcript"),
    ActionBinding("ctrl+q", "quit", "key_quit", "global"),
    # 和弦：低频操作不抢常用键
    ActionBinding("ctrl+x", "chord_prefix", "key_chord", "global"),
    ActionBinding("e", "expand_all", "key_expand_all", "global", chord="ctrl+x"),
    ActionBinding("t", "tasks", "key_tasks", "global", chord="ctrl+x"),
    ActionBinding("d", "diff", "key_diff", "global", chord="ctrl+x"),
    # 队列语义（对应 Claude 的 `Ctrl+X Enter` / `Ctrl+Enter`）：不打断 vs 立刻发
    ActionBinding("enter", "queue_submit", "key_queue_submit", "global", chord="ctrl+x"),
    ActionBinding("ctrl+s", "send_now", "key_send_now", "global", chord="ctrl+x"),
    # 这里原来还有一条 `ctrl+e`（chord `ctrl+x`）→ external_editor：那是 `ctrl+e` 的**第二个含义**。
    # 实际跑的那条路（`ui/ace_engine_repl.py:177` 的行内热键 `c-e` → `/expandall`，与
    # `docs/COMMANDS.md`、`docs/KEYMAP-CLAUDE-PARITY.md` 的口径）只有一个含义：Ctrl+E = 全部展开；
    # 而且行编辑层没有和弦状态机，Ctrl+X Ctrl+E 根本到不了编辑器。留着它只会让帮助面板
    # 写着一个按不出来的键（"帮助里有的键其实没绑"正是本表 docstring 要防的那件事）。
    # 编辑器仍有 `ctrl+g`（`:256`），一个键都没少。
    ActionBinding("1", "dialog_1", "key_dialog_1", "dialog"),
    ActionBinding("2", "dialog_2", "key_dialog_2", "dialog"),
    ActionBinding("3", "dialog_3", "key_dialog_3", "dialog"),
)


def bindings_for(scope: str, keymap: Sequence[ActionBinding] = APP_KEYMAP
                 ) -> List[ActionBinding]:
    """当前作用域生效的键位：本作用域的 + `global` 的（global 永远兜底）。"""
    s = str(scope or "")
    return [b for b in keymap if b.scope == s or b.scope == "global"]


def help_rows(scope: str = "", translate: Optional[Callable[[str], str]] = None,
              keymap: Sequence[ActionBinding] = APP_KEYMAP
              ) -> List[Tuple[str, str, str]]:
    """帮助面板的行：`(作用域, 键, 说明)`。按作用域分组，顺序与表里一致。

    帮助是**生成**的，不是手写的：加了键位忘了写帮助，用户就当它不存在。
    """
    tr = translate or (lambda k: k)
    out: List[Tuple[str, str, str]] = []
    want = str(scope or "")
    for b in keymap:
        if want and b.scope != want:
            continue
        key = f"{b.chord} {b.key}".strip() if b.chord else b.key
        out.append((b.scope, key, tr(b.desc_key)))
    return out


class ChordMap:
    """和弦解析：`Ctrl+X` 之后按 `e` → `expand_all`。

    `feed()` 返回 `(action, pending)`：`pending=True` 表示"第一段已吃下，等第二段"。
    超时（`CHORD_TIMEOUT`）或按了没登记的键 → 这一段作废，且**不吞掉**这个键
    （返回 `("", False)`，调用方照常处理它）—— 吞键是"我按了没反应"的经典来源。
    """

    def __init__(self, keymap: Sequence[ActionBinding] = APP_KEYMAP,
                 timeout: float = CHORD_TIMEOUT) -> None:
        self.timeout = float(timeout)
        self.prefix: Dict[str, Dict[str, str]] = {}
        self.prefix_actions: Dict[str, str] = {}
        for b in keymap:
            if b.chord:
                self.prefix.setdefault(b.chord, {})[b.key] = b.action
            else:
                self.prefix_actions[b.key] = b.action
        self._armed: Optional[str] = None
        self._t0 = 0.0

    def feed(self, key: str, now: float) -> Tuple[str, bool]:
        k = str(key or "")
        if self._armed:
            table = self.prefix.get(self._armed, {})
            self._armed = None
            if k in table:
                return table[k], False
            return "", False              # 第二段不认识：不吞键，交给调用方
        if k in self.prefix:
            self._armed = k
            self._t0 = float(now)
            return "", True
        return "", False

    def expired(self, now: float) -> bool:
        if self._armed and (float(now) - self._t0) > self.timeout:
            self._armed = None
            return True
        return False

    def reset(self) -> None:
        """撤掉"待续"状态（和弦已用完、或者宿主决定不接了）。"""
        self._armed = None

    @property
    def armed(self) -> Optional[str]:
        return self._armed

    def label(self) -> str:
        """第一段按下后底栏该显示的提示（"Ctrl+X … 等第二个键"）。"""
        return self._armed or ""

