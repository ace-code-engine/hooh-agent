/**
 * 状态 reducer 测试。
 *
 * 事件驱动的界面，错全出在"到达顺序不按预想"上。这些用纯函数就能穷举 ——
 * 塞进组件里就只能靠手点，而手点覆盖不到这些顺序。
 */

import { describe, expect, it } from 'vitest';

import type { AceEvent } from '../src/protocol/types.js';
import {
  applyEvent,
  applyEvents,
  applyPermissionAnswer,
  initialState,
  type Item,
  type State,
} from '../src/state/store.js';

function ev(type: string, fields: Record<string, unknown> = {}): AceEvent {
  return { type, ts: 1, ...fields };
}

function run(...events: AceEvent[]): State {
  return applyEvents(initialState(), events);
}

/** 最后一条 notice —— 类型收窄而不是 `as`，断言失败时给的是"实际是什么"而不是崩溃。 */
function lastNotice(s: State): Extract<Item, { kind: 'notice' }> {
  const last = s.items[s.items.length - 1];
  if (last.kind !== 'notice') throw new Error(`last item is ${last.kind}, not notice`);
  return last;
}

describe('基本流转', () => {
  it('session_start 记下会话信息', () => {
    const s = run(
      ev('session_start', {
        version: '3.41.0',
        permission: 'readonly',
        sandbox: 'off',
        project_root: '/x',
        model: 'm',
      }),
    );
    expect(s.meta.version).toBe('3.41.0');
    expect(s.meta.permission).toBe('readonly');
    expect(s.meta.projectRoot).toBe('/x');
  });

  it('user_message 进转写区并置忙', () => {
    const s = run(ev('user_message', { text: '你好' }));
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'user', text: '你好' });
    expect(s.busy).toBe(true);
  });

  it('**同一句话不出现两遍**（本地乐观播一条 + 引擎真发一条 → 只留一条）', () => {
    const s = run(
      ev('user_message', { text: '你好' }),
      ev('user_message', { text: '你好' }),
    );
    expect(s.items).toHaveLength(1);
    expect(s.busy).toBe(true);
  });

  it('**工具时间线夹在中间时，final 也并回原来那条**（否则整段回答出现两遍）', () => {
    const s = run(
      ev('user_message', { text: '怎么说' }),
      ev('model_delta', { text: '看了你的顶层结构' }),
      ev('model_delta', { text: '，说说真实判断。' }),
      // 工具时间线 / 耗时这类 notice 会插在增量与 final 之间 —— 这是正常顺序
      ev('notice', { text: '⚙  2 次工具调用 · 0.00s · 读取 2 项' }),
      ev('final', { text: '看了你的顶层结构，说说真实判断。' }),
    );
    const assistants = s.items.filter((i) => i.kind === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({
      text: '看了你的顶层结构，说说真实判断。',
      streaming: false,
    });
    expect(s.busy).toBe(false);
  });

  it('**notice 把增量劈开时也不另起一条**（同一段回答被拆成两段是最难查的那种）', () => {
    const s = run(
      ev('user_message', { text: '你好' }),
      ev('model_delta', { text: '前半段' }),
      ev('notice', { text: '⚙  1 次工具调用' }),
      ev('model_delta', { text: '后半段' }),
    );
    const assistants = s.items.filter((i) => i.kind === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ text: '前半段后半段', streaming: true });
  });

  it('**被 FORMAT_ERROR 拒掉的草稿不留**（否则同一个问题看到两遍不同措辞的回答）', () => {
    const s = run(
      ev('user_message', { text: '你好' }),
      ev('model_delta', { text: '第一版回答，措辞是这样。' }),
      ev('notice', { text: '  ✗ FORMAT_ERROR: 格式错误: 缺少 <EXTERNAL> 标签' }),
      ev('model_delta', { text: '第二版回答，措辞不一样。' }),
      ev('final', { text: '第二版回答，措辞不一样。' }),
    );
    const assistants = s.items.filter((i) => i.kind === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ text: '第二版回答，措辞不一样。' });
    // 那条错误本身要留着（用户/维护者得知道发生过格式纠正）
    expect(s.items.some((i) => i.kind === 'notice' && i.text.includes('FORMAT_ERROR'))).toBe(true);
  });

  it('普通 notice（工具时间线）**不误删**已定稿的回答', () => {
    const s = run(
      ev('user_message', { text: '你好' }),
      ev('model_delta', { text: '答' }),
      ev('final', { text: '答' }),
      ev('notice', { text: '⚙  2 次工具调用' }),
    );
    expect(s.items.filter((i) => i.kind === 'assistant')).toHaveLength(1);
  });

  it('不同的两句各自成条（去重只看"紧邻且同文"，不吞正常输入）', () => {
    const s = run(
      ev('user_message', { text: '第一句' }),
      ev('final', { text: '答' }),
      ev('user_message', { text: '第一句' }),
    );
    expect(s.items.filter((i) => i.kind === 'user')).toHaveLength(2);
  });

  it('final 收尾并解除忙', () => {
    const s = run(ev('final', { text: '答', round: 1 }));
    expect(s.items[0]).toMatchObject({ kind: 'assistant', text: '答', streaming: false });
    expect(s.busy).toBe(false);
  });

  it('**空 final 只收尾、不产生气泡**（一轮以失败/中断结束时引擎发的那条）', () => {
    const s = run(ev('user_message', { text: '你好' }), ev('final', { text: '', aborted: true }));
    expect(s.busy).toBe(false);
    // 转写区里只有用户那句话：空回复不该多出一个空气泡
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'user' });
  });

  it('model_request 把相位拉回 reasoning（否则工具跑完后标签一直写着"工具执行中"）', () => {
    const s = run(
      ev('user_message', { text: '你好' }),
      ev('tool_start', { tool: 'grep', ts: 2 }),
      ev('model_request', { round: 2, ts: 3 }),
    );
    expect(s.meta.phase).toBe('reasoning');
    expect(s.busy).toBe(true);
  });
});

describe('流式增量', () => {
  it('model_delta 追加到同一条还在流的助手消息上', () => {
    const s = run(
      ev('model_delta', { text: '你' }),
      ev('model_delta', { text: '好' }),
      ev('model_delta', { text: '。' }),
    );
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'assistant', text: '你好。', streaming: true });
  });

  it('**final 不重复追加**（流式渲染最经典的坑：回答出现两遍）', () => {
    const s = run(
      ev('model_delta', { text: '你好。' }),
      ev('final', { text: '你好。' }),
    );
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'assistant', text: '你好。', streaming: false });
  });

  it('final 比流式内容更完整时以 final 为准', () => {
    const s = run(ev('model_delta', { text: '你' }), ev('final', { text: '你好，世界。' }));
    expect(s.items[0]).toMatchObject({ text: '你好，世界。' });
  });

  it('没有流式时 final 自己开一条', () => {
    const s = run(ev('final', { text: '直接答' }));
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'assistant', streaming: false });
  });
});

describe('工具卡片', () => {
  it('tool_start 开一张"在跑"的卡，tool_result 把它收掉', () => {
    const s = run(
      ev('tool_start', { tool: 'file_write', target: 'a.txt' }),
      ev('tool_result', { tool: 'file_write', status: 'SUCCESS', elapsed: 0.3, message: 'ok' }),
    );
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({
      kind: 'tool',
      tool: 'file_write',
      target: 'a.txt',
      status: 'ok',
      elapsed: 0.3,
    });
    expect(s.meta.tools).toBe(1);
  });

  it('失败状态映射成 fail', () => {
    const s = run(
      ev('tool_start', { tool: 'terminal_exec' }),
      ev('tool_result', { tool: 'terminal_exec', status: '403', elapsed: 0.1, message: '拒' }),
    );
    expect(s.items[0]).toMatchObject({ status: 'fail' });
  });

  it('只有 tool_result（没收到 tool_start）时也补一张卡 —— 宁可多一张，别丢结果', () => {
    const s = run(ev('tool_result', { tool: 'file_read', status: 'SUCCESS', elapsed: 0.1 }));
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'tool', tool: 'file_read', status: 'ok' });
  });

  it('同一个工具连着跑两次：分别配对自己的卡', () => {
    const s = run(
      ev('tool_start', { tool: 'file_read', target: '1' }),
      ev('tool_result', { tool: 'file_read', status: 'SUCCESS', elapsed: 0.1 }),
      ev('tool_start', { tool: 'file_read', target: '2' }),
      ev('tool_result', { tool: 'file_read', status: '404', elapsed: 0.2 }),
    );
    expect(s.items).toHaveLength(2);
    expect(s.items[0]).toMatchObject({ target: '1', status: 'ok' });
    expect(s.items[1]).toMatchObject({ target: '2', status: 'fail' });
  });
});

describe('审批', () => {
  it('permission_request 置起待答状态（界面据此弹框）', () => {
    const s = run(ev('permission_request', { tool: 'file_write', reason: '需要写权限' }));
    expect(s.pendingPermission).toMatchObject({ tool: 'file_write', reason: '需要写权限' });
  });

  it('答完之后待答清掉，转写区留下"当时怎么答的"', () => {
    let s = run(ev('permission_request', { tool: 'file_write', reason: 'r' }));
    s = applyPermissionAnswer(s, 'once');
    expect(s.pendingPermission).toBeNull();
    const item = s.items.find((i) => i.kind === 'permission');
    expect(item).toMatchObject({ answered: 'once' });
  });

  it('没有待答时给答案不会崩，也不产生副作用', () => {
    const s = applyPermissionAnswer(initialState(), 'deny');
    expect(s.items).toHaveLength(0);
    expect(s.pendingPermission).toBeNull();
  });
});

describe('健壮性', () => {
  it('不认识的事件类型被忽略（协议会加新事件，旧前端不该崩）', () => {
    const s = run(ev('未来的新事件', { x: 1 }));
    expect(s.items).toHaveLength(0);
  });

  it('缺字段的事件不崩（拿不到就是空串 / undefined）', () => {
    const s = run(ev('tool_result', {}));
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'tool', tool: '' });
  });

  it('空 notice 不产生条目（引擎会 print 空行）', () => {
    expect(run(ev('notice', { text: '   ' })).items).toHaveLength(0);
  });

  it('**不修改入参**（React 靠引用比较决定重渲染）', () => {
    const before = initialState();
    const snapshot = JSON.stringify(before);
    applyEvent(before, ev('user_message', { text: 'x' }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('session_end 记下轮数与工具数', () => {
    const s = run(ev('session_end', { rounds: 3, tools: 5, elapsed: 1 }));
    expect(s.meta.ended).toBe(true);
    expect(s.meta.rounds).toBe(3);
    expect(s.meta.tools).toBe(5);
  });
});

describe('status 事件（底栏分段）', () => {
  it('分段被解析成结构化行 —— 不是 stringify 成 "[object Object]"', () => {
    // 这条有前身：`statusSegments` 早先被声明成 `string[]` 并 `map(str)`，
    // 而引擎从来没发过这个事件，所以没人发现那个形状是错的。现在它真的会来。
    const s = run(ev('status', {
      segments: [
        { name: 'model', text: ' mock ', priority: 10, level: 'info' },
        { name: 'context', text: ' 上下文 92% ', priority: 20, level: 'warn' },
      ],
    }));
    expect(s.meta.statusSegments).toHaveLength(2);
    expect(s.meta.statusSegments[1]).toMatchObject({
      name: 'context', text: ' 上下文 92% ', priority: 20, level: 'warn',
    });
  });

  it('数组里的坏行逐条丢掉，其余照收（缺 text / 不是对象）', () => {
    const s = run(ev('status', {
      segments: [null, 42, { name: 'x' }, { name: 'ok', text: ' t ' }],
    }));
    expect(s.meta.statusSegments).toHaveLength(1);
    expect(s.meta.statusSegments[0]).toMatchObject({ name: 'ok', text: ' t ', priority: 50 });
  });

  it('整个 payload 不是数组 = 这一帧坏了：保持上一份，不把底栏抹成空', () => {
    const s = run(
      ev('status', { segments: [{ name: 'model', text: ' mock ', priority: 10 }] }),
      ev('status', { segments: '不是数组' }),
    );
    expect(s.meta.statusSegments).toHaveLength(1);
    expect(s.meta.statusSegments[0].name).toBe('model');
  });
});

describe('agent_preset 事件（WP-6）', () => {
  it('切换落到一条 notice：写名字 + 比全局更严的维度', () => {
    // 为什么这条值得钉：引擎侧的事件类型一直都在，`emit_switch()` 却**没有调用方**，
    // 所以它从来没到过前端 —— `/preset` 补上入口之后才真的会来。
    const s = run(ev('agent_preset', {
      name: 'audit', previous: '', permission: { bash: 'deny' }, changed: ['bash'],
    }));
    const last = lastNotice(s);
    expect(last.text).toContain('audit');
    expect(last.text).toContain('bash');
  });

  it('name 为空串 = 切回无预设（事件契约里的另一个意思，不是"没变化"）', () => {
    const s = run(ev('agent_preset', { name: '', previous: 'audit', changed: [] }));
    expect(lastNotice(s).text).toBe('agent: (none)');
  });

  it('changed 缺失/坏形状不崩（老引擎或半截帧）', () => {
    const s = run(
      ev('agent_preset', { name: 'x' }),
      ev('agent_preset', { name: 'y', changed: '不是数组' }),
    );
    expect(lastNotice(s).text).toBe('agent: y');
  });
});

describe('lastOutputAt（R-7：驱动等待指示器的卡住判定）', () => {
  it('引擎每产出一点东西就刷新一次（model_delta / tool_start / tool_result）', () => {
    const s = run(
      ev('user_message', { text: 'x' }),
      ev('model_delta', { text: 'a', ts: 100 }),
      ev('model_delta', { text: 'b', ts: 101 }),
      ev('tool_start', { tool: 'file_read', ts: 102 }),
      ev('tool_result', { tool: 'file_read', status: 'SUCCESS', ts: 103 }),
    );
    expect(s.meta.lastOutputAt).toBe(103);
  });

  it('初始为 0，且**用户消息**不算产出（用户打字不是引擎在动）', () => {
    expect(initialState().meta.lastOutputAt).toBe(0);
    const s = run(ev('user_message', { text: 'x', ts: 50 }));
    expect(s.meta.lastOutputAt).toBe(0);
  });

  it('reducer 仍是纯的：同一串事件跑两遍，lastOutputAt 一样', () => {
    const events = [
      ev('user_message', { text: 'x', ts: 10 }),
      ev('model_delta', { text: 'a', ts: 20 }),
      ev('tool_result', { tool: 't', status: 'SUCCESS', ts: 30 }),
    ];
    expect(applyEvents(initialState(), events).meta.lastOutputAt)
      .toBe(applyEvents(initialState(), events).meta.lastOutputAt);
  });
});
