/**
 * 全屏草稿编辑器（`components/draft-editor/**`）—— 缓冲区算术 + 按键 → 帧内容 +
 * `$EDITOR` 往返。本波组件**没有**接进 `App.tsx`，所以这里直接挂组件本身。
 *
 * ## 怎么驱按键
 *
 * 与 `input-editor.test.tsx` 同一条：**真字节**走 `mountTree()` 的假 stdin，断言看
 * **帧内容**（不是内部状态）。几个键的字节：`Ctrl+S`=0x13、`Ctrl+G`=0x07、
 * `Ctrl+_`=0x1f、`Esc`=`\x1b`、`Enter`=`\r`、方向键=`\x1b[A/B/C/D`。
 * 内核把 0x1f 解析成 `{name:'_', ctrl:true}`（`lib/types/ink/parse-keypress.js`），
 * 这正是 `ui/ace_keys.py:244-245` 的上游写法。
 *
 * ## 为什么帧要先剥 ANSI
 *
 * 光标是 `inverse`（反显，瑞士规范里"选中"唯一的手段），那一段会插 SGR。
 * 断言"`one` 后面紧跟着光标块"就必须先剥控制序列 —— 否则测的是 ANSI 排版不是内容。
 *
 * ## `$EDITOR` 用**假编辑器**（绝不起交互式编辑器）
 *
 * `EDITOR` 设成 `"<node>" -e "<无引号 payload>"`：payload 里**一个引号都没有**
 * （用 `String.fromCharCode` 拼 `fs`/内容），才能穿过 `splitEditorCommand` 的引号处理。
 * 真 spawn、真临时文件、真读回 —— 只有"编辑器"本身是假的。
 */

import { describe, expect, it } from 'vitest';

import { Draft, draftRows, nextCharEnd, prevCharStart } from '../src/components/draft-editor/buffer.js';
import { DRAFT_KEYS, DraftEditor } from '../src/components/draft-editor/DraftEditor.js';
import {
  editInExternalEditor,
  resolveEditorCommand,
  splitEditorCommand,
} from '../src/components/draft-editor/external-editor.js';
import { mountTree, waitFor } from './mount.js';

// ─────────────────────────────────────────────────────────── 工具

const t = (k: string, params?: Record<string, string | number>): string =>
  params ? `${k}(${Object.values(params).join(',')})` : k;
const noColor = (): string | undefined => undefined;

/** 剥 SGR（只有样式，没有内容）—— 断言跨 `inverse` 光标块时必需。 */
const plain = (s: string | undefined): string => (s ?? '').replace(/\x1b\[[0-9;]*m/g, '');

const UP = '\x1b[A';
const RIGHT = '\x1b[C';
const CTRL_S = '\x13';
const CTRL_G = '\x07';
const CTRL_UNDERSCORE = '\x1f';
const ENTER = '\r';

const tick = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Mounted {
  lastFrame: () => string | undefined;
  stdin: { write: (s: string) => void };
  confirmed: string[];
  cancelled: number;
}

interface MountOptions {
  width?: number;
  rows?: number;
  env?: NodeJS.ProcessEnv;
}

function mount(value: string, options: MountOptions = {}): Mounted {
  const confirmed: string[] = [];
  const state = { cancelled: 0 };
  const r = mountTree(
    <DraftEditor
      value={value}
      t={t}
      color={noColor}
      width={options.width ?? 100}
      rows={options.rows ?? 20}
      env={options.env}
      onConfirm={(text) => confirmed.push(text)}
      onCancel={() => {
        state.cancelled += 1;
      }}
    />,
    // 假 stdout 的列数必须与组件拿到的宽度一致，否则帧会在 100 列处被截断
    { width: options.width ?? 100 },
  );
  return {
    lastFrame: r.lastFrame,
    stdin: r.stdin,
    confirmed,
    get cancelled() {
      return state.cancelled;
    },
  };
}

/** 起手等首帧：`useInput` 在 effect 里订阅，订阅前写的键会被丢掉。 */
async function ready(value: string, options: MountOptions = {}): Promise<Mounted> {
  const m = mount(value, options);
  await tick();
  return m;
}

/**
 * 造一条**假编辑器**命令：`"<node>" -e "<payload>"`。
 *
 * payload 里不能有引号 —— `splitEditorCommand` 认单双引号，一有引号就被吃掉/截断。
 * 所以内容与 `fs` 都用 `String.fromCharCode` 拼。
 */
function fakeEditor(codes: number[], tail = ''): string {
  const payload =
    'const fs=require(String.fromCharCode(102,115));' +
    `fs.writeFileSync(process.argv[1],String.fromCharCode(${codes.join(',')}));` +
    tail;
  return `"${process.execPath}" -e "${payload}"`;
}

const code = (...chars: string[]): number[] => chars.join('').split('').map((c) => c.charCodeAt(0));

// ─────────────────────────────────────────────────────────── ① 缓冲区（纯逻辑）

describe('Draft 缓冲区：光标算术与撤销', () => {
  it('插入多行块会拆行，光标落在最后一段末尾', () => {
    const d = new Draft('ab');
    d.insert('X\nY\nZ');
    expect(d.text).toBe('abX\nY\nZ');
    expect(d.row).toBe(2);
    expect(d.col).toBe(1);
    d.insert('!');
    expect(d.text).toBe('abX\nY\nZ!');
  });

  it('退格跨行合并；代理项（emoji）不会被劈成半个', () => {
    const d = new Draft('one\ntwo');
    d.moveLineStart();
    d.backspace();
    expect(d.text).toBe('onetwo');
    expect(d.col).toBe(3);

    const e = new Draft('a\u{1f600}');
    expect(prevCharStart(e.lines[0]!, 3)).toBe(1);
    expect(nextCharEnd(e.lines[0]!, 1)).toBe(3);
    e.backspace();
    expect(e.text).toBe('a'); // 整个 emoji 一起走，不留孤立低代理项
  });

  it('上下移动记住目标列（长行 → 短行 → 长行，列不缩水）', () => {
    const d = new Draft('aaaaaaaa\nb\ncccccccc');
    d.moveUp();
    d.moveUp();
    expect(d.row).toBe(0);
    expect(d.col).toBe(8);
    d.moveDown();
    expect(d.col).toBe(1); // 短行只能到行尾
    d.moveDown();
    expect(d.col).toBe(8); // 回到长行，目标列还在
  });

  it('撤销是**逐键两步**（ace 口径：打 hello → ctrl+_ → hell），栈空返回 false', () => {
    const d = new Draft('');
    for (const ch of 'hello') d.insert(ch);
    expect(d.text).toBe('hello');
    expect(d.undo()).toBe(true);
    expect(d.text).toBe('hell');
    expect(d.undo()).toBe(true);
    expect(d.text).toBe('hel');
    d.undo();
    d.undo();
    d.undo();
    expect(d.text).toBe('');
    expect(d.undo()).toBe(false); // 到底了，不再吞掉按键
  });

  it('ctrl+u / ctrl+k / ctrl+w 与删除键各行其是', () => {
    const d = new Draft('alpha beta\ngamma');
    d.moveUp(); // 光标上到第 1 行（起手在末尾那行），列仍是 5
    d.killToStart();
    expect(d.text).toBe(' beta\ngamma'); // 只删光标前那截，光标落到行首
    expect(d.col).toBe(0);
    const e = new Draft('alpha beta\ngamma');
    e.moveLineStart();
    e.moveRight();
    e.killToEnd();
    expect(e.text).toBe('alpha beta\ng'); // 删到行尾
    const f = new Draft('alpha beta');
    f.killWordLeft();
    expect(f.text).toBe('alpha '); // 吃掉一个词（含左侧空白）
    const g = new Draft('abc');
    g.moveLineStart();
    g.deleteForward();
    expect(g.text).toBe('bc');
    const h = new Draft('ab\ncd');
    h.moveLineStart();
    h.moveUp();
    h.moveLineEnd();
    h.deleteForward();
    expect(h.text).toBe('abcd'); // Delete 在行尾接上下一行
  });

  it('draftRows：行号、光标行标记、超宽行按显示列截断', () => {
    const d = new Draft('short\n' + '\u4e2d'.repeat(30) + '\nlast');
    d.moveUp();
    const rows = draftRows(d, { from: 0, count: 3, width: 20, gutter: 2 });
    expect(rows.map((r) => r.no)).toEqual([1, 2, 3]);
    expect(rows[0]!.isCaret).toBe(false);
    expect(rows[1]!.isCaret).toBe(true);
    // 内容列宽 = 20 - 2 - 3 = 15；中文占 2 列 ⇒ 最多 7 个字 + 光标
    expect(rows[1]!.before.length).toBeLessThanOrEqual(15);
  });
});

// ─────────────────────────────────────────────────────────── ② 按键 → 帧内容

describe('按键 → 帧内容（mountTree 真渲染 + 真字节）', () => {
  it('首帧：标题 + 细线 + 每行行号 + 位置行 + 键位提示行', async () => {
    // 200 列是为了让四个键位提示不触发截断（提示行走 i18n 的 `key_hint`，本来就长）
    const m = await ready('one\ntwo', { width: 200 });
    const f = plain(m.lastFrame());
    expect(f).toContain('draft_editor_title');
    expect(f).toContain('-'.repeat(200)); // 整宽细线（ASCII `-`，规范 §1.2）
    expect(f).toContain(' 1 │ one');
    expect(f).toContain(' 2 │ two');
    expect(f).toContain('draft_position(2,2)'); // 光标起手在末尾：第 2 行 / 共 2 行
    expect(f).toContain('key_hint(Ctrl+S,key_confirm)');
    expect(f).toContain('key_hint(Ctrl+_,key_undo)');
    expect(f).toContain('key_hint(Ctrl+G,key_editor)');
    expect(f).toContain('key_hint(Esc,key_cancel)');
  });

  it('↑ 把光标块搬到上一行（帧里 `one▌` 出现、`two▌` 消失）', async () => {
    const m = await ready('one\ntwo');
    expect(plain(m.lastFrame())).toContain('two▌');

    m.stdin.write(UP);
    await tick();
    const f = plain(m.lastFrame());
    expect(f).toContain('one▌');
    expect(f).not.toContain('two▌');
    expect(f).toContain('draft_position(1,2)');
  });

  it('打字进正文，→ 把光标推着走', async () => {
    const m = await ready('ab');
    m.stdin.write('X');
    await tick();
    expect(plain(m.lastFrame())).toContain('abX▌');

    m.stdin.write(RIGHT); // 已经在末尾 → 不动，也不崩
    await tick();
    expect(plain(m.lastFrame())).toContain('abX▌');
    expect(plain(m.lastFrame())).toContain('draft_position(1,1)');
  });

  it('回车是**换行**不是发送：多出一行，且没有调用 onConfirm', async () => {
    const m = await ready('one\ntwo');
    m.stdin.write(ENTER);
    await tick();
    const f = plain(m.lastFrame());
    expect(f).toContain('draft_position(3,3)');
    expect(f).toContain(' 3 │ ▌');
    expect(m.confirmed).toEqual([]); // 全屏编辑里回车绝不发送
  });

  it('Ctrl+_ 撤销一步（帧回到上一状态），ace 键位', async () => {
    const m = await ready('ab');
    m.stdin.write('c');
    await tick();
    expect(plain(m.lastFrame())).toContain('abc▌');

    m.stdin.write(CTRL_UNDERSCORE);
    await tick();
    const f = plain(m.lastFrame());
    expect(f).toContain('ab▌');
    expect(f).not.toContain('abc▌');
  });

  it('PgUp 翻页：窗口跟着走，行号仍然对得上', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n');
    const m = await ready(lines, { rows: 8 }); // 可见 8-4 = 4 行
    m.stdin.write('\x1b[5~'); // PgUp
    await tick();
    const f = plain(m.lastFrame());
    expect(f).toContain('draft_position(6,10)');
    expect(f).toContain(' 6 │ l6▌');
    expect(f).not.toContain(' 1 │ l1'); // 窗口滚走了，不是"从第 1 行开始铺"
  });

  it('Ctrl+S 确认：把草稿全文交给 onConfirm', async () => {
    const m = await ready('hello');
    m.stdin.write('!');
    await tick();
    m.stdin.write(CTRL_S);
    await tick();
    expect(m.confirmed).toEqual(['hello!']);
  });

  it('Esc 取消：调 onCancel，**不**调 onConfirm（本轮改动被丢弃）', async () => {
    const m = await ready('keep');
    m.stdin.write('X');
    await tick();
    m.stdin.write('\x1b'); // 裸 ESC 要等内核的 50ms 转义超时才会落地
    await tick(150);
    expect(m.cancelled).toBe(1);
    expect(m.confirmed).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────── ③ $EDITOR（假编辑器）

describe('$EDITOR 集成（真 spawn / 真临时文件 / 假编辑器）', () => {
  it('Ctrl+G：写临时文件 → 拉起假编辑器 → 读回内容并写进草稿', async () => {
    // 假编辑器把文件覆盖成 "Z\nW"
    const env = { ...process.env, EDITOR: fakeEditor([...code('Z'), 10, ...code('W')]), VISUAL: '' };
    const m = await ready('original', { env });

    m.stdin.write(CTRL_G);
    await waitFor(() => plain(m.lastFrame()).includes('Z'));
    const f = plain(m.lastFrame());
    expect(f).toContain(' 1 │ Z');
    expect(f).toContain(' 2 │ W▌'); // 读回后光标落在末尾：第 2 行
    expect(f).toContain('draft_position(2,2)');
    expect(f).not.toContain('original'); // 原稿被整个换掉了

    m.stdin.write(CTRL_S);
    await tick();
    expect(m.confirmed).toEqual(['Z\nW']);
  });

  it('编辑器**非零退出** = 反悔（`:cq` 语义）：草稿一个字不动', async () => {
    const env = {
      ...process.env,
      EDITOR: `"${process.execPath}" -e "process.exit(3)"`,
      VISUAL: '',
    };
    const m = await ready('untouched', { env });
    m.stdin.write(CTRL_G);
    await tick(400);
    expect(plain(m.lastFrame())).toContain('untouched');
    m.stdin.write(CTRL_S);
    await tick();
    expect(m.confirmed).toEqual(['untouched']);
  });

  it('存盘只多了一个终止换行 ⇒ 不算改过（编辑器的惯例不是用户内容）', async () => {
    const out = await editInExternalEditor('Z', {
      env: { EDITOR: fakeEditor([...code('Z'), 10]), VISUAL: '' } as NodeJS.ProcessEnv,
    });
    expect(out.kind).toBe('unchanged');
  });

  it('读回内容与草稿真的不同才算 edited（CRLF 归一后比较）', async () => {
    const out = await editInExternalEditor('old', {
      env: { EDITOR: fakeEditor(code('n', 'e', 'w')), VISUAL: '' } as NodeJS.ProcessEnv,
    });
    expect(out).toEqual({ kind: 'edited', text: 'new' });
  });

  it('命令行解析：认引号、认带参数；没设 EDITOR 时按平台兜底', () => {
    expect(splitEditorCommand('code --wait')).toEqual(['code', '--wait']);
    expect(splitEditorCommand('"C:\\Program Files\\nvim.exe" -f')).toEqual([
      'C:\\Program Files\\nvim.exe',
      '-f',
    ]);
    expect(splitEditorCommand("nano 'my file.md'")).toEqual(['nano', 'my file.md']);
    expect(resolveEditorCommand({ EDITOR: 'ed -x' } as NodeJS.ProcessEnv, 'linux')).toEqual(['ed', '-x']);
    expect(resolveEditorCommand({ VISUAL: 'vis' } as NodeJS.ProcessEnv, 'linux')).toEqual(['vis']);
    expect(resolveEditorCommand({} as NodeJS.ProcessEnv, 'win32')).toEqual(['notepad']);
    expect(resolveEditorCommand({} as NodeJS.ProcessEnv, 'linux')).toEqual(['vi']);
  });
});

// ─────────────────────────────────────────────────────────── ④ 新增 i18n 键（三语值）

describe('新增 i18n 键：本波不改 locales，三语值在这里定稿', () => {
  /**
   * 三语定稿表 —— 整合波把右边这三列写进 `locales/{zh,en,ja}.json` 即可，组件不用改。
   * 放在**测试**里而不是 `src/**`：`i18n-complete.test.ts` 第 3 条禁止组件源码出现
   * 中文字面量，而本波的键还不许进字典。
   */
  const I18N: Record<string, Record<'zh' | 'en' | 'ja', string>> = {
    draft_editor_title: { zh: '草稿编辑', en: 'Draft editor', ja: '下書き編集' },
    draft_position: {
      zh: '第 {line} 行 / 共 {total} 行',
      en: 'line {line} / {total}',
      ja: '{line} 行目 / 全 {total} 行',
    },
    draft_editor_failed: {
      zh: '外部编辑器失败：{name}',
      en: 'external editor failed: {name}',
      ja: '外部エディタが失敗しました: {name}',
    },
    key_confirm: { zh: '确认（采纳草稿）', en: 'confirm (adopt draft)', ja: '確定（下書きを採用）' },
  };

  it('DRAFT_KEYS 每一条都有齐三语，占位符对得上', () => {
    for (const key of Object.values(DRAFT_KEYS)) {
      const row = I18N[key];
      expect(row, `缺三语值: ${key}`).toBeDefined();
      for (const lang of ['zh', 'en', 'ja'] as const) {
        expect(row![lang].length).toBeGreaterThan(0);
      }
    }
    expect(I18N.draft_position!.zh).toContain('{line}');
    expect(I18N.draft_position!.zh).toContain('{total}');
    expect(I18N.draft_position!.en).toContain('{line}');
    expect(I18N.draft_position!.ja).toContain('{total}');
    expect(Object.keys(I18N).sort()).toEqual(Object.values(DRAFT_KEYS).sort());
  });
});
