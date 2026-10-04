/**
 * 全屏（备用屏）模式下的**转录接线** —— 一条最容易漏的线。
 *
 * 组件各自写好不等于接对了：`--fullscreen`（或引擎配置 `fullscreen=true`）时转录必须走
 * `<ScrollBox>`（备用屏里终端没有回滚，历史只能自己管）；**主屏那条路不进视口**（它把
 * 历史交给终端自己的回滚缓冲，改了它等于把"往上翻"这个能力换掉）。这条测试盯的就是这个分叉。
 *
 * ## 迁移记录（S5 换内核 → S7 收口）
 * `ink-testing-library` → `./mount.js`（内核 `renderSync` + 假 stdio）。
 * S7 的三处调整（断言**意图**一条没动）：
 *   1. 注入按键改成 `pressUntil()`（补发）：内核挂载期在等一个永远不来的终端应答，
 *      这一拍里注入的字节会**丢在注入侧**（实测单跑 12 次丢 3 次；先静置 300ms
 *      让探询落定则 12/12 不丢）。⚠️ 丢的不是解析：内核按键解析器在
 *      xtversion/da1 查询在飞时照样把 `\x1b[5~` 解析成 pageUp（`.recon/s7-probe.mjs` ①）。
 *   2. 尺寸按**接口 B** 显式包 `TerminalSizeContext.Provider`（`{columns, rows}`）：
 *      不包时 App 落回 80×30 兜底，`bodyHeight = rows - 10` 跟着变、视口高度就失真。
 *   3. 新增「关掉全屏不清空转录」那条（转录状态提到 `Root`，见 `.recon/S7-fullscreen.md`）。
 */

import { describe, expect, it } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

import { App } from '../src/App.js';
import { Root } from '../src/Root.js';
import { I18n } from '../src/i18n.js';
import type { AceEvent } from '../src/protocol/types.js';
import { TerminalSizeContext } from '../vendor/dsh-ink/kernel.js';
import { FakeClient, tick } from './fake-engine.js';
import { mountTree, waitFor, type MountedTree } from './mount.js';

const noColor = (): string | undefined => undefined;
const i18n = new I18n('zh');
const noMenu = { commands: {}, groupOf: () => 'group_more', translate: (k: string) => k };

/** 终端尺寸（接口 B）。与 `mountTree` 的假 stdout 同宽，行数取 24（兜底是 30，两者不同）。 */
const SIZE = { columns: 100, rows: 24 };

/**
 * 给这棵树一个**真实**终端尺寸。
 *
 * `App` 读的是内核的 `TerminalSizeContext`（value 形状 `{columns, rows}`）；这里显式包一层，
 * 是为了让"视口高度"由本文件钉死，而不是靠内核根组件的默认值 —— 不钉的话拿不到 Provider 时
 * `App` 会退到 80×30，`bodyHeight = rows - 10` 一变，ScrollBox 的窗口就不是断言假设的那个。
 * ⚠️ 这个 context 必须从 `kernel.js` 取（另开一条路径会拿到**另一个** context 对象，包了白包）。
 */
function withSize(node: ReactNode): ReactElement {
  return <TerminalSizeContext.Provider value={SIZE}>{node}</TerminalSizeContext.Provider>;
}

function feed(n: number): AceEvent[] {
  const out: AceEvent[] = [{ type: 'user_message', ts: 1, text: '起' }];
  for (let i = 0; i < n; i++) {
    out.push({ type: 'notice', ts: 2 + i, text: `第${i}条通知` });
  }
  out.push({ type: 'final', ts: 99, text: '收工' });
  return out;
}

const hintShown = (tree: MountedTree): boolean =>
  (tree.lastFrame() ?? '').includes(i18n.t('scroll_hint'));

/** 在 `tree` 上敲一条引擎侧命令（回车提交），并把重读配置的那几拍让出来。 */
async function submit(tree: MountedTree, line: string): Promise<void> {
  tree.stdin.write(line);
  await tick();
  tree.stdin.write('\r');
  await waitFor(() => (tree.lastFrame() ?? '').length > 0, 300);
  await tick();
  await tick();
}

/**
 * 注入按键，直到 `check()` 成真（最多 `tries` 次）。
 *
 * 为什么要能补发：内核挂载期会往终端发探询（XTVERSION/DA1），假 stdout 永远不回应；
 * 这一拍里注入 stdin 的字节会**丢在注入侧**（补发一次必中，静置 300ms 也不丢）。
 * 它只负责"按到为止"，判断仍然由调用处的 `expect` 负责（超时后 expect 报真正的红）。
 */
async function pressUntil(
  tree: MountedTree,
  key: string,
  check: () => boolean,
  tries = 3,
): Promise<void> {
  for (let i = 0; i < tries && !check(); i++) {
    tree.stdin.write(key);
    await waitFor(check, 300);
  }
}

describe('全屏模式的转录接线', () => {
  it('fullscreen：转录进 `<ScrollBox>`（能翻，且翻上去出现"跳到最新"提示）', async () => {
    const client = new FakeClient();
    const tree = mountTree(
      withSize(
        <App client={client} t={(k, p) => i18n.t(k, p)} colorOf={noColor} menuOptions={noMenu} fullscreen />,
      ),
    );
    await tick();
    for (const ev of feed(40)) client.push(ev);
    await waitFor(() => (tree.lastFrame() ?? '').includes('第39条通知'));
    const bottom = tree.lastFrame() ?? '';
    expect(bottom).toContain('第39条通知');       // 贴底：最后一条看得见
    await pressUntil(tree, '\x1b[5~', () => hintShown(tree));   // PageUp
    expect(tree.lastFrame() ?? '').toContain(i18n.t('scroll_hint'));
    tree.unmount();
  });

  it('默认（主屏）：不进滚动视口（历史交给终端自己的回滚缓冲）', async () => {
    const client = new FakeClient();
    const tree = mountTree(
      withSize(
        <App client={client} t={(k, p) => i18n.t(k, p)} colorOf={noColor} menuOptions={noMenu} />,
      ),
    );
    await tick();
    for (const ev of feed(40)) client.push(ev);
    await waitFor(() => (tree.lastFrame() ?? '').includes('第39条通知'));
    const out = tree.lastFrame() ?? '';
    expect(out).toContain('第39条通知');
    expect(out).not.toContain(i18n.t('scroll_hint'));   // 主屏没有自己的视口
    tree.unmount();
  });

  it('★敲 `/fullscreen on` → 引擎改了配置 → 前端重读后**上报**（此前这条链是断的：前端根本不理会）', async () => {
    const client = new FakeClient();
    const seen: boolean[] = [];
    const tree = mountTree(
      withSize(
        <App
          client={client}
          t={(k, p) => i18n.t(k, p)}
          colorOf={noColor}
          menuOptions={noMenu}
          onFullscreenChange={(on) => seen.push(on)}
        />,
      ),
    );
    await tick();
    // 引擎侧 `/fullscreen on` 之后，重读配置拿到的就是 true
    client.config = { ...client.config, fullscreen: true };
    tree.stdin.write('/fullscreen on');
    await tick();
    tree.stdin.write('\r');                       // 提交这条命令
    await waitFor(() => seen.length > 0, 500);
    expect(client.calls.some((c) => c.method === 'command' && String(c.args[0]).includes('fullscreen')))
      .toBe(true);
    expect(seen[seen.length - 1]).toBe(true);
    tree.unmount();
  });

  it('★引擎配置说 fullscreen=true → Root 把转录切到滚动视口（不必靠命令行参数）', async () => {
    const client = new FakeClient();
    client.config = { ...client.config, fullscreen: true };
    const tree = mountTree(
      withSize(
        <Root client={client} i18n={i18n} colorOf={noColor} menuOptions={noMenu} engineLang="zh" />,
      ),
    );
    await tick();
    for (const ev of feed(40)) client.push(ev);
    await waitFor(() => (tree.lastFrame() ?? '').includes('第39条通知'));
    expect(tree.lastFrame() ?? '').toContain('第39条通知');
    // PageUp：只有滚动视口才会出现这个提示
    await pressUntil(tree, '\x1b[5~', () => hintShown(tree));
    expect(tree.lastFrame() ?? '').toContain(i18n.t('scroll_hint'));
    tree.unmount();
  });

  it('★关掉全屏：转录**不被清空**，再开回来历史仍完整（内核备用屏只有挂载/卸载语义）', async () => {
    const client = new FakeClient();
    client.config = { ...client.config, fullscreen: true };
    const tree = mountTree(
      withSize(
        <Root client={client} i18n={i18n} colorOf={noColor} menuOptions={noMenu} engineLang="zh" />,
      ),
    );
    await tick();
    for (const ev of feed(40)) client.push(ev);
    await waitFor(() => (tree.lastFrame() ?? '').includes('第39条通知'));
    expect(tree.lastFrame() ?? '').toContain('第39条通知');

    // 引擎侧 `/fullscreen off` → 前端重读配置 → Root 把备用屏那层摘掉。
    // ⚠️ 内核 `<AlternateScreen>` **没有 `enabled`**：摘掉它 = 换元素类型 = `App` 重挂。
    // 修复前这一下会把 `App` 的 `useReducer` 一起带走，转录变成空的（S3 记的回归）。
    client.config = { ...client.config, fullscreen: false };
    await submit(tree, '/fullscreen off');
    const off = tree.lastFrame() ?? '';
    expect(off).toContain('第39条通知');           // ← 回归点：修复前这里是空的
    expect(off).not.toContain(i18n.t('scroll_hint'));   // 已经回到主屏（没有自己的视口）

    // 再开回来：历史**完整**（最早那条也翻得到），不是只剩"关掉之后"那几条。
    client.config = { ...client.config, fullscreen: true };
    await submit(tree, '/fullscreen on');
    expect(tree.lastFrame() ?? '').toContain('第39条通知');
    await pressUntil(tree, 'g', () => (tree.lastFrame() ?? '').includes('起'));  // 翻到顶
    expect(tree.lastFrame() ?? '').toContain(i18n.t('scroll_hint'));
    expect(tree.lastFrame() ?? '').toContain('起');
    tree.unmount();
  });
});
