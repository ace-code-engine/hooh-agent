/**
 * 状态行：**引擎分段优先**。
 *
 * 为什么值得单测这一层：底栏是"随时在眼前"的那一行，而它的数据有两个可能来源 ——
 * 引擎的 `status` 事件（权威：`/statusline` 配置、告警档都在那边）与前端的
 * `buildSegments` 自算（界面挂载早于第一个事件时的兜底）。**两份都存在**，
 * 所以"用哪一份"必须被钉住：两边各算一份就会出现"CLI 说 92%、前端说 40%"。
 *
 * 宽度裁剪（`fitSegments`）不在这里重复测 —— 那是它自己那条口径。
 *
 * ---
 * ## 迁移记录（2026-10-04，换内核前置样板）
 *
 * 渲染断言从 `ink-testing-library` 的 `render()` / `lastFrame()` 迁到
 * `./helpers/screen.js` 的 `renderLines()`（走 vendored 内核 `renderToScreen`：
 * 同步、纯 buffer、不写 stdout）——原因见 `helpers/screen.ts` 文件头。
 *
 * 三条改动，**断言一个字没改**：
 *   1. `render(<X/>).lastFrame() ?? ''` → `renderLines(h(X, props), width).lines`；
 *   2. 不需要 `await tick()`：`renderToScreen` 返回时帧已经画完（原来那两次 sleep 是在赌 Ink 的异步 flush）；
 *   3. 宽度只能由调用方给：`renderLines(tree, 80)`，跟组件自己的 `width={80}` 对齐。
 *
 * ⚠️ 那两条渲染用例此前是 skip 的，**现已删掉 skip（S5）**：它们等的是"`src/**` 跟着上
 * React 19"（内核渲染器只认 `react.transitional.element`，React 18 建的元素会被静默丢弃）。
 * 条件已满足 —— 断言本来就是新工具的形式，所以删 skip 就绿。
 */

import { describe, expect, it } from 'vitest';

import { StatusLine, levelToken, segmentsFromEngine } from '../src/components/StatusLine.js';
import type { StatusSegmentWire } from '../src/protocol/types.js';
import { initialState } from '../src/state/store.js';
import type { Meta } from '../src/state/store.js';
import { displayWidth } from '../src/render/text.js';
import { Box, Text } from './helpers/kernel.js';
import { h, kernelReactVersion, renderLines } from './helpers/screen.js';

const noColor = (): string | undefined => undefined;
const t = (key: string, params?: Record<string, string | number>): string =>
  params ? `${key}:${Object.values(params).join(',')}` : key;

const seg = (
  name: string,
  text: string,
  priority = 50,
  level = 'info',
): StatusSegmentWire => ({ name, text, priority, level });

function metaWith(over: Partial<Meta>): Meta {
  return { ...initialState().meta, ...over };
}

/**
 * 工具自检 —— 不依赖 `src/**`，所以换内核之前也能跑。它证明的是"这套断言工具真的通"：
 * 从 cell 网格取字、CJK 占两列、查询辅助都工作。
 */
describe('内核断言工具自检', () => {
  it('取字符/取行；`甲` 在网格里占 2 列，不是 1 个码点', () => {
    const ui = h(
      Box,
      { flexDirection: 'column' },
      h(Text, null, '权限:write'),
      h(Text, null, '甲甲'),
    );
    const r = renderLines(ui, 12);

    // 接的是内核那份 React，不是 ace 的 18
    expect(kernelReactVersion.startsWith('19.')).toBe(true);
    // 行宽 = 渲染列数（跟内容长短无关）
    expect(r.width).toBe(12);
    expect(r.lines[0]).toBe('权限:write');
    // `甲甲` = 2 个码点 / **4 列**：宽度要用 displayWidth 数，不能用 .length
    expect(r.lines[1]?.length).toBe(2);
    expect(displayWidth(r.lines[1] ?? '')).toBe(4);
    // 查询辅助
    expect(r.has('权限')).toBe(true);
    expect(r.lineWith('write')).toBe('权限:write');
    expect(r.linesWith('甲')).toHaveLength(1);
    expect(r.linesWith('没有这一行')).toHaveLength(0);
  });
});

describe('引擎分段优先', () => {
  it('有引擎分段时不再自算', () => {
    // 原来：const out = render(<StatusLine ... />).lastFrame() ?? '';
    const out = renderLines(
      h(StatusLine, {
        meta: metaWith({
          permission: 'readonly',
          model: 'some-model',
          statusSegments: [seg('context', '上下文 92%', 20, 'warn')],
        }),
        busy: false,
        color: noColor,
        width: 80,
        t,
      }),
      80,
    ).text;
    expect(out).toContain('上下文 92%');
    // 自算那套若也上了屏，这里会看到 i18n 键名（假 t 把它拼成 "footer_permission:readonly"）
    expect(out).not.toContain('footer_permission');
    expect(out).not.toContain('some-model');
  });

  it('没有引擎分段时退回自算（界面挂载早于第一个事件，那一行不该是空的）', () => {
    const out = renderLines(
      h(StatusLine, {
        meta: metaWith({ permission: 'readonly', statusSegments: [] }),
        busy: false,
        color: noColor,
        width: 80,
        t,
      }),
      80,
    ).text;
    expect(out).toContain('footer_permission:readonly');
  });
});

describe('语义档 → 主题 token', () => {
  it('四档各落各的（danger 走 error，不是 perm_full）', () => {
    expect(levelToken('dim')).toBe('dim');
    expect(levelToken('warn')).toBe('warn');
    expect(levelToken('danger')).toBe('error');
    expect(levelToken('goal')).toBe('goal_active');
    expect(levelToken('info')).toBe('text');
    expect(levelToken('引擎以后新加的档')).toBe('text');
  });

  it('权限那一段按 meta.permission 上色 —— 那边 level 有重叠，只有 name 能区分', () => {
    // 引擎的 `class:footer-w` 同时被"可写权限"与"告警分段"复用，所以不能照 level 上色。
    const rows = [seg('permission', ' 权限:write ', 10, 'warn')];
    const tokens = ['readonly', 'write', 'full'].map(
      (p) => segmentsFromEngine(rows, metaWith({ permission: p }))[0].token,
    );
    expect(tokens).toEqual(['perm_ro', 'perm_write', 'perm_full']);
  });

  it('优先级原样带过来（裁剪顺序仍由前端按自己的列数决定）', () => {
    const rows = segmentsFromEngine([seg('a', ' A ', 7), seg('b', ' B ', 3)], metaWith({}));
    expect(rows.map((r) => r.priority)).toEqual([7, 3]);
    expect(rows.map((r) => r.text)).toEqual([' A ', ' B ']);
  });
});
