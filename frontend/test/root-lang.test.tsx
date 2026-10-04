/**
 * 界面语言**跟着引擎走** —— 这条以前是断的，而且断得很有欺骗性：
 * 引擎侧全套翻译都在（`/` 菜单、参数提示），`ui/i18n.py` 也真的切了语言，
 * 但前端**自己那份字典**是启动时按 `--lang` 建一次、之后再也不动。
 * 结果：引擎旁白变英文，斜杠后面的提示还是中文（实测投诉）。
 *
 * 这一组测两件事：
 *   1. 起步听**引擎**的（配置里写了 en 就该是英文，不必命令行 `--lang`）；
 *   2. 运行中收到 `language` 事件就换字典。
 */

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { I18n } from '../src/i18n.js';
import { Root } from '../src/Root.js';
import { FakeClient, tick } from './fake-engine.js';

const noColor = (): string | undefined => undefined;
const noMenu = { commands: {}, groupOf: () => 'group_more', translate: (k: string) => k };

describe('界面语言跟着引擎走', () => {
  it('命令行没给 --lang 时，用**引擎握手报的**语言（配置里写 en 也算）', async () => {
    const i18n = new I18n('zh');
    const client = new FakeClient();
    render(
      <Root
        client={client}
        i18n={i18n}
        colorOf={noColor}
        menuOptions={noMenu}
        engineLang="en"
      />,
    );
    await tick();
    expect(i18n.language).toBe('en');
    // 真的换了文案，不只是换了个标记位
    expect(i18n.t('group_session')).not.toBe(new I18n('zh').t('group_session'));
  });

  it('命令行给了 --lang 就听用户的（不能被引擎覆盖）', async () => {
    const i18n = new I18n('zh');
    const client = new FakeClient();
    render(
      <Root
        client={client}
        i18n={i18n}
        colorOf={noColor}
        menuOptions={noMenu}
        commandLineLang="ja"
        engineLang="en"
      />,
    );
    await tick();
    expect(i18n.language).toBe('ja');
  });

  it('运行中引擎切语言（`/lang en`）→ 收到 `language` 事件就换字典', async () => {
    const i18n = new I18n('zh');
    const client = new FakeClient();
    const tree = render(
      <Root
        client={client}
        i18n={i18n}
        colorOf={noColor}
        menuOptions={noMenu}
        engineLang="zh"
      />,
    );
    await tick();
    const before = i18n.t('group_session');
    // **先数**再挂探针：至少两个才是 App + Root（探针自己也会算进去，所以顺序要紧）
    expect(client.listeners.get('event')?.length ?? 0).toBeGreaterThanOrEqual(2);
    const seen: string[] = [];
    client.on('event', (ev: { type?: string }) => seen.push(String(ev.type)));
    client.push({ type: 'language', ts: 1, lang: 'en' });
    expect(seen).toContain('language');
    await tick();
    expect(i18n.language).toBe('en');
    expect(i18n.t('group_session')).not.toBe(before);
    tree.unmount();
  });

  it('引擎报了个不认识的语言 → 不动（不能让界面变成键名堆）', async () => {
    const i18n = new I18n('zh');
    const client = new FakeClient();
    render(
      <Root
        client={client}
        i18n={i18n}
        colorOf={noColor}
        menuOptions={noMenu}
        engineLang="klingon"
      />,
    );
    await tick();
    expect(i18n.language).toBe('zh');
  });
});
