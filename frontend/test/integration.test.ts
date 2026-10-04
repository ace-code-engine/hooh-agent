/**
 * 端到端集成测试 —— **真的起 Python 引擎**，走真的管道、真的协议。
 *
 * 为什么这一层不能只靠假引擎：假引擎能证明"界面拿到事件画得对"，但证明不了
 * "事件真的产得出来"。协议两端对不上的症状（字段名拼错、事件类型漏登记、
 * 审批三态不一致）**只在真往返里才暴露**。
 *
 * 这一层刻意**不渲染 Ink** —— Ink 要有 TTY，CI 上通常没有；而这里要验的是
 * 管道与协议，不是绘制。绘制由 `app.test.tsx` 的假引擎覆盖。两边合起来才是完整的。
 *
 * 引擎不可用时（没 Python / 环境不对）**整组跳过**，而不是报一堆红 —— 但跳过会
 * 在输出里说清楚，不会假装通过。
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AceClient, resolvePython } from '../src/protocol/client.js';
import type { AceEvent } from '../src/protocol/types.js';

const PYTHON = resolvePython();
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * H-31：**给引擎一个临时项目根**，不要让它落在 cwd（= 仓库根）上。
 *
 * 此前这里只传 `--mock --permission readonly`，而 `AceClient` 的 cwd 就是仓库根，
 * 于是引擎按 cwd 落 `project_root` —— 一次 `npm test` 会在开发者**真实仓库**里留下：
 *
 *   · 未跟踪的 `demo_notes.md`（mock 剧本 `agent_runner.py` 的 file_write）
 *   · 真实 `.ace_sessions/` 新增若干条会话日志（实测一次 262 → 276）
 *   · 真实 `.agent_memory.json` 被改写、`.guardian/snapshots/` 新增目录
 *
 * `e2e/mcp_probe.py` 传了 `--project-root`，Python 侧 `test_all` 也有 H-26 守卫盯着
 * （"测试不许往仓库自己的 .ace_sessions/ 写会话"）—— 只有这个入口漏了。
 */
const PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'ace-fe-int-'));

/** 仓库真实会话日志条数：H-26 那条纪律在 JS 侧的同一把尺子。 */
function repoSessionCount(): number {
  try {
    return readdirSync(join(REPO_ROOT, '.ace_sessions')).filter((n) => n.endsWith('.jsonl'))
      .length;
  } catch {
    return 0;
  }
}

const SESSIONS_BEFORE = repoSessionCount();

/**
 * 起一个引擎，跑完一轮，收齐事件。
 *
 * 收尾的**顺序**很关键，踩过一次：不能等 `session_end` 来决定"一轮跑完了没有" ——
 * 那个事件只在 `shutdown` 时才发，而 serve 模式是前端驱动的，它自己不会退。
 * 于是等 session_end 等于等一个永远不会来的信号，每个用例白等满超时。
 *
 * 正确的信号是 `send()` 的 Promise：它在**这一轮跑完**时就 resolve。
 */
async function runSession(
  trigger: string | null,
  opts: {
    answer?: 'once' | 'session' | 'deny';
    extraArgs?: string[];
    /** 额外的环境变量（合并到 `process.env` 之上，见 `client.ts` 的 `env`）。 */
    env?: Record<string, string>;
  } = {},
): Promise<{ events: AceEvent[]; gaps: number[]; exitOk: boolean; client: AceClient }> {
  const client = new AceClient({
    extraArgs: [
      '--mock',
      '--permission',
      'readonly',
      // H-31：会话落在临时目录，不落仓库
      '--project-root',
      PROJECT_ROOT,
      ...(opts.extraArgs ?? []),
    ],
    // **子进程也不许写开发者的真实配置**：进程内的桩管不到被 spawn 的引擎，
    // 实测一次测试就能把 `~/.ai_code.json` 覆盖成测试用的空壳。
    env: { ACE_NO_SAVE_CONFIG: '1', ...(opts.env ?? {}) },
  });
  const events: AceEvent[] = [];
  client.on('event', (ev: AceEvent) => events.push(ev));

  if (opts.answer) {
    const decision = opts.answer;
    // 引擎会在审批处**阻塞**等答案，所以监听必须在发消息之前就挂好。
    client.on('permission_request', () => {
      void client.answerPermission(decision, '集成测试').catch(() => undefined);
    });
  }

  await client.start(true);

  if (trigger !== null) {
    await client.send(trigger).catch(() => undefined);
  }

  // 收工：shutdown 之后引擎才会发 session_end（它写在 atexit 里）。
  const ended = new Promise<void>((resolve) => {
    client.on('session_end', () => resolve());
    client.on('exit', () => resolve());
  });
  const exitOk = await client.shutdown().then(
    () => true,
    () => false,
  );
  await Promise.race([ended, new Promise((r) => setTimeout(r, 15_000))]);

  return { events, gaps: client.seqGaps, exitOk, client };
}

let engineUsable = true;
beforeAll(async () => {
  // 探一次引擎能不能起来：起不来就整组跳过（并说明原因），
  // 而不是让二十条用例各自失败一遍、把真正的问题淹掉。
  try {
    const c = new AceClient({ extraArgs: ['--mock', '--project-root', PROJECT_ROOT] });
    await c.start(false);
    await c.shutdown();
  } catch (e) {
    engineUsable = false;
    // eslint-disable-next-line no-console
    console.warn(
      `[integration] 引擎起不来，跳过：${e instanceof Error ? e.message : String(e)}\n` +
        `           解释器探测结果：${PYTHON}`,
    );
  }
}, 120_000);

afterAll(() => {
  rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

describe.skipIf(!engineUsable)('真引擎 · 基本往返', () => {
  it('握手拿到能力，事件流首尾正确', async () => {
    const { events, client } = await runSession('现在几点');
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('session_start');
    expect(types).toContain('user_message');
    expect(types).toContain('model_request');
    expect(types).toContain('final');
    expect(types).toContain('session_end');
    expect(client.capabilities?.protocol).toBe(1);
    expect(client.capabilities?.server?.name).toBe('ace');
  }, 120_000);

  it('seq 单调且无缺口（丢帧会被发现）', async () => {
    const { events, gaps } = await runSession('现在几点');
    expect(gaps).toEqual([]);
    expect(events.length).toBeGreaterThan(4);
  }, 120_000);

  it('tool_start 出现在 tool_call 之前（驱动"正在跑"的根因）', async () => {
    const { events } = await runSession('现在几点');
    const types = events.map((e) => e.type);
    const start = types.indexOf('tool_start');
    const call = types.indexOf('tool_call');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(call).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThan(call);
  }, 120_000);
});

describe.skipIf(!engineUsable)('真引擎 · 授权往返（这个前端存在的理由）', () => {
  it('readonly 下的写操作触发审批，且**事件先于答案**', async () => {
    const { events } = await runSession('帮我改代码，往笔记里加一行', { answer: 'once' });
    const perms = events.filter((e) => e.type === 'permission_request');
    expect(perms.length).toBeGreaterThan(0);
    expect(perms[0]).toMatchObject({ tool: expect.any(String), reason: expect.any(String) });
  }, 120_000);

  it('递上去的答案是 once → 引擎说「已临时授权」', async () => {
    const { events } = await runSession('帮我改代码，往笔记里加一行', { answer: 'once' });
    const notices = events
      .filter((e) => e.type === 'notice')
      .map((e) => String(e.text ?? ''))
      .join('\n');
    expect(notices).toContain('已临时授权');
  }, 120_000);

  it('递上去的答案是 deny → 引擎说「已拒绝授权」', async () => {
    const { events } = await runSession('帮我改代码，往笔记里加一行', { answer: 'deny' });
    const notices = events
      .filter((e) => e.type === 'notice')
      .map((e) => String(e.text ?? ''))
      .join('\n');
    expect(notices).toContain('已拒绝授权');
  }, 120_000);

  it('递上去的答案是 session → 引擎说「已授权本次会话」', async () => {
    const { events } = await runSession('帮我改代码，往笔记里加一行', { answer: 'session' });
    const notices = events
      .filter((e) => e.type === 'notice')
      .map((e) => String(e.text ?? ''))
      .join('\n');
    expect(notices).toContain('本次会话');
  }, 120_000);

  // ── R-2：防误触宽限期（`ui/ace_grace`）在这条路上也必须成立 ──
  //
  // 这个驱动**一看到 `permission_request` 就立刻作答**（亚毫秒级），所以它天然就是
  // "对话框刚弹出来、上一个动作里飞过来的那一下"那个场景 —— 而 `--serve` 这条路上
  // 此前**没有任何闸门**（终端在 `_read_answer` 里、TUI 在 `TurnController` 里都有），
  // 于是同一个动作换到 Ink 就少了一道保护。
  it('★即时答案不被采纳 —— 引擎提示"按得太快"并**重问**', async () => {
    // 把窗口放大到 2s：这个驱动是"一看到请求就答"，但机器一忙，一次往返也可能超过 200ms
    // —— 那时"即时"就不即时了，断言会偶发红。放大窗口不改变被测语义（窗口内一律丢弃），
    // 只把抖动挤出去。`ACE_PERM_GRACE_MS` 是**文档化**的那个旋钮（`ui/ace_grace.py`）。
    const { events } = await runSession('帮我改代码，往笔记里加一行', {
      answer: 'once',
      env: { ACE_PERM_GRACE_MS: '2000' },
    });
    const typeAt = (pred: (e: AceEvent) => boolean): number => events.findIndex(pred);
    const isGrace = (e: AceEvent): boolean =>
      e.type === 'notice' && String(e.text ?? '').includes('按得太快');

    // 判据不能只看"请求出现了几次" —— mock 剧本本来就有多次审批，那条会因为**错误的原因**通过
    // （第一版就是栽在这上面）。真正要验的是**次序**：
    // 请求 → 被判为飞行按键（提示） → 之后才可能被采纳。
    const firstPerm = typeAt((e) => e.type === 'permission_request');
    const firstGrace = typeAt(isGrace);
    const firstAccept = typeAt(
      (e) => e.type === 'notice' && String(e.text ?? '').includes('已临时授权'),
    );
    expect(firstPerm, '这一轮压根没有审批，测不到宽限期').toBeGreaterThanOrEqual(0);
    expect(
      firstGrace,
      `即时答案被直接采纳了（事件序：${events.map((e) => e.type).join(',')}）` +
        '—— 对话框刚弹出来那一瞬飞过来的按键必须不算数',
    ).toBeGreaterThan(firstPerm);
    expect(firstGrace, '先得判为飞行按键，才轮得到采纳').toBeLessThan(firstAccept);
    // 丢弃是**成对**的：`MAX_DISCARDS`（`ui/ace_grace.py`）决定重问几次 ——
    // 最后一轮的丢弃同时用尽了次数，所以 N 次丢弃 → N-1 句提示（与终端同算术）。
    expect(events.filter(isGrace).length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('**三种决策产生三种不同的引擎行为** —— 这才叫答案真的送达了', async () => {
    // **串行**跑，不要 Promise.all：这条要验的是"三种决策 → 三种行为"，
    // 并发不是它的考点。而整个套件本来就在并发起 Python 子进程 —— 再加三个
    // 同时跑的引擎，机器一紧张就有一条赶不上内部超时，于是偶尔少一种行为、
    // 报 `expected 2 to be 3`。那种红是负载造成的，不是产品问题，
    // 但它会消耗掉别人对这条测试的信任（"那条老红"），所以按顺序跑。
    const once = await runSession('帮我改代码，往笔记里加一行', { answer: 'once' });
    const deny = await runSession('帮我改代码，往笔记里加一行', { answer: 'deny' });
    const session = await runSession('帮我改代码，往笔记里加一行', { answer: 'session' });
    const noticesOf = (r: { events: AceEvent[] }): string =>
      r.events
        .filter((e) => e.type === 'notice')
        .map((e) => String(e.text ?? ''))
        .join('\n');
    const a = noticesOf(once);
    const b = noticesOf(deny);
    const c = noticesOf(session);
    expect(new Set([a, b, c]).size).toBe(3);
  }, 300_000);
});

describe.skipIf(!engineUsable)('H-31 · 测试不写开发者的真实仓库', () => {
  it('会话落在临时 project-root 里，仓库自己的 .ace_sessions/ 一条不涨', async () => {
    // 这条按声明顺序跑在**别的用例之后**，所以它测的是"整组跑完"的净变化
    // （与 Python 侧 test_all 的 H-26 同一条纪律、同一把尺子）。
    expect(existsSync(join(PROJECT_ROOT, '.ace_sessions'))).toBe(true);
    expect(repoSessionCount()).toBe(SESSIONS_BEFORE);
    // mock 剧本会 file_write 一个 demo_notes.md —— 它必须落在临时目录里。
    // 此前这条路径直接把未跟踪文件留在了仓库根（实测 2026-09-27 12:56）。
    expect(existsSync(join(PROJECT_ROOT, 'demo_notes.md'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'demo_notes.md'))).toBe(false);
  }, 30_000);
});
