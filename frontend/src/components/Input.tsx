/**
 * 输入行 —— 行编辑（带光标）+ 补全菜单 + vim 子集 + 两段式中断
 * + Ctrl+R 历史搜索 + 大粘贴折叠。
 *
 * ## 为什么要有"光标"
 *
 * 最初这里是纯追加的（只能在末尾打字）。加 vim 之后不行了：`h`/`l`/`w`/`b`/`ciw`
 * 全都是**围绕光标**的动作，没有光标位置这些就无从谈起。顺带地，普通编辑也受益 ——
 * 能在中间改错字了（此前只能删到那儿重打）。
 *
 * ## 按键的优先级（顺序不能换）
 *
 *   1. 弹框占着 → 什么都不接（`disabled`）
 *   2. **历史搜索开着 → 搜索独占**（打字是过滤词，不是输入；Esc 只关搜索）
 *   3. 补全菜单开着 → 菜单先吃（↑↓/Tab/回车），否则 vim 会把方向键当 motion
 *   4. vim 开着 → 交给 vim 引擎
 *   5. 否则 → 普通行编辑
 *
 * ## 历史搜索（Ctrl+R）—— 借鉴 dsh-TUI 的输入编辑器，语义沿用 ace
 *
 * 交互照 dsh 的 `HistorySearchDialog`：增量过滤 + ↑↓ 选 + 回车**回填不发送**；
 * 但历史**来源**用 ace 自己的：本会话提交过的行 + `~/.ace_history`（`_history_entries`
 * 那张表，见 `ai_code.py:2153`），**不新建** dsh 那种 `~/.dsh-tui/history.jsonl`。
 * 过滤是子串（与 Python 的 Ctrl+R 同口径），`/history` 的模糊评分仍归 Python 命令。
 *
 * ## 大粘贴折叠
 *
 * 多行/超长粘贴折成**一行提示**（dsh：`isBigInput`，阈值同为 ≥6 行 / ≥600 字符），
 * 但值仍是全文 —— 回车提交的是**展开后的全文**，折叠从不丢数据。任何编辑键（打字/
 * 退格/方向/Ctrl-*）都会先展开，于是"回车前先看一眼"只需按一下方向键。
 * 与 dsh 的差别：他们是行内 chip，点击/Esc/全屏编辑器才展开；ace 没有鼠标选区与
 * 全屏编辑器，用**提示行**（复用已有文案 `paste_folded`），展开交给编辑键。
 * ponytail: 折的是**整个值**（不做行内 chip —— 那要连着光标/选区几何一起处理）；
 * 代价是折叠期间草稿里原有的字也看不见，按一下方向键即全露。
 *
 * ## 三条与 Python 侧对齐、且必须对齐的语义
 *
 *   - **回车**：菜单开着且候选与输入不同 → 先补全，不发送；一致 → 发送。
 *   - **忙时输入不丢**：跑一轮时按回车是排队，不是"没反应"。
 *   - **Esc 两段式**：菜单开着先关菜单 → 有内容清内容 → 都空了才请求中断。
 *
 * ## 为什么值存在 ref 里
 *
 * `setState` 是异步的，而按键回调闭包捕获的是**注册那一刻**的值。"粘贴 + 紧接着回车"
 * 会走成：回车那刻闭包里的值是空的 → 内容被当成空输入丢掉。手打看不出来（人打字有
 * 间隔，中间会重渲染），**粘贴必现**。所以读一律走 ref。
 */

import { Box, Text, useInput } from '../../vendor/dsh-ink/kernel.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  acceptedText,
  buildMenu,
  type BuildMenuOptions,
  type MenuState,
  windowBounds,
} from '../render/menu.js';
import { g, gstr } from '../render/glyphs.js';
import { truncateWidth } from '../render/text.js';
import { VimLineEditor } from '../render/vim.js';
import { Menu } from './Menu.js';

const CLOSED: MenuState = { items: [], selected: 0, open: false, kind: '', query: '', span: [0, 0] };

/** 折叠门槛 —— 与 dsh-TUI 同口径（`PromptInput.tsx:221-224`）。 */
const FOLD_MIN_LINES = 6;
const FOLD_MIN_CHARS = 600;
/** 历史搜索一次最多显示几行候选（选中项由 `windowBounds` 保证可见）。 */
const SEARCH_ROWS = 6;

/** 这段文本够不够大（够大才折）。 */
export function isBigText(text: string): boolean {
  return text.split('\n').length >= FOLD_MIN_LINES || text.length >= FOLD_MIN_CHARS;
}

/**
 * 一次插入该不该折，折了显示几行。
 *
 * 触发条件是**一次"粘贴"**（内核 bracketed paste 给的 `key.isPasted`）或**整块就很大**
 * （老终端不发 bracketed 标记，大粘贴是一整块字节 —— dsh 的启发式）；**再**要求插入后
 * 确实很大（`isBigText`，与 dsh 的 `isBigInput(next)` 同一条）：粘两行小片段不该被藏起来。
 * 逐字打字永远不折 —— 单个字符既不 pasted 也不 big。
 */
export function foldLinesFor(chunk: string, next: string, pasted: boolean): number | null {
  if (!pasted && !isBigText(chunk)) return null;
  return isBigText(next) ? next.split('\n').length : null;
}

/**
 * 解析 `~/.ace_history` 的行 —— **逐条照 `ai_code.AgentCLI._history_entries`**（`:2159-2180`）：
 * 跳空行/`#` 注释（prompt_toolkit 的时间戳），剥它写的 `+` 前缀，只去掉**相邻**重复。
 * 两边口径一致，用户不会看到"`/history` 有这条、Ctrl+R 没有"。
 */
export function parseHistoryLines(raw: string): string[] {
  const out: string[] = [];
  for (const line of String(raw ?? '').split('\n')) {
    let s = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!s || s.startsWith('#')) continue;
    if (s.startsWith('+')) s = s.slice(1);
    s = s.trim();
    if (s && (out.length === 0 || out[out.length - 1] !== s)) out.push(s);
  }
  return out;
}

/**
 * 读 ace 既有的跨会话历史（`~/.ace_history`，与 Python 侧同一个文件，**不新建**）。
 * `ACE_NO_HISTORY` 的语义与 Python 逐字一致（置位 = 不读也不留）。
 * 读不到就返回空 —— 历史检索失败不该影响任何别的功能。
 */
export function readHistoryFile(): string[] {
  const off = (process.env.ACE_NO_HISTORY ?? '').trim().toLowerCase();
  if (off === '1' || off === 'true' || off === 'yes' || off === 'on') return [];
  // ponytail: 每次 Ctrl+R 同步读一遍（文件通常几十 KB，回车路径上不读）；
  // 真成为瓶颈再按 mtime 缓存，现在不值得多一层状态。
  try {
    return parseHistoryLines(readFileSync(join(homedir(), '.ace_history'), 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * 历史 → 候选（**最近的在最前**，与 dsh 的 `Chat.tsx:3527-3530` 同序）。
 * 匹配用**子串**：这是 ace 的 Ctrl+R 口径（`ui/ace_prompt.py:425`）。
 */
export function filterHistory(entries: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const hits = q ? entries.filter((e) => e.toLowerCase().includes(q)) : [...entries];
  return hits.reverse();
}

/** 把一条历史压成一行（换行/制表都变空格）—— 与 Python 的 `" ".join(e.split())` 同口径。 */
function oneLine(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(' ');
}

interface SearchState {
  query: string;
  selected: number;
  /** 全部来源（过滤前的全量，退格时能还原）。 */
  all: string[];
  matches: string[];
}

export interface InputProps {
  t: (key: string, params?: Record<string, string | number>) => string;
  color: (token: string) => string | undefined;
  /** 提交一行。返回 false 表示没接受（例如空行），输入框保留内容。 */
  onSubmit: (line: string) => boolean | void;
  /** Esc：忙时请求中断。 */
  onInterrupt?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  menuOptions?: BuildMenuOptions;
  width?: number;
  /** vim 子集（`/vim` 开）。关着时等同普通行编辑。 */
  vim?: boolean;
  /**
   * **挂载时**的起始草稿（不给 = 空）。只在挂载那一次读 —— 不是受控组件，
   * 之后外部的值变化一概不理会（值仍以内部 `valueRef` 为唯一真相）。
   *
   * 它是给"面板整屏换掉主界面 ⇒ `Input` 卸载重挂"那条路用的：全屏草稿编辑器
   * （`Ctrl+G`）取消时把原文原样放回输入行（`App.tsx` 的 `draftRef`）。
   * 光标落在末尾。
   */
  initialDraft?: string;
  /**
   * 草稿每变一次报一次（App 拿它留一份副本）。
   *
   * 刻意**不做受控**：输入行每敲一个字都走这里，走 state 会把整个 `App`
   * 拉着重渲染（转录越长越贵）；不走的话面板一开那份草稿就没了。
   */
  onDraftChange?: (text: string) => void;
}

export function Input({
  t,
  color,
  onSubmit,
  onInterrupt,
  busy,
  disabled = false,
  placeholder,
  menuOptions,
  width = 80,
  vim = false,
  initialDraft,
  onDraftChange,
}: InputProps): React.ReactElement {
  const seed = initialDraft ?? '';
  const [value, setValue] = useState(seed);
  const [cursor, setCursor] = useState(seed.length);
  const [menu, setMenu] = useState<MenuState>(CLOSED);
  const [queued, setQueued] = useState<string[]>([]);
  const [vimMode, setVimMode] = useState<'normal' | 'insert'>('normal');
  /** 大粘贴折叠态（`null` = 没折）。值仍是全文，折的只是**显示**。 */
  const [fold, setFold] = useState<{ lines: number } | null>(null);
  /** Ctrl+R 历史搜索（`null` = 没开）。 */
  const [search, setSearch] = useState<SearchState | null>(null);

  const valueRef = useRef(seed);
  const cursorRef = useRef(seed.length);
  const menuRef = useRef<MenuState>(CLOSED);
  const foldRef = useRef<{ lines: number } | null>(null);
  const searchRef = useRef<SearchState | null>(null);
  /** 本会话提交过的行（内存历史）—— 与 `~/.ace_history` 合并成 Ctrl+R 的来源。 */
  const historyRef = useRef<string[]>([]);
  const dismissedFor = useRef<string | null>(null);
  const vimRef = useRef<VimLineEditor>(new VimLineEditor(seed, seed.length, vim));

  const recomputeMenu = useCallback(
    (text: string): void => {
      if (!menuOptions) {
        menuRef.current = CLOSED;
        setMenu(CLOSED);
        return;
      }
      if (dismissedFor.current === text) {
        menuRef.current = CLOSED;
        setMenu(CLOSED);
        return;
      }
      const next = buildMenu(text, text.length, menuOptions);
      menuRef.current = next;
      setMenu(next);
    },
    [menuOptions],
  );

  const setBoth = useCallback(
    (next: string, at?: number) => {
      const pos = Math.max(0, Math.min(at === undefined ? next.length : at, next.length));
      valueRef.current = next;
      cursorRef.current = pos;
      setValue(next);
      setCursor(pos);
      onDraftChange?.(next);
      recomputeMenu(next);
    },
    [onDraftChange, recomputeMenu],
  );

  /** 把 vim 引擎的状态同步回输入行。 */
  const syncFromVim = useCallback((): void => {
    const ed = vimRef.current;
    valueRef.current = ed.text;
    cursorRef.current = Math.max(0, Math.min(ed.cursor, ed.text.length));
    setValue(ed.text);
    setCursor(cursorRef.current);
    setVimMode(ed.mode);
    onDraftChange?.(ed.text);
    recomputeMenu(ed.text);
  }, [onDraftChange, recomputeMenu]);

  /** 展开折叠（任何真正的编辑动作之前都要先做这一步）。 */
  const unfold = useCallback((): void => {
    if (foldRef.current === null) return;
    foldRef.current = null;
    setFold(null);
  }, []);

  /**
   * 一次插入之后决定折不折。折了就**把补全菜单关掉**：值被藏起来了，菜单再按
   * 半截文本给候选就是答非所问。
   */
  const applyFold = useCallback(
    (chunk: string, next: string, pasted: boolean): void => {
      const lines = foldLinesFor(chunk, next, pasted);
      if (lines === null) {
        unfold();
        return;
      }
      const next2 = { lines };
      foldRef.current = next2;
      setFold(next2);
      menuRef.current = CLOSED;
      setMenu(CLOSED);
    },
    [unfold],
  );

  // ---- Ctrl+R 历史搜索（dsh 的交互 + ace 的历史来源） ----

  const putSearch = useCallback((next: SearchState | null): void => {
    searchRef.current = next;
    setSearch(next);
  }, []);

  /**
   * 打开搜索。**历史为空就不开** —— 与 Esc Esc 的历史选择器同一条
   * （`ui/ace_prompt.py:302`：没什么可选的就别装样子）。
   */
  const openSearch = useCallback((): void => {
    const all = [...readHistoryFile(), ...historyRef.current];
    if (all.length === 0) return;
    putSearch({ query: '', selected: 0, all, matches: filterHistory(all, '') });
    // 搜索期间输入行不弹补全菜单（两套浮层叠着只会互相打架）
    menuRef.current = CLOSED;
    setMenu(CLOSED);
  }, [putSearch]);

  const closeSearch = useCallback((): void => putSearch(null), [putSearch]);

  /** 改过滤词：**选中项回到第一条**（dsh 的 `history-edit` 也是重置焦点）。 */
  const editSearch = useCallback(
    (query: string): void => {
      const s = searchRef.current;
      if (!s) return;
      putSearch({ query, selected: 0, all: s.all, matches: filterHistory(s.all, query) });
    },
    [putSearch],
  );

  /** ↑↓ / 再按 Ctrl+R 走候选。到顶到底**不循环**（ace 菜单同一条口径）。 */
  const moveSearch = useCallback(
    (delta: number): void => {
      const s = searchRef.current;
      if (!s || s.matches.length === 0) return;
      const sel = Math.max(0, Math.min(s.selected + delta, s.matches.length - 1));
      putSearch({ ...s, selected: sel });
    },
    [putSearch],
  );

  /**
   * 回车 = **回填，不发送**（dsh `Chat.tsx:4487-4492` 与 ace 的 Esc Esc 历史选择器
   * `ui/ace_prompt.py:431-437` 是同一条）：历史那句是当时的上下文，再按一次回车才是发送。
   */
  const adoptSearch = useCallback((): void => {
    const s = searchRef.current;
    if (!s) return;
    const hit = s.matches[Math.max(0, Math.min(s.selected, s.matches.length - 1))];
    closeSearch();
    if (hit === undefined) return;
    dismissedFor.current = null;
    // 回填也把 vim 引擎对齐（`reset` 会清掉未完成的命令，避免 `d` 悬在半空）
    vimRef.current.reset();
    vimRef.current.setText(hit, hit.length);
    syncFromVim();
  }, [closeSearch, syncFromVim]);

  /**
   * **"已排队 N 条"必须有人收尾。**
   *
   * 忙的时候按回车，那行消息**其实已经发出去了**（引擎侧串行处理：它处理完当前轮才会
   * 读到下一条请求，见 `_h_user_message`）；这里的数组只是给用户看"还有几条在排"。
   * 此前它**只增不减** —— 底栏永远挂着"已排队 1 条"，而屏幕上一切正常，
   * 用户只会觉得"它卡住了"（实测截图就是这个）。
   *
   * 一轮结束（`busy` 落回 false）即清零：那一刻排在它前面的都已经轮到过了；
   * 后面还没轮到的会在下一轮把 `busy` 再置真，于是重新计。
   */
  useEffect(() => {
    if (!busy && queued.length > 0) setQueued([]);
  }, [busy, queued.length]);

  const moveSelection = useCallback((delta: number) => {
    const cur = menuRef.current;
    if (!cur.open || cur.items.length === 0) return;
    const n = cur.items.length;
    const next: MenuState = { ...cur, selected: (cur.selected + delta + n) % n };
    menuRef.current = next;
    setMenu(next);
  }, []);

  /** 发送当前内容（回车走到最后一步时）。 */
  const submit = useCallback(
    (text: string): void => {
      const line = text.trim();
      if (!line) return;
      const accepted = onSubmit(line);
      if (accepted === false) return;
      if (busy) setQueued((q) => [...q, line].slice(-8));
      // 本会话历史：Ctrl+R 的第一来源（`~/.ace_history` 只有经典 REPL 那条路会写，
      // 纯前端会话里它是空的）。相邻重复不记 —— 与 `_history_entries` 同口径。
      const mem = historyRef.current;
      if (mem[mem.length - 1] !== line) mem.push(line);
      dismissedFor.current = null;
      unfold();
      vimRef.current.reset();
      setBoth('', 0);
      setVimMode(vimRef.current.mode);
    },
    [busy, onSubmit, setBoth, unfold],
  );

  useInput(
    (input, key) => {
      if (disabled) return;
      const text = valueRef.current;
      const at = cursorRef.current;
      const m = menuRef.current;

      // ---- ① Ctrl+R：开历史搜索 / 搜索中走下一条 ----
      // 排在 Esc 前面：搜索开着时它是**独占**的，别的键一律不许漏进输入行。
      if (key.ctrl && input === 'r') {
        if (searchRef.current) moveSearch(1);
        else openSearch();
        return;
      }

      // ---- ② 历史搜索独占 ----
      const s = searchRef.current;
      if (s) {
        if (key.escape) {
          closeSearch();
        } else if (key.return) {
          adoptSearch(); // 回填不发送：历史那句是当时的上下文
        } else if (key.upArrow) {
          moveSearch(-1);
        } else if (key.downArrow) {
          moveSearch(1);
        } else if (key.backspace || key.delete) {
          editSearch(s.query.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta && !key.tab) {
          editSearch(s.query + input);
        }
        return; // 其余键（方向左右、Tab…）在搜索里没有意义，吞掉
      }

      // ---- ③ Esc：两段式（菜单 → 清空 → 中断）。vim 下额外：插入模式先回普通模式 ----
      if (key.escape) {
        if (vim && vimRef.current.mode === 'insert') {
          vimRef.current.feed('Escape');
          syncFromVim();
          return;
        }
        if (m.open) {
          dismissedFor.current = text;
          menuRef.current = CLOSED;
          setMenu(CLOSED);
        } else if (text.length > 0) {
          dismissedFor.current = null;
          unfold();
          vimRef.current.reset();
          setBoth('', 0);
        } else if (busy) {
          onInterrupt?.();
        }
        return;
      }

      // ---- ④ 菜单优先 ----
      if (m.open && key.upArrow) {
        moveSelection(-1);
        return;
      }
      if (m.open && key.downArrow) {
        moveSelection(1);
        return;
      }
      if (key.tab) {
        if (m.open) {
          const accepted = acceptedText(m, text);
          dismissedFor.current = null;
          setBoth(accepted);
        }
        return;
      }
      if (key.return) {
        // 回车语义：菜单开着且候选不同 → 先补全，不发送；折叠态提交的**是全文**
        if (m.open) {
          const accepted = acceptedText(m, text);
          if (accepted !== text) {
            dismissedFor.current = null;
            setBoth(accepted);
            return;
          }
        }
        submit(text);
        return;
      }

      // ---- ⑤ vim ----
      if (vim) {
        const ed = vimRef.current;
        ed.enabled = true;
        let inserted: string | null = null;
        if (ed.mode === 'insert') {
          if (key.backspace || key.delete) {
            unfold();
            ed.backspace();
          } else if (input && !key.ctrl && !key.meta) {
            ed.insert(input);
            inserted = input;
          }
        } else if (input && !key.ctrl && !key.meta) {
          // 普通模式：交给 vim 引擎（方向键等交给别处，vim 不管它们）
          unfold();
          ed.feed(input);
        }
        syncFromVim();
        // 折叠判定放在 `syncFromVim` **之后**：它会按新文本重算菜单，
        // 而折叠态要把菜单关掉（顺序反了就白关）。
        if (inserted !== null) applyFold(inserted, ed.text, key.isPasted === true);
        return;
      }

      // ---- ⑥ 普通行编辑 ----
      if (key.backspace || key.delete) {
        unfold();
        if (at > 0) setBoth(text.slice(0, at - 1) + text.slice(at), at - 1);
        return;
      }
      if (key.leftArrow) {
        unfold();
        setBoth(text, Math.max(0, at - 1));
        return;
      }
      if (key.rightArrow) {
        unfold();
        setBoth(text, Math.min(text.length, at + 1));
        return;
      }
      if (key.ctrl && input === 'u') {
        unfold();
        setBoth(text.slice(at), 0);
        return;
      }
      if (key.ctrl && input === 'w') {
        unfold();
        const head = text.slice(0, at).replace(/\S*\s*$/, '');
        setBoth(head + text.slice(at), head.length);
        return;
      }
      if (key.ctrl && input === 'a') {
        unfold();
        setBoth(text, 0);
        return;
      }
      if (key.ctrl && input === 'e') {
        unfold();
        setBoth(text, text.length);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        const next = text.slice(0, at) + input + text.slice(at);
        setBoth(next, at + input.length);
        applyFold(input, next, key.isPasted === true);
      }
    },
    { isActive: !disabled },
  );

  // 提示符是字形不是文案（不翻译），但**必须过 `g()`**：cp936 控制台印不出 `❯`，
  // 屏幕上那个位置会变成乱码 —— 而提示符是用户第一眼看到的东西。
  const prompt = g(busy ? '»' : '❯');
  // vim 状态栏片段：走 i18n（Python 那边这里是硬编码中文，属于已知的 i18n 债，
  // 新写的前端不把那条债也抄过来）
  const vimStatus = vim
    ? vimRef.current.status(t('vim_normal'), t('vim_insert'))
    : '';

  return (
    <Box flexDirection="column">
      {search ? <SearchPanel state={search} t={t} color={color} width={width} /> : null}

      {!search && menu.open ? (
        <Box marginBottom={1}>
          <Menu state={menu} t={t} color={color} width={width} />
        </Box>
      ) : null}

      {queued.length > 0 ? (
        <Text color={color('dim')}>
          {'  '}
          {t('input_queued_n', { n: queued.length })}
        </Text>
      ) : null}

      <Text>
        {/* 提示符用 **magenta** —— 与 ACE 的 Python 侧一致（`ai_code.py` 里写的是
            `c('magenta', '❯')`）。
            第一版我用的是 `success`（= ansigreen），整个提示符一片绿 —— 那是我自己编的，
            不是 ACE 的颜色。
            注：那一处 Python 是**硬编码**色名、没走 `ace_theme`，所以主题里没有对应 token；
            真要让它跟随主题，该在 `ui/ace_theme.py` 里加一个 `prompt` token（**上游**改），
            而不是在前端另造一个。 */}
        <Text color={busy ? color('dim') : 'magenta'}>{prompt} </Text>
        {/* 折叠态**不画值**：值还是全文（回车提交的就是它），只是不铺在屏幕上 ——
            几十行粘进来会把这个单行输入框撑成半屏。按任意编辑键即展开。 */}
        {fold ? null : <Text color={color('text')}>{value.slice(0, cursor)}</Text>}
        {/* 光标：vim 普通模式下是**反色块**，插入模式是普通光标 —— 形状不同是 vim 的惯例，
            用户靠它一眼知道自己现在在哪个模式，不必去看状态栏 */}
        <Text color={color('accent')} inverse={vim && vimMode === 'normal'}>
          {!fold && cursor < value.length ? value[cursor] : g('▌')}
        </Text>
        {fold ? null : <Text color={color('text')}>{value.slice(cursor + 1)}</Text>}
        {vimStatus ? <Text color={color('dim')}> {vimStatus}</Text> : null}
      </Text>

      {fold ? <Text color={color('dim')}>{t('paste_folded', { n: fold.lines })}</Text> : null}

      {busy ? (
        <Text color={color('dim')}>
          {'  '}
          {t('input_busy_hint')}
        </Text>
      ) : value.length === 0 && placeholder ? (
        <Text color={color('dim')}>
          {'  '}
          {placeholder}
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Ctrl+R 的搜索浮层：查询行 + 命中（最近的在上）+ 提示行。
 *
 * 窗口用 `render/menu.windowBounds` —— **与补全菜单同一套滚动口径**（黏边、不循环、
 * 选中项永远可见）。复用它是刻意的：同一个界面里两套滚动手感是 bug 不是风格。
 * 提示行用现成的 `search_hint`（"继续输入过滤 · Enter 采用 · Esc 取消"）。
 */
function SearchPanel({
  state,
  t,
  color,
  width,
}: {
  state: SearchState;
  t: (key: string, params?: Record<string, string | number>) => string;
  color: (token: string) => string | undefined;
  width: number;
}): React.ReactElement {
  const { from, to, hiddenAbove, hiddenBelow } = windowBounds(
    state.matches.length,
    state.selected,
    SEARCH_ROWS,
  );
  const shown = state.matches.slice(from, to);

  return (
    <Box flexDirection="column" marginBottom={1} paddingX={1}>
      <Text>
        <Text color={color('accent')}>{t('key_search') + ' '}</Text>
        <Text color={color('text')}>{state.query}</Text>
        <Text color={color('accent')} inverse>
          {g('▌')}
        </Text>
      </Text>

      {state.matches.length === 0 ? (
        <Text color={color('dim')}>{t('history_no_match', { q: state.query })}</Text>
      ) : (
        <>
          {hiddenAbove > 0 ? (
            <Text color={color('dim')}>{t('menu_more_above', { n: hiddenAbove })}</Text>
          ) : null}
          {shown.map((entry, i) => {
            const index = from + i;
            const selected = index === state.selected;
            // 一条历史压成一行 —— 历史里存着多行输入，原样铺开会把列表撑散
            const one = truncateWidth(oneLine(entry), Math.max(10, width - 6));
            return (
              <Text key={String(index) + one}>
                <Text color={selected ? color('accent') : color('dim')}>
                  {gstr(selected ? '▶ ' : '  ')}
                </Text>
                <Text color={selected ? color('accent') : color('text')}>{one}</Text>
              </Text>
            );
          })}
          {hiddenBelow > 0 ? (
            <Text color={color('dim')}>{t('menu_more', { n: hiddenBelow })}</Text>
          ) : null}
        </>
      )}

      <Text color={color('dim')}>{t('search_hint')}</Text>
    </Box>
  );
}
