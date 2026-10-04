/**
 * `npm run preview` —— 把**真实渲染帧**打到你的终端里。
 *
 * ## 为什么要有这个
 *
 * `docs/HANDOFF-FRONTEND.md` §四.2 写着："六项的视觉效果一次都没被人眼看过……
 * 这是接手后的第一件事"。原因是开发环境没有 TTY，Ink 起不来，于是配色、排版、
 * vim 光标、卡片对齐这些**只能看**的东西一直没有判据。
 *
 * 这个脚本用 `test/mount.tsx` 的 `mountTree()`（内核 `renderSync` + 假 stdio，
 * 与 `app.test.tsx` 同一套工具）把 `App` 跑起来，喂一段**脚本化的事件流**，
 * 把每一步的帧按顺序打出来。它渲的是真组件、真 reducer、真排版 —— 不是另画一份示意图。
 *
 * ## 迁移记录（S6，换内核）
 * 原来用 `ink-testing-library` 的 `render()`。换内核后它整体失效：它写死上游 `ink`
 * 的 React 18 reconciler，**collect 期**就抛 `Cannot read properties of undefined
 * (reading 'ReactCurrentOwner')` —— `test/preview.test.ts` 于是 0 用例。
 * 换成 `mountTree()`（同形状句柄：`lastFrame / stdin / unmount`），断言一字未改。
 *
 * ## 用法
 *
 * ```bash
 * cd frontend && npm run preview          # 带色（在你的终端里看）
 * npm run preview -- --plain              # 去掉 ANSI，方便贴进 issue / diff
 * ```
 *
 * ## 与测试的关系
 *
 * `test/preview.test.ts` 会跑同一个 `buildPreviewFrames()` 并断言每帧非空、
 * 关键字在帧里 —— 所以这个脚本**在 CI 里也是活的**（它一旦因为组件改名而崩，
 * CI 就红，而不是悄悄变成一份没人维护的脚本）。
 *
 * 刻意**不做**的：把帧存成 SVG 进 CI 做像素级比对。那是 `demo/record_demo.py`
 * 在 Python 侧走的路，等这套帧稳定了再说 —— 先让"有人看过"这件事成立。
 */

import chalk from 'chalk';

import { App } from '../src/App.js';
import { I18n } from '../src/i18n.js';
import type { AceEvent } from '../src/protocol/types.js';
import { colorFor, detectTheme, type Token } from '../src/theme/tokens.js';
import { FakeClient, tick } from '../test/fake-engine.js';
import { mountTree } from '../test/mount.js';

export interface PreviewFrame {
  /** 这一步在看什么（打印时的标题）。 */
  title: string;
  /** 真实渲染帧（含 ANSI 转义，除非 `plain`）。 */
  frame: string;
}

/** 一段脚本化的事件流：每一步 = 标题 + 要推的事件（+ 可选按键）。 */
interface Step {
  title: string;
  events?: AceEvent[];
  /** 额外按一个键（如 Ctrl+T 开任务树）。 */
  key?: string;
  /** 连按几拍再截帧（流式那几步要看"字在长"）。 */
  settles?: number;
}

const ts = (n: number): number => 1_700_000_000 + n;

const SCRIPT: Step[] = [
  { title: '① 首屏：横幅 + 主页（身份/环境在横幅，主页只留可操作条目）' },
  {
    title: '② 会话开始 + 底栏（分段来自引擎的 status 事件）',
    events: [
      {
        type: 'session_start',
        ts: ts(1),
        version: '3.44.0',
        permission: 'readonly',
        sandbox: 'off',
        project_root: '/home/me/proj',
        model: 'deepseek-v4-flash',
        mock: false,
      },
      {
        type: 'status',
        ts: ts(2),
        segments: [
          { name: 'model', text: ' deepseek-v4-flash ', priority: 10, level: 'info' },
          { name: 'permission', text: ' 权限:readonly ', priority: 10, level: 'info' },
          { name: 'sandbox', text: ' 沙箱:off ', priority: 55, level: 'info' },
          { name: 'turns', text: ' 轮0 工具0 ', priority: 70, level: 'dim' },
          { name: 'context', text: ' 上下文 12% ', priority: 20, level: 'dim' },
        ],
      },
    ],
  },
  {
    title: '③ 提问 → 流式增量（这是 `model_delta`；此前一条都发不出来）',
    events: [
      { type: 'user_message', ts: ts(3), text: '帮我看看 README 里那句话怎么改' },
      { type: 'model_request', ts: ts(4), round: 1, messages_count: 3, system_len: 4200 },
      { type: 'model_delta', ts: ts(5), text: '我先读一下 README' },
    ],
  },
  { title: '③b 增量继续长（同一帧内的第 2 拍）', events: [
    { type: 'model_delta', ts: ts(6), text: '，找到那句了：' },
  ], settles: 2 },
  {
    title: '③c 增量收尾',
    events: [{ type: 'model_delta', ts: ts(7), text: '\n\n> 生产级 AI 编程助手\n\n要不改成更具体的？' }],
    settles: 2,
  },
  {
    title: '④ 工具卡片（写类工具带 diff 与耗时）',
    events: [
      { type: 'model_request', ts: ts(8), round: 1, messages_count: 4, system_len: 4200 },
      { type: 'tool_start', ts: ts(9), tool: 'file_write', target: 'README.md' },
      {
        type: 'tool_result',
        ts: ts(10),
        tool: 'file_write',
        status: 'SUCCESS',
        elapsed: 0.42,
        message: '已写入',
        data: {
          diff: '--- a/README.md\n+++ b/README.md\n@@ -1,3 +1,3 @@\n-# AI Agent System\n+# HooH · 互\n',
        },
      },
    ],
  },
  {
    title: '⑤ 最终回复（Markdown：标题/引用/行内码）',
    events: [
      {
        type: 'final',
        ts: ts(11),
        round: 1,
        text: '改好了。\n\n## 改了什么\n\n- 标题换成 `HooH · 互`\n- 保留原有的能力清单\n\n> 下一句想动 `assets/logo.svg` 吗？',
      },
    ],
  },
  {
    title: '⑥ 审批对话框（三态：仅本次 / 本会话 / 拒绝）',
    events: [
      {
        type: 'permission_request',
        ts: ts(12),
        tool: 'terminal_exec',
        reason: '执行修改性 shell 命令：rm -rf build/',
      },
    ],
  },
  {
    title: '⑦ 任务树（Ctrl+T；数据来自引擎的 tasks.request）',
    key: '\x14',
    settles: 3,
  },
];

/**
 * 跑完脚本，返回每一步的真实帧。
 *
 * `plain=true` 时剥掉 ANSI —— 贴进 issue、或在自己没有色彩的终端里看。
 * 剥色用的是仓库里那把尺子（`strip-ansi` 由 Ink 自带，不另引依赖）：
 * 这里只做最小正则，够用即可。
 */
export async function buildPreviewFrames(plain = false): Promise<PreviewFrame[]> {
  const client = new FakeClient();
  const i18n = new I18n('zh');
  // 与 `src/index.tsx` 同一条取色路径（`colorFor(token, theme)`）——
  // 自己另拼一份 chalk 名字的话，这里看到的颜色就不是用户看到的。
  const theme = detectTheme();
  const colorOf = (token: string): string | undefined => colorFor(token as Token, theme);
  const tree = mountTree(
    <App client={client} t={(k, p) => i18n.t(k, p)} colorOf={colorOf} />,
  );
  await tick();

  const frames: PreviewFrame[] = [];
  const snap = (title: string): void => {
    const frame = tree.lastFrame() ?? '';
    frames.push({ title, frame: plain ? stripAnsi(frame) : frame });
  };

  for (const step of SCRIPT) {
    if (step.events) {
      for (const ev of step.events) client.push(ev);
      await tick();
    }
    if (step.key) {
      tree.stdin.write(step.key);
      await tick();
    }
    for (let i = 1; i < (step.settles ?? 1); i++) await tick();
    snap(step.title);
  }

  tree.unmount();
  return frames;
}

/**
 * 最小 ANSI 剥离：CSI 序列与 OSC（超链接/标题，内核发的 OSC8 是 **BEL 收尾**的
 * `\x1b]8;;\x07` —— 少剥它，`--plain` 出来的帧贴进 issue 就带一串隐形控制符）。
 * `test/preview.test.ts` 直接 import 它，两侧用**同一把尺子**，免得"剥色"这件事
 * 各自实现一遍然后慢慢走偏。
 */
export function stripAnsi(s: string): string {
  return s
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

async function main(): Promise<void> {
  const plain = process.argv.includes('--plain') || !process.stdout.isTTY;
  const frames = await buildPreviewFrames(plain);
  const bar = '─'.repeat(72);
  for (const f of frames) {
    process.stdout.write(`\n${bar}\n${f.title}\n${bar}\n${f.frame}\n`);
  }
  process.stdout.write(
    `\n${bar}\n` +
      `共 ${frames.length} 帧 · 由 test/mount.tsx 的内核渲染**真组件**得出（不是示意图）\n` +
      (plain ? '（--plain / 非 TTY：已剥离 ANSI）\n' : '（带色；--plain 可剥掉 ANSI）\n') +
      // 颜色是 chalk 在 import 时按"输出是不是 TTY"定级的，而这里的 stdout 是
      // `mountTree()` 的假 stdout —— **它永远不是 TTY**。所以不设 FORCE_COLOR
      // 的话拿到的是无色的帧：排版能验，配色不能。这句话就是那条出口。
      (chalk.level === 0
        ? '⚠ 颜色没开（chalk.level=0）：本脚本用假 stdout 渲染，chalk 认为"不是终端"。\n' +
          '  要看配色，请在启动 node **之前**设 FORCE_COLOR：\n' +
          '    PowerShell:  $env:FORCE_COLOR=1; npm run preview\n' +
          '    bash:        FORCE_COLOR=1 npm run preview\n'
        : ''),
  );
}

// 直接执行时才跑（被 `test/preview.test.ts` import 时不要打印一堆东西）
if (process.argv[1] && /preview\.(tsx?|js)$/.test(process.argv[1])) {
  main().catch((e: unknown) => {
    process.stderr.write(`preview 失败：${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
}
