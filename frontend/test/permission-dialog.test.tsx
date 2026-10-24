/**
 * 授权框的「记住并写规则」显隐（WP-AGENCY 刀3）。
 *
 * `persist_ok=false`（引擎判定这次不适配：外发工具 / 组合命令 / 危险包装）时
 * 第 4 项必须**整个不渲染**——按了没反应的按钮是体验债；缺省（旧引擎没有该
 * 字段）照常显示，行为与引入该字段之前逐字一致。
 */

import React from 'react';
import { describe, expect, it } from 'vitest';

import { PermissionDialog } from '../src/components/PermissionDialog.js';
import { renderLines } from './helpers/screen.js';

const t = (k: string): string => k;
const noColor = (): string | undefined => undefined;

function frame(persistOk?: boolean): string {
  return renderLines(
    React.createElement(PermissionDialog, {
      tool: 'terminal_exec', reason: 'pytest -q', persistOk,
      t, color: noColor, onAnswer: () => {},
    }),
    80,
  ).text;
}

describe('授权框：「记住并写规则」随 persist_ok 显隐', () => {
  it('缺省（旧引擎，无字段）→ 第 4 项照常显示，三态也在', () => {
    const f = frame(undefined);
    expect(f).toContain('perm_opt_persist');
    expect(f).toContain('perm_opt_once');
    expect(f).toContain('perm_opt_session');
    expect(f).toContain('perm_opt_deny');
  });

  it('persist_ok=false → 第 4 项整个不渲染（按了没反应的按钮是体验债）', () => {
    const f = frame(false);
    expect(f).not.toContain('perm_opt_persist');
    expect(f).toContain('perm_opt_once');
    expect(f).toContain('perm_opt_deny');
  });

  it('persist_ok=true → 显示（与缺省同口径）', () => {
    expect(frame(true)).toContain('perm_opt_persist');
  });
});
