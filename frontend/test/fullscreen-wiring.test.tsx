/**
 * 全屏（备用屏）模式下的**转录接线** —— 一条最容易漏的线。
 *
 * 组件各自写好不等于接对了：`--fullscreen` 时转录必须走 `<ScrollBox>`（备用屏里终端
 * 没有回滚，历史只能自己管）；**默认（主屏）必须仍然走 `<Static>`**（那条路是往终端
 * 真实回滚缓冲里写，改了它等于把"往上翻"这个能力换掉）。这条测试盯的就是这个分叉。
 */

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { Root } from '../src/Root.js';
import { I18n } from '../src/i18n.js';
import type { AceEvent } from '../src/protocol/types.js';
import { FakeClient, tick } from './fake-engine.js';

const noColor = (): string | undefined => undefined;
const i18n = new I18n('zh');
const noMenu = { commands: {}, groupOf: () => 'group_more', translate: (k: string) => k };

function feed(n: number): AceEvent[] {
  const out: AceEvent[] = [{ type: 'user_message', ts: 1, text: '起' }];
  for (let i = 0; i < n; i++) {
    out.push({ type: 'notice', ts: 2 + i, text: `第${i}条通知` });
  }
  out.push({ type: 'final', ts: 99, text: '收工' });
  return out;
}

describe('全屏模式的转录接线', () => {
  it('fullscreen：转录进 `<ScrollBox>`（能翻，且翻上去出现"跳到最新"提示）', async () => {
    const client = new FakeClient();
    const tree = render(
      <App client={client} t={(k, p) => i18n.t(k, p)} colorOf={noColor} menuOptions={noMenu} fullscreen />,
    );
    await tick();
    for (const ev of feed(40)) client.push(ev);
    await tick();
    const bottom = tree.lastFrame() ?? '';
    expect(bottom).toContain('第39条通知');
    tree.stdin.write('\x1b[5~');                 // PageUp
    await tick();
    expect(tree.lastFrame() ?? '').toContain(i18n.t('scroll_hint'));
    tree.unmount();
  });

  it('默认（主屏）：仍走 `<Static>`，不出现滚动条（回滚交给终端自己）', async () => {
    const client = new FakeClient();
    const tree = render(
      <App client={client} t={(k, p) => i18n.t(k, p)} colorOf={noColor} menuOptions={noMenu} />,
    );
    await tick();
    for (const ev of feed(40)) client.push(ev);
    await tick();
    const out = tree.lastFrame() ?? '';
    expect(out).toContain('第39条通知');
    expect(out).not.toContain(i18n.t('scroll_hint'));
    tree.unmount();
  });

  it('★敲 `/fullscreen on` → 引擎改了配置 → 前端重读后**上报**（此前这条链是断的：前端根本不理会）', async () => {
    const client = new FakeClient();
    const seen: boolean[] = [];
    const tree = render(
      <App
        client={client}
        t={(k, p) => i18n.t(k, p)}
        colorOf={noColor}
        menuOptions={noMenu}
        onFullscreenChange={(on) => seen.push(on)}
      />,
    );
    await tick();
    // 引擎侧 `/fullscreen on` 之后，重读配置拿到的就是 true
    client.config = { ...client.config, fullscreen: true };
    tree.stdin.write('/fullscreen on');
    await tick();
    tree.stdin.write('\r');                       // 提交这条命令
    await tick();
    await tick();
    expect(client.calls.some((c) => c.method === 'command' && String(c.args[0]).includes('fullscreen')))
      .toBe(true);
    expect(seen[seen.length - 1]).toBe(true);
    tree.unmount();
  });

  it('★引擎配置说 fullscreen=true → Root 把转录切到滚动视口（不必靠命令行参数）', async () => {
    const client = new FakeClient();
    client.config = { ...client.config, fullscreen: true };
    const tree = render(
      <Root client={client} i18n={i18n} colorOf={noColor} menuOptions={noMenu} engineLang="zh" />,
    );
    await tick();
    for (const ev of feed(40)) client.push(ev);
    await tick();
    expect(tree.lastFrame() ?? '').toContain('第39条通知');
    tree.stdin.write('\x1b[5~');                  // PageUp：只有滚动视口才会出现这个提示
    await tick();
    expect(tree.lastFrame() ?? '').toContain(i18n.t('scroll_hint'));
    tree.unmount();
  });
});
