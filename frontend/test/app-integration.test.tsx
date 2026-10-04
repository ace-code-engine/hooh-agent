/**
 * App 的**接线**测试 —— 四件新界面 + 键位注册表。
 *
 * 只测"接上了没有"：每件组件自身的行为（窗口、多选、写通道、编辑键…）已经在
 * `pickers / settings-panel / session-tree-ui / draft-editor` 各自的文件里覆盖过，
 * 这里重复一遍只会让两组断言将来各漂各的。这里盯的是**接线本身**：
 *
 *   1. 入口（既有命令 `/tree` `/config` `/resume` `/permission`、键位 `Ctrl+G`）真的打开了对应的屏；
 *   2. 出口（`Esc` / `Ctrl+S`）真的关得掉，且**关掉之后主界面状态没丢**；
 *   3. 键位匹配**走注册表**（改覆盖层能改行为，App 里没有写死 `'t'`）；
 *   4. 老引擎（没有 `request()`）走**明确的失败态**：不崩、不空白。
 *
 * 帧一律出 `mountTree()`（组件挂 `useInput`，没有内核的 `StdinContext` 会当场抛）。
 * 文案断言一律用 `i18n.t(键)` **算出来**，不手抄译文 —— 语言波补字典时这些断言不会假红。
 */

import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../src/App.js';
import { I18n } from '../src/i18n.js';
import { resetKeyOverrides, setKeyOverrides } from '../src/keys/registry.js';
import type { ConfigData, SessionsData } from '../src/protocol/types.js';
import { FakeClient, tick } from './fake-engine.js';
import { mountTree, type MountedTree } from './mount.js';

const i18n = new I18n('zh');
const noColor = (): string | undefined => undefined;
const T = (k: string, p?: Record<string, string | number>): string => i18n.t(k, p);

/** `sessiontree.request` 的夹具（形状逐条对 `.recon/Q1-protocol.md` §3.7b）。 */
const TREE = {
  session_id: '20261004-1930',
  nodes: [
    { seq: 12, kind: 'user/message', parent: 0, tip: false, turn: 1, preview: '先看缓存那层', active: false },
    { seq: 18, kind: 'assistant/message', parent: 12, tip: false, turn: 1, preview: '问题在 TTL', active: false },
    { seq: 24, kind: 'user/message', parent: 18, tip: true, turn: 2, preview: '改成滑动窗口', active: true },
  ],
  active_head: 24,
  tips: [24],
  single: true,
  parent_session: '',
};

/** `settings.request` 的夹具（形状逐条对 `ai_code.py` 的 `_settings_payload`）。 */
const SETTINGS = {
  sections: [
    {
      id: 'security',
      label_key: 'set_sec',
      items: [
        {
          key: 'net',
          type: 'enum',
          scope: 'global',
          label_key: 'set_net',
          current: 'off',
          default: 'on',
          enum: [
            ['on', 'arg_on'],
            ['off', 'arg_off'],
          ],
          write_cmd: '/net {value}',
          secret: false,
          hot: true,
        },
      ],
    },
  ],
};

/** `config.request.option_sets` 的夹具（引擎逐字来自 `ui/ace_menu.ARGUMENT_HINTS`）。 */
const OPTION_SETS: ConfigData = {
  vim: false,
  lang: 'zh',
  permission: 'readonly',
  option_sets: {
    permission: [
      ['readonly', 'arg_perm_readonly'],
      ['write', 'arg_perm_write'],
    ],
    sandbox: [
      ['off', 'arg_sandbox_off'],
      ['job', 'arg_sandbox_job'],
    ],
    net: [
      ['on', 'arg_net_on'],
      ['off', 'arg_net_off'],
    ],
    effort: [
      ['auto', 'effort_auto'],
      ['high', 'effort_high'],
    ],
  },
};

/** 会话行带 §3.7a 的新字段（老引擎不发；调用方必须容得下）。 */
const SESSIONS = {
  sessions: [
    { path: '/x/20261004.jsonl', when: '昨天 19:30', turns: 12, label: '缓存穿透那次', id: '20261004-1930', bytes: 481203 },
    { path: '/x/20261003.jsonl', when: '前天 09:10', turns: 3, label: '重构执行层', id: '20261003-0910' },
  ],
} as unknown as SessionsData;

/**
 * 假引擎的**超集**：补上新协议面的 `request()`。
 *
 * 真 `AceClient` 从第一天就有它，`FakeClient` 刻意没有 —— 所以本文件既用它测正常路径，
 * 也用**本体**（没有 `request`）测老引擎的失败路径：两条都要能走。
 */
class PanelClient extends FakeClient {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  replies: Record<string, unknown> = {
    'sessiontree.request': TREE,
    'settings.request': SETTINGS,
  };

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.requests.push({ method, params });
    if (!Object.prototype.hasOwnProperty.call(this.replies, method)) {
      throw new Error(`no fixture for ${method}`);
    }
    return this.replies[method];
  }
}

async function setup(config?: ConfigData) {
  const client = new PanelClient();
  client.sessions = SESSIONS;
  if (config) client.config = config;
  const tree = mountTree(<App client={client} t={T} colorOf={noColor} />);
  await tick(); // 等 Ink 把输入监听挂上（见 app.test.tsx 的 setup 说明）
  return { client, ...tree };
}

/** 在输入行敲一条命令并回车（等价于人手动输入）。 */
async function submit(tree: MountedTree, line: string): Promise<void> {
  tree.stdin.write(line);
  await tick();
  tree.stdin.write('\r');
  await tick();
  await tick();
}

/** 孤立 ESC 在内核里是"Alt 前缀"，要等超时才吐出来（50ms）—— 多让两拍。 */
async function pressEsc(tree: MountedTree): Promise<void> {
  tree.stdin.write('\u001b');
  await tick();
  await tick();
  await tick();
}

const frame = (tree: MountedTree): string => tree.lastFrame() ?? '';

afterEach(() => resetKeyOverrides());

describe('会话树：`/tree`', () => {
  it('打开 → 帧里有树的节点与活跃头；Esc 关掉 → 转录那句还在', async () => {
    const { client, ...tree } = await setup();
    client.push({ type: 'user_message', ts: 1, text: '先看缓存那层' });
    client.push({ type: 'final', ts: 2, text: '看完了' });
    await tick();

    await submit(tree, '/tree');
    expect(client.requests.map((r) => r.method)).toContain('sessiontree.request');
    const opened = frame(tree);
    expect(opened).toContain('改成滑动窗口'); // 夹具摘要 = 面板真的拿到了数据
    expect(opened).toContain(i18n.t('stree_title'));

    await pressEsc(tree);
    const closed = frame(tree);
    expect(closed).not.toContain('改成滑动窗口'); // 面板关了
    expect(closed).toContain('看完了'); // ← 主界面状态没丢
    expect(closed).toContain('❯'); // 输入行回来了
    tree.unmount();
  });

  it('回车切分支：发引擎既有的 `/tree <编号>`，并**重取**一次', async () => {
    const { client, ...tree } = await setup();
    await submit(tree, '/tree');
    const before = client.requests.length;
    tree.stdin.write('\r');
    await tick();
    await tick();
    expect(client.calls.some((c) => c.method === 'command' && c.args[0] === '/tree 1')).toBe(true);
    expect(client.requests.length).toBeGreaterThan(before); // 有回报 = 重取
    tree.unmount();
  });
});

describe('设置面板：`/config`', () => {
  it('打开 → 帧里是引擎发的设置项；Esc 关掉 → 转录还在', async () => {
    const { client, ...tree } = await setup();
    client.push({ type: 'user_message', ts: 1, text: '你好' });
    client.push({ type: 'final', ts: 2, text: '你也好' });
    await tick();

    await submit(tree, '/config');
    expect(client.requests.map((r) => r.method)).toContain('settings.request');
    const opened = frame(tree);
    expect(opened).toContain(i18n.t('set_net')); // 引擎发的 label_key
    expect(opened).toContain(i18n.t('arg_off')); // 引擎发的当前值文案

    await pressEsc(tree);
    const closed = frame(tree);
    expect(closed).not.toContain(i18n.t('set_net'));
    expect(closed).toContain('你也好');
    tree.unmount();
  });
});

describe('选择器：`/resume` 与闭集命令', () => {
  it('`/resume` → 候选是 sessions.request 那份；回车发出 `/resume <编号>`', async () => {
    const { client, ...tree } = await setup();
    await submit(tree, '/resume');
    const opened = frame(tree);
    expect(opened).toContain('缓存穿透那次');
    expect(opened).toContain(i18n.t('sessions_pick'));

    tree.stdin.write('\u001b[B'); // ↓ 到第二条
    await tick();
    tree.stdin.write('\r');
    await tick();
    await tick();
    expect(client.calls.some((c) => c.method === 'command' && c.args[0] === '/resume 2')).toBe(true);
    expect(frame(tree)).not.toContain('重构执行层'); // 面板关掉了
    tree.unmount();
  });

  it('`/permission` → 候选来自 `option_sets`；回车发出 `/permission <值>`', async () => {
    const { client, ...tree } = await setup(OPTION_SETS);
    await submit(tree, '/permission');
    const opened = frame(tree);
    expect(opened).toContain(i18n.t('arg_perm_write'));

    tree.stdin.write('\u001b[B'); // ↓ 到第二项（write）
    await tick();
    tree.stdin.write('\r');
    await tick();
    await tick();
    expect(client.calls.some((c) => c.method === 'command' && c.args[0] === '/permission write')).toBe(true);
    tree.unmount();
  });

  it('老引擎没有 `option_sets` → **不装样子**，命令照旧发给引擎', async () => {
    const { client, ...tree } = await setup({ vim: false, lang: 'zh' });
    await submit(tree, '/permission');
    expect(frame(tree)).not.toContain(i18n.t('arg_perm_write'));
    expect(client.calls.some((c) => c.method === 'command' && c.args[0] === '/permission')).toBe(true);
    tree.unmount();
  });
});

describe('全屏草稿编辑器：`Ctrl+G`（注册表的 `external_editor`）', () => {
  it('打开 → 打字 → `Ctrl+S` 采纳：走和输入行回车同一条提交路径', async () => {
    const { client, ...tree } = await setup();
    tree.stdin.write('\x07'); // Ctrl+G
    await tick();
    expect(frame(tree)).toContain(i18n.t('draft_editor_title'));

    tree.stdin.write('hello');
    await tick();
    expect(frame(tree)).toContain('hello');

    tree.stdin.write('\x13'); // Ctrl+S = 采纳
    await tick();
    await tick();
    expect(client.calls.some((c) => c.method === 'send' && c.args[0] === 'hello')).toBe(true);
    expect(frame(tree)).not.toContain(i18n.t('draft_editor_title'));
    tree.unmount();
  });

  it('`Esc` 取消：一个字节都不发出去', async () => {
    const { client, ...tree } = await setup();
    tree.stdin.write('\x07');
    await tick();
    tree.stdin.write('丢掉这段');
    await tick();
    await pressEsc(tree);
    expect(frame(tree)).not.toContain(i18n.t('draft_editor_title'));
    expect(client.calls.some((c) => c.method === 'send' || c.method === 'command')).toBe(false);
    tree.unmount();
  });

  // ↓ 无损往返三条：输入行的草稿**带进去** / 取消**放回来** / 采纳走同一条提交路径。
  // 面板是整屏换掉主界面的（`Input` 会卸载重挂），所以这三条钉的是 App 手上那份副本。

  it('输入行里有半截草稿时打开 → 那段内容**带进**编辑器（不是白纸起手）', async () => {
    const { ...tree } = await setup();
    tree.stdin.write('先看缓存那层');
    await tick();
    expect(frame(tree)).toContain('先看缓存那层'); // 先确认它确实在输入行里

    tree.stdin.write('\x07'); // Ctrl+G
    await tick();
    const opened = frame(tree);
    expect(opened).toContain(i18n.t('draft_editor_title')); // 编辑器真的开了
    expect(opened).toContain('先看缓存那层'); // ← 草稿跟着进来了
    tree.unmount();
  });

  it('`Esc` 取消：输入行回到**原样**（编辑器里改的那些字不留，原件一个字节不丢）', async () => {
    const { ...tree } = await setup();
    tree.stdin.write('未提交的草稿');
    await tick();
    tree.stdin.write('\x07');
    await tick();
    tree.stdin.write('XYZ'); // 在编辑器里改了
    await tick();
    expect(frame(tree)).toContain('未提交的草稿XYZ'); // 改动确实生效了

    await pressEsc(tree);
    const closed = frame(tree);
    expect(closed).not.toContain(i18n.t('draft_editor_title'));
    expect(closed).toContain('未提交的草稿'); // ← 回填
    expect(closed).not.toContain('未提交的草稿XYZ'); // 取消 = 丢弃本次改动
    tree.unmount();
  });

  it('`Ctrl+S` 采纳：编辑后的**全文**走输入行回车同一条路径（发送一次），采纳完不残留', async () => {
    const { client, ...tree } = await setup();
    tree.stdin.write('底稿');
    await tick();
    tree.stdin.write('\x07');
    await tick();
    tree.stdin.write('X');
    await tick();

    tree.stdin.write('\x13'); // Ctrl+S
    await tick();
    await tick();
    const sends = client.calls.filter((c) => c.method === 'send');
    expect(sends.map((c) => c.args[0])).toEqual(['底稿X']);
    expect(frame(tree)).not.toContain(i18n.t('draft_editor_title'));

    // 输入行已清空（与回车提交同口径）：再按一次回车不该发出第二遍。
    tree.stdin.write('\r');
    await tick();
    await tick();
    expect(client.calls.filter((c) => c.method === 'send')).toHaveLength(1);
    tree.unmount();
  });

  it('`Ctrl+S` 采纳一个**空**草稿：什么都不发，原草稿原样留在输入行', async () => {
    const { client, ...tree } = await setup();
    tree.stdin.write('真草稿');
    await tick();
    tree.stdin.write('\x07');
    await tick();
    tree.stdin.write('\x15'); // Ctrl+U：把编辑器里的内容清空
    await tick();
    tree.stdin.write('\x13'); // Ctrl+S
    await tick();
    await tick();

    expect(client.calls.some((c) => c.method === 'send' || c.method === 'command')).toBe(false);
    const f = frame(tree);
    expect(f).not.toContain(i18n.t('draft_editor_title'));
    expect(f).toContain('真草稿'); // 没采纳成 ⇒ 输入行原样，不是丢掉
    tree.unmount();
  });
});

describe('失败态（不崩、不空白）', () => {  it('client 没有 `request()`（老引擎）：`/tree` 退回主界面并写明原因', async () => {
    const client = new FakeClient(); // 本体：没有 request
    const client2 = client as unknown as { sessions: SessionsData };
    client2.sessions = SESSIONS;
    const tree = mountTree(<App client={client} t={T} colorOf={noColor} />);
    await tick();
    await submit(tree, '/tree');
    const out = frame(tree);
    expect(out).toContain('会话树取不到');
    expect(out).toContain('❯'); // 主界面照常，没崩
    tree.unmount();
  });

  it('引擎回了空树：画明确空态，不是空白屏', async () => {
    const { client, ...tree } = await setup();
    client.replies['sessiontree.request'] = { nodes: [], tips: [], active_head: 0, single: true };
    await submit(tree, '/tree');
    expect(frame(tree)).toContain(i18n.t('stree_empty'));
    tree.unmount();
  });

  it('★面板开着时来了审批：**弹框优先**，答完面板自己回来（不让引擎空等）', async () => {
    const { client, ...tree } = await setup();
    await submit(tree, '/config');
    expect(frame(tree)).toContain(i18n.t('set_net'));

    client.push({ type: 'permission_request', ts: 1, tool: 'file_write', reason: '要写盘' });
    await tick();
    const asked = frame(tree);
    expect(asked).toContain('file_write');
    expect(asked).toContain('1.');

    // 按键**补发**到生效为止：内核挂载期在等终端应答，那一拍注入的字节会丢在注入侧
    // （`fullscreen-wiring` 的 `pressUntil` 记过这条环境事实）。判断仍交给 expect。
    for (let i = 0; i < 3 && !client.calls.some((c) => c.method === 'answerPermission'); i++) {
      tree.stdin.write('1'); // 批准
      await tick();
    }
    await tick();
    expect(client.calls.some((c) => c.method === 'answerPermission' && c.args[0] === 'once')).toBe(true);
    expect(frame(tree)).toContain(i18n.t('set_net')); // 面板回来了，数据还在
    tree.unmount();
  });
});

describe('键位注册表是唯一来源', () => {
  it('`Ctrl+T` 打开任务树（`tasks`），再按一次关掉', async () => {
    const { ...tree } = await setup();
    tree.stdin.write('\x14'); // Ctrl+T
    await tick();
    expect(frame(tree)).toContain('目标 [R1/3] 把前端做完');
    tree.stdin.write('\x14');
    await tick();
    expect(frame(tree)).not.toContain('目标 [R1/3] 把前端做完');
    tree.unmount();
  });

  it('**改覆盖层就改行为**：`tasks` 改到 `Ctrl+Y` 后，`Ctrl+T` 不再打开、`Ctrl+Y` 打开', async () => {
    const { ...tree } = await setup();
    const { applied } = setKeyOverrides({ tasks: 'ctrl+y' });
    expect(applied).toEqual(['tasks']);

    tree.stdin.write('\x14'); // 旧键：注册表里已经不再归 tasks
    await tick();
    expect(frame(tree)).not.toContain('目标 [R1/3] 把前端做完');

    tree.stdin.write('\x19'); // Ctrl+Y = 重映射后的键
    await tick();
    expect(frame(tree)).toContain('目标 [R1/3] 把前端做完');
    tree.unmount();
  });

  it('`Ctrl+C` 是保命键：面板开着也认它（关引擎）', async () => {
    const { client, ...tree } = await setup();
    await submit(tree, '/config');
    expect(frame(tree)).toContain(i18n.t('set_net'));
    tree.stdin.write('\x03'); // Ctrl+C
    await tick();
    expect(client.calls.some((c) => c.method === 'shutdown')).toBe(true);
    tree.unmount();
  });
});
