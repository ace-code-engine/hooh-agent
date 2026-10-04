/**
 * `/exit` 必须**真的退出去**。
 *
 * 实测投诉：敲 `/exit` 之后输入框变灰、窗口却还在，只能按 Ctrl+C 才退得出去。
 * 根因是**契约存在但没人消费** —— 引擎在 `command.exec` 的回执里早就给了
 * `keep_going: keep is not False`，前端从不看这个字段。
 *
 * 怎么观察"退出"：`ink-testing-library` 的 `render()` **没有** `waitUntilExit()` ✗，
 * 所以放一个 `<Probe/>` 兄弟节点 —— Ink 退出会卸载整棵树，它的 effect 清理就是"退出了"的
 * 框架级证据（不依赖任何内部实现）。
 *
 * 探针**每条测试各带一个回调**，不用模块级变量：React 的 effect 清理是异步的，
 * 上一条测试的卸载会落进下一条里（第一版就是这么假红的）。
 *
 * ## 迁移记录（S5，换内核）
 * `ink-testing-library` → `./mount.js`（内核 `renderSync` + 假 stdio）。`mount()` 依旧
 * 没有 `waitUntilExit()`，探针那条设计**照旧**（它本来就是为这件事写的）。断言一字未改。
 * ✅ 复查（同日）：`src/**` 已整体换到内核（`from 'ink'` 清零），本文件随全量测试转绿。
 */

import React from 'react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { I18n } from '../src/i18n.js';
import { FakeClient, tick } from './fake-engine.js';
import { mountTree, type MountedTree } from './mount.js';

const noColor = (): string | undefined => undefined;
const i18n = new I18n('zh');
const noMenu = { commands: {}, groupOf: () => 'group_more', translate: (k: string) => k };

/** 挂在 App 旁边的探针：整棵树被卸载（= Ink 退出）时回调一次。 */
function Probe({ onUnmount }: { onUnmount: () => void }): null {
  React.useEffect(() => () => {
    onUnmount();
  }, [onUnmount]);
  return null;
}

function mount(client: FakeClient, onUnmount: () => void): MountedTree {
  return mountTree(
    <>
      <App client={client} t={(k, p) => i18n.t(k, p)} colorOf={noColor} menuOptions={noMenu} />
      <Probe onUnmount={onUnmount} />
    </>,
  );
}

async function submit(tree: MountedTree, line: string): Promise<void> {
  tree.stdin.write(line);
  await tick();
  tree.stdin.write('\r');
  await tick();
  await tick();
}

describe('/exit 退得出去', () => {
  it('★引擎回 `keep_going: false` → 整棵树卸载（应用真的退出了）', async () => {
    const client = new FakeClient();
    client.commandReply = { ok: true, keep_going: false };
    let gone = false;
    const tree = mount(client, () => { gone = true; });
    await tick();
    await submit(tree, '/exit');
    expect(client.calls.some((c) => c.method === 'command' && c.args[0] === '/exit')).toBe(true);
    expect(gone).toBe(true);
  });

  it('★回执里没有 `keep_going`（老引擎）→ 不许误退，窗口继续开着', async () => {
    const client = new FakeClient();
    client.commandReply = { ok: true };
    let gone = false;
    const tree = mount(client, () => { gone = true; });
    await tick();
    await submit(tree, '/status');
    expect(gone).toBe(false);
    tree.unmount();
  });

  it('`keep_going: true`（普通命令）→ 不退', async () => {
    const client = new FakeClient();
    client.commandReply = { ok: true, keep_going: true };
    let gone = false;
    const tree = mount(client, () => { gone = true; });
    await tick();
    await submit(tree, '/vim');
    expect(gone).toBe(false);
    tree.unmount();
  });

  it('★引擎进程结束（崩了/收工）→ 界面也跟着退（否则窗口永远开着）', async () => {
    const client = new FakeClient();
    let gone = false;
    const tree = mount(client, () => { gone = true; });
    await tick();
    client.emitExit(1, null);
    await tick();
    await tick();
    expect(gone).toBe(true);
    tree.unmount();
  });
});
