/**
 * 字形降级测试。
 *
 * ## 这道防线是为什么加的（实机可见）
 *
 * 中文 Windows 控制台代码页 **936（GBK）**，`❯` `✓` `✗` `◐` `▶` `⚠` 这些
 * **印不出来** —— 屏幕上那些位置是乱码或方框，而且**不报任何错**。
 * Python 侧一直有这套降级（`core/ace_io.glyph`），前端漏接了。
 *
 * 表由**引擎**下发（只有它知道控制台编码：Node 判断不了 legacy 编码），
 * 所以这里测的是"拿到表之后组件**真的换了字**"。
 *
 * ## 迁移记录（S5，换内核）
 * 分两条路（见 `./mount.js` 文件头的分工表）：
 *   - `ToolCard` / `Menu` 是纯渲染 ⇒ `./helpers/screen.js` 的 `renderLines()`，
 *     拿到**纯文本**（无 ANSI 样式码）—— 「不含 `❯`」这类断言在上面比原来更硬；
 *   - `Input` 要 `useInput`（挂输入监听）⇒ `./mount.js` 的 `mountTree()`。
 * 断言一字未改；`setGlyphs` / `afterEach` 复位照旧。
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Input } from '../src/components/Input.js';
import { Menu } from '../src/components/Menu.js';
import { ToolCard } from '../src/components/ToolCard.js';
import { g, glyphMap, gstr, setGlyphs } from '../src/render/glyphs.js';
import { buildMenu } from '../src/render/menu.js';
import { renderLines } from './helpers/screen.js';
import { mountTree } from './mount.js';

const t = (k: string): string => k;
const noColor = (): string | undefined => undefined;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

/** cp936 上真实会降级的那些（与引擎算出的一致）。 */
const CP936: Record<string, string> = {
  '❯': '>',
  '◈': '*',
  '▶': '>',
  '✓': 'v',
  '✗': 'x',
  '◐': 'o',
  // 工具卡 pending 用的是 `◌`（不是 spinner 那个 `◐`）；它此前不在引擎的兜底表里，
  // 于是在 cp936 上显示成 `?`。已在 `core/ace_io.ASCII_FALLBACK` 补上，这里跟着补。
  '◌': 'o',
  '◓': 'o',
  '◑': 'o',
  '◒': 'o',
  '⚠': '!',
  '▖': '.',
  '▘': '.',
  '▝': '.',
  '▗': '.',
  '•': '*',
};

afterEach(() => setGlyphs(undefined)); // 每个用例后复位，别污染别的测试

describe('纯函数', () => {
  it('没设表时是恒等函数（UTF-8 终端就是这样）', () => {
    expect(g('❯')).toBe('❯');
    expect(gstr('❯ ◐ ▶')).toBe('❯ ◐ ▶');
    expect(glyphMap()).toEqual({});
  });

  it('设了表就换字；表里没有的原样保留', () => {
    setGlyphs(CP936);
    expect(g('❯')).toBe('>');
    expect(g('中')).toBe('中'); // 表里没有 → 不动
    expect(gstr('❯◐✓ 中文')).toBe('>o v 中文'.replace(' ', ''));
  });

  it('空串 / undefined 不崩', () => {
    expect(gstr('')).toBe('');
    setGlyphs(null);
    expect(g('❯')).toBe('❯');
  });
});

describe('组件真的换了字', () => {
  it('**提示符**：cp936 下 `❯` 变成 `>`（这是用户第一眼看到的那个字）', async () => {
    setGlyphs(CP936);
    const { lastFrame, unmount } = mountTree(
      <Input t={t} color={noColor} busy={false} onSubmit={() => true} />,
    );
    await tick();
    const out = lastFrame() ?? '';
    unmount();
    expect(out).toContain('>');
    expect(out).not.toContain('❯');
  });

  it('工具卡：三态字形全换（`✓`→`v`、`✗`→`x`、`◐`→`o`）', () => {
    setGlyphs(CP936);
    for (const [status, want] of [['ok', 'v'], ['fail', 'x'], ['running', 'o']] as const) {
      const out = renderLines(<ToolCard tool="file_read" status={status} color={noColor} />, 100).text;
      expect(out, status).toContain(want);
    }
  });

  it('选中标记：`▶` 换成 `>` 后菜单里不再有画不出的字', () => {
    setGlyphs(CP936);
    const st = buildMenu('/', 1, {
      commands: { '/help': 'cmd_help' },
      groupOf: () => 'group_session',
      translate: t,
    });
    const out = renderLines(<Menu state={st} t={t} color={noColor} width={80} />, 80).text;
    expect(out).not.toContain('▶');
    expect(out).toContain('>');
  });

  it('**没设表时一个都不换**（UTF-8 终端不该被降级）', async () => {
    setGlyphs(undefined);
    const { lastFrame, unmount } = mountTree(
      <Input t={t} color={noColor} busy={false} onSubmit={() => true} />,
    );
    await tick();
    const out = lastFrame() ?? '';
    unmount();
    expect(out).toContain('❯');
  });
});
