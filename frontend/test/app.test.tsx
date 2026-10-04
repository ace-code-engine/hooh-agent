/**
 * 界面层测试 —— 用**假引擎**喂事件把界面跑起来。
 *
 * 为什么不去起真的 Python：那样测的是"引擎能不能跑"，而这里要测的是
 * "界面拿到事件之后画得对不对"。分开之后，界面测试是毫秒级、可穷举的，
 * 不需要模型、不需要 API key，CI 上也不会因为引擎慢而抖。
 *
 * 引擎那一侧由 Python 的 `test_all.py [69]` 负责（真子进程、真往返）。
 *
 * ## 迁移记录（S5，换内核）
 * `ink-testing-library` → `./mount.js`（内核 `renderSync` + 假 stdio，见该文件头：
 * 假 stdout 必须 `isTTY = false` 才会写**整屏**，且宽度仍是 100 列，与老工具一致）。
 * 断言一字未改，`await tick()` 保留。两处 `\u001b`（Esc）多等了一拍：新内核把**孤立 ESC**
 * 当"可能是 Alt+键 的前缀"，要 50ms 才吐出来（`components/app.js` 的 `NORMAL_TIMEOUT`），
 * 老 ink 5 是立刻的 —— 这是**按键解析时序**的差异，不是"Esc 不生效"。
 * ✅ 复查（同日）：`src/**` 已整体换到内核（`from 'ink'` 清零），本文件随全量测试转绿。
 */

import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.js';
import { I18n } from '../src/i18n.js';
import type { AceEvent, ConfigData, HomeData } from '../src/protocol/types.js';
import { FakeClient, tick } from './fake-engine.js';
import { mountTree } from './mount.js';

/**
 * 假引擎在 `./fake-engine.ts` —— 与 `tools/preview.ts` 共用一份。
 * 两份的话，preview 看到的东西会慢慢与测试里跑的东西不是一回事，
 * 而 preview 存在的意义恰恰是"让人看到界面真的长什么样"。
 */
const i18n = new I18n('zh');
const noColor = (): string | undefined => undefined;

/**
 * 挂载 App 并**等一拍**再返回。
 *
 * 那个 `await tick()` 不是保险起见：`render()` 返回时 Ink 还没把输入监听挂上，
 * 紧接着 `stdin.write` 的按键会直接落空（症状是"界面在、但打不进字"）。
 * 让它成为 setup 的一部分，而不是每个用例各自记得加 —— 这是最容易漏、又最难查的一类。
 */
async function setup(init: { config?: ConfigData; home?: HomeData } = {}) {
  const client = new FakeClient();
  // **必须在挂载前**把假数据摆好：App 挂载时就去拉 config / home，
  // 挂载后再设的话它已经拿到默认值了（踩过：横幅一直显示空配置）。
  if (init.config) client.config = init.config;
  if (init.home) client.home = init.home;
  const tree = mountTree(<App client={client} t={(k, p) => i18n.t(k, p)} colorOf={noColor} />);
  await tick();
  return { client, ...tree };
}

describe('转写区渲染', () => {
  it('用户消息与最终回复都上屏', async () => {
    const { client, lastFrame, unmount } = await setup();
    client.push({ type: 'user_message', ts: 1, text: '你好' });
    client.push({ type: 'final', ts: 2, text: '你也好' });
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('你好');
    expect(frame).toContain('你也好');
    unmount();
  });

  it('工具卡片带状态字形与工具名', async () => {
    const { client, lastFrame, unmount } = await setup();
    client.push({ type: 'tool_start', ts: 1, tool: 'file_write', target: 'note.md' });
    await tick();
    expect(lastFrame() ?? '').toContain('file_write');
    expect(lastFrame() ?? '').toContain('note.md');

    client.push({
      type: 'tool_result',
      ts: 2,
      tool: 'file_write',
      status: 'SUCCESS',
      elapsed: 0.4,
      message: '',
    });
    await tick();
    expect(lastFrame() ?? '').toContain('✓');
    unmount();
  });

  it('状态行显示权限档与模型', async () => {
    const { client, lastFrame, unmount } = await setup();
    client.push({
      type: 'session_start',
      ts: 1,
      version: '3.41.0',
      permission: 'readonly',
      sandbox: 'off',
      project_root: '/proj',
      model: 'deepseek-v4-flash',
    });
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('readonly');
    expect(frame).toContain('deepseek-v4-flash');
    unmount();
  });
});

describe('授权对话框', () => {
  it('有审批请求时弹框，三个选项都在', async () => {
    const { client, lastFrame, unmount } = await setup();
    client.push({ type: 'permission_request', ts: 1, tool: 'file_write', reason: '需要写权限' });
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('file_write');
    expect(frame).toContain('1.');
    expect(frame).toContain('2.');
    expect(frame).toContain('3.');
    unmount();
  });

  it('按 1 → 递上 once', async () => {
    const { client, stdin, unmount } = await setup();
    client.push({ type: 'permission_request', ts: 1, tool: 'file_write', reason: 'r' });
    await tick();
    stdin.write('1');
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerPermission', args: ['once', undefined] });
    unmount();
  });

  it('按 2 → 递上 session', async () => {
    const { client, stdin, unmount } = await setup();
    client.push({ type: 'permission_request', ts: 1, tool: 'file_write', reason: 'r' });
    await tick();
    stdin.write('2');
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerPermission', args: ['session', undefined] });
    unmount();
  });

  it('按 Esc → 递上 deny（Esc 即拒绝，与全局口径一致）', async () => {
    const { client, stdin, unmount } = await setup();
    client.push({ type: 'permission_request', ts: 1, tool: 'file_write', reason: 'r' });
    await tick();
    stdin.write('\u001b'); // ESC
    // 孤立 ESC 在新内核里是"可能是 Alt+键 的前缀"，要等 50ms 超时才当 Esc 吐出来
    await tick();
    await tick();
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerPermission', args: ['deny', undefined] });
    unmount();
  });

  it('按 3 → 递上 deny', async () => {
    const { client, stdin, unmount } = await setup();
    client.push({ type: 'permission_request', ts: 1, tool: 'file_write', reason: 'r' });
    await tick();
    stdin.write('3');
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerPermission', args: ['deny', undefined] });
    unmount();
  });

  it('答完框就消失', async () => {
    const { client, stdin, lastFrame, unmount } = await setup();
    client.push({ type: 'permission_request', ts: 1, tool: 'file_write', reason: 'r' });
    await tick();
    expect(lastFrame() ?? '').toContain('1.');
    stdin.write('1');
    await tick();
    expect(lastFrame() ?? '').not.toContain('1. ');
    unmount();
  });
});

describe('输入通道选择', () => {
  it('`/` 开头走 command.exec，其余走 user.message', async () => {
    const { client, stdin, unmount } = await setup();
    stdin.write('/model');
    await tick();
    stdin.write('\r');
    await tick();
    expect(client.calls.some((c) => c.method === 'command' && c.args[0] === '/model')).toBe(true);

    stdin.write('帮我看下');
    await tick();
    stdin.write('\r');
    await tick();
    expect(client.calls.some((c) => c.method === 'send' && c.args[0] === '帮我看下')).toBe(true);
    unmount();
  });
});

describe('健壮性', () => {
  it('引擎报错时把错误显示出来，而不是静默不动', async () => {
    const client = new FakeClient();
    client.send = vi.fn(async () => {
      throw Object.assign(new Error('引擎忙'), { code: 'E_BUSY' });
    });
    const { stdin, lastFrame, unmount } = mountTree(
      <App client={client} t={(k, p) => i18n.t(k, p)} colorOf={noColor} />,
    );
    await tick(); // 等 Ink 挂上输入监听（见 setup 的说明）
    stdin.write('hello');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toContain('引擎忙');
    unmount();
  });

  it('不认识的事件不把界面打崩', async () => {
    const { client, lastFrame, unmount } = await setup();
    client.push({ type: '某个未来事件', ts: 1, payload: { x: 1 } });
    await tick();
    expect(lastFrame()).toBeTruthy();
    unmount();
  });
});

describe('首屏横幅', () => {
  const CFG: ConfigData = {
    version: '3.41.0',
    model: 'deepseek-v4-flash',
    permission: 'readonly',
    folder: 'ace',
  };

  it('渲染 logo（块状图）+ 产品名与版本', async () => {
    const { lastFrame, unmount } = await setup({ config: CFG });
    const frame = lastFrame() ?? '';
    // logo 是块状字符（█ ╔ ═ 这些），画出来才有"品牌感"
    expect(frame).toContain('█');
    expect(frame).toContain('HooH · 互');
    expect(frame).toContain('v3.41.0');
    unmount();
  });

  it('右栏跟着给出「环境」与「位置」：模型 · 权限 / 目录', async () => {
    const { lastFrame, unmount } = await setup({ config: CFG });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('deepseek-v4-flash');
    expect(frame).toContain('readonly');
    expect(frame).toContain('ace');
    unmount();
  });

  it('**发了第一条消息之后横幅就不在了**（它是开场，不是常驻头部）', async () => {
    const { client, lastFrame, unmount } = await setup({ config: CFG });
    expect(lastFrame() ?? '').toContain('HooH · 互');

    client.push({ type: 'user_message', ts: 1, text: '你好' });
    await tick();
    expect(lastFrame() ?? '').not.toContain('HooH · 互');
    unmount();
  });

  it('右栏缺值时不留空行（版本/模型都没有也不崩）', async () => {
    const { lastFrame, unmount } = await setup({ config: {} });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('█'); // logo 还在
    expect(frame).toContain('HooH · 互');
    unmount();
  });

  it('身份与环境**只出现一次**（横幅与主页别重复说同一件事）', async () => {
    const { lastFrame, unmount } = await setup({ config: CFG });
    const frame = lastFrame() ?? '';
    expect(frame.split('readonly').length - 1).toBe(1);
    unmount();
  });
});

describe('主页', () => {
  it('没有消息时渲染主页（分区标题 + 条目）', async () => {
    const { client, lastFrame, unmount } = await setup();
    const frame = lastFrame() ?? '';
    expect(client.calls.some((c) => c.method === 'requestHome')).toBe(true);
    expect(frame).toContain(i18n.t('home_sec_resume')); // 分区标题
    expect(frame).toContain(i18n.t('home_resume_last')); // 条目
    // 身份与环境归横幅，主页不该再打一遍（见 Home.tsx 顶部说明）。
    // 钉版本号而不是品牌串：品牌串里含 "HooH"，而块状 logo 画的就是这两个词，
    // 拿它做断言会永远命中 logo 本身 —— 旧写法（'ACE 3.41.0'）同理，只是当时运气好。
    expect(frame).not.toContain('v3.41.0');
    unmount();
  });

  it('**条目文案里的占位符被真的替换掉**（`{when}` 这类不该原样上屏）', async () => {
    const { lastFrame, unmount } = await setup({
      home: {
        title: {},
        sections: [
          {
            key: 'resume',
            title_key: 'home_sec_resume',
            items: [
              {
                action: 'resume_last',
                label_key: 'home_resume_last',
                value: '',
                hint_key: '',
                enabled: true,
                fmt: { when: '昨天', turns: 3 },
              },
            ],
          },
        ],
      },
    });
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('{when}');
    expect(frame).not.toContain('{turns}');
    expect(frame).toContain('昨天');
    unmount();
  });

  it('**有消息之后主页就不再渲染**（它是开场，不是常驻仪表盘）', async () => {
    const { client, lastFrame, unmount } = await setup();
    await tick();
    expect(lastFrame() ?? '').toContain(i18n.t('home_sec_resume'));

    client.push({ type: 'user_message', ts: 1, text: '你好' });
    await tick();
    expect(lastFrame() ?? '').not.toContain(i18n.t('home_sec_resume'));
    unmount();
  });

  it('主页取不到时不显示空壳，也不崩', async () => {
    const client = new FakeClient();
    client.requestHome = async () => {
      throw Object.assign(new Error('取不到'), { code: 'E_INTERNAL' });
    };
    const { lastFrame, unmount } = mountTree(
      <App client={client} t={(k, p) => i18n.t(k, p)} colorOf={noColor} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    // 既没有分区标题（不是空壳），也没有崩（还能渲染出输入行）
    expect(frame).not.toContain(i18n.t('home_sec_resume'));
    expect(frame).toContain('❯');
    unmount();
  });
});

describe('选择对话框', () => {
  const chooseReq = (kind: string, extra: Record<string, unknown> = {}): AceEvent => ({
    type: 'choice_request',
    ts: 1,
    kind,
    title: '选一个',
    ...extra,
  });

  it('choose：列出候选，回车把选中项递回去', async () => {
    const { client, stdin, lastFrame, unmount } = await setup();
    client.push(chooseReq('choose', { options: ['deepseek', 'qwen', 'zhipu'] }));
    await tick();
    expect(lastFrame() ?? '').toContain('deepseek');
    stdin.write('\r');
    await tick();
    expect(client.calls).toContainEqual({
      method: 'answerChoice',
      args: [{ values: ['deepseek'] }],
    });
    unmount();
  });

  it('choose：↓ 之后回车递的是第二项', async () => {
    const { client, stdin, unmount } = await setup();
    client.push(chooseReq('choose', { options: ['甲', '乙', '丙'] }));
    await tick();
    stdin.write('\u001b[B'); // ↓
    await tick();
    stdin.write('\r');
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerChoice', args: [{ values: ['乙'] }] });
    unmount();
  });

  it('choose：输入即筛选', async () => {
    const { client, stdin, lastFrame, unmount } = await setup();
    client.push(chooseReq('choose', { options: ['deepseek', 'qwen'] }));
    await tick();
    stdin.write('qwen');
    await tick();
    expect(lastFrame() ?? '').toContain('qwen');
    stdin.write('\r');
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerChoice', args: [{ values: ['qwen'] }] });
    unmount();
  });

  it('confirm：y 是同意', async () => {
    const { client, stdin, unmount } = await setup();
    client.push(chooseReq('confirm'));
    await tick();
    stdin.write('y');
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerChoice', args: [{ accepted: true }] });
    unmount();
  });

  it('confirm：**回车是"否"**（默认否，关掉/超时都不等于同意）', async () => {
    const { client, stdin, unmount } = await setup();
    client.push(chooseReq('confirm'));
    await tick();
    stdin.write('\r');
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerChoice', args: [{ accepted: false }] });
    unmount();
  });

  it('text：输入后回车把文本递回去', async () => {
    const { client, stdin, unmount } = await setup();
    client.push(chooseReq('text', { default: '' }));
    await tick();
    stdin.write('理由');
    await tick();
    stdin.write('\r');
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerChoice', args: [{ text: '理由' }] });
    unmount();
  });

  it('text：预填值可用', async () => {
    const { client, stdin, lastFrame, unmount } = await setup();
    client.push(chooseReq('text', { default: '预填内容' }));
    await tick();
    expect(lastFrame() ?? '').toContain('预填内容');
    stdin.write('\r');
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerChoice', args: [{ text: '预填内容' }] });
    unmount();
  });

  it('Esc → 取消（不是递一个空答案上去）', async () => {
    const { client, stdin, unmount } = await setup();
    client.push(chooseReq('choose', { options: ['甲'] }));
    await tick();
    stdin.write('\u001b');
    await tick();
    await tick();
    await tick();
    expect(client.calls).toContainEqual({ method: 'answerChoice', args: [{ cancelled: true }] });
    unmount();
  });

  it('答完框就消失', async () => {
    const { client, stdin, lastFrame, unmount } = await setup();
    client.push(chooseReq('choose', { options: ['甲', '乙'] }));
    await tick();
    expect(lastFrame() ?? '').toContain('甲');
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').not.toContain('❯ 甲');
    unmount();
  });
});
