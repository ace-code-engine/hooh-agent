/**
 * 输入行 —— 行编辑（带光标）+ 补全菜单 + vim 子集 + 两段式中断。
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
 *   2. 补全菜单开着 → 菜单先吃（↑↓/Tab/回车），否则 vim 会把方向键当 motion
 *   3. vim 开着 → 交给 vim 引擎
 *   4. 否则 → 普通行编辑
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

import { Box, Text, useInput } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  acceptedText,
  buildMenu,
  type BuildMenuOptions,
  type MenuState,
} from '../render/menu.js';
import { g } from '../render/glyphs.js';
import { VimLineEditor } from '../render/vim.js';
import { Menu } from './Menu.js';

const CLOSED: MenuState = { items: [], selected: 0, open: false, kind: '', query: '', span: [0, 0] };

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
}: InputProps): React.ReactElement {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [menu, setMenu] = useState<MenuState>(CLOSED);
  const [queued, setQueued] = useState<string[]>([]);
  const [vimMode, setVimMode] = useState<'normal' | 'insert'>('normal');

  const valueRef = useRef('');
  const cursorRef = useRef(0);
  const menuRef = useRef<MenuState>(CLOSED);
  const dismissedFor = useRef<string | null>(null);
  const vimRef = useRef<VimLineEditor>(new VimLineEditor('', 0, vim));

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
      recomputeMenu(next);
    },
    [recomputeMenu],
  );

  /** 把 vim 引擎的状态同步回输入行。 */
  const syncFromVim = useCallback((): void => {
    const ed = vimRef.current;
    valueRef.current = ed.text;
    cursorRef.current = Math.max(0, Math.min(ed.cursor, ed.text.length));
    setValue(ed.text);
    setCursor(cursorRef.current);
    setVimMode(ed.mode);
    recomputeMenu(ed.text);
  }, [recomputeMenu]);

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
      dismissedFor.current = null;
      vimRef.current.reset();
      setBoth('', 0);
      setVimMode(vimRef.current.mode);
    },
    [busy, onSubmit, setBoth],
  );

  useInput(
    (input, key) => {
      if (disabled) return;
      const text = valueRef.current;
      const at = cursorRef.current;
      const m = menuRef.current;

      // ---- ① Esc：两段式（菜单 → 清空 → 中断）。vim 下额外：插入模式先回普通模式 ----
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
          vimRef.current.reset();
          setBoth('', 0);
        } else if (busy) {
          onInterrupt?.();
        }
        return;
      }

      // ---- ② 菜单优先 ----
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
        // 回车语义：菜单开着且候选不同 → 先补全，不发送
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

      // ---- ③ vim ----
      if (vim) {
        const ed = vimRef.current;
        ed.enabled = true;
        if (ed.mode === 'insert') {
          if (key.backspace || key.delete) {
            ed.backspace();
          } else if (input && !key.ctrl && !key.meta) {
            ed.insert(input);
          }
        } else if (input && !key.ctrl && !key.meta) {
          // 普通模式：交给 vim 引擎（方向键等交给别处，vim 不管它们）
          ed.feed(input);
        }
        syncFromVim();
        return;
      }

      // ---- ④ 普通行编辑 ----
      if (key.backspace || key.delete) {
        if (at > 0) setBoth(text.slice(0, at - 1) + text.slice(at), at - 1);
        return;
      }
      if (key.leftArrow) {
        setBoth(text, Math.max(0, at - 1));
        return;
      }
      if (key.rightArrow) {
        setBoth(text, Math.min(text.length, at + 1));
        return;
      }
      if (key.ctrl && input === 'u') {
        setBoth(text.slice(at), 0);
        return;
      }
      if (key.ctrl && input === 'w') {
        const head = text.slice(0, at).replace(/\S*\s*$/, '');
        setBoth(head + text.slice(at), head.length);
        return;
      }
      if (key.ctrl && input === 'a') {
        setBoth(text, 0);
        return;
      }
      if (key.ctrl && input === 'e') {
        setBoth(text, text.length);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setBoth(text.slice(0, at) + input + text.slice(at), at + input.length);
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
      {menu.open ? (
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
        <Text color={color('text')}>{value.slice(0, cursor)}</Text>
        {/* 光标：vim 普通模式下是**反色块**，插入模式是普通光标 —— 形状不同是 vim 的惯例，
            用户靠它一眼知道自己现在在哪个模式，不必去看状态栏 */}
        <Text color={color('accent')} inverse={vim && vimMode === 'normal'}>
          {cursor < value.length ? value[cursor] : g('▌')}
        </Text>
        <Text color={color('text')}>{value.slice(cursor + 1)}</Text>
        {vimStatus ? <Text color={color('dim')}> {vimStatus}</Text> : null}
      </Text>

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
