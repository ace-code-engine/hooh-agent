/**
 * defaultProjectRoot —— 引擎 spawn 的 cwd 与脚本路径来源。
 *
 * 回归背景（2026-10-24）：旧实现用 `new URL(import.meta.url).pathname` 手工拼
 * 项目根，而非 ASCII 的仓库路径（本项目就住在 `G:\_归档\…`）在 pathname 里是
 * 百分号编码的——拼出来的 cwd 不存在，引擎 spawn 当场 ENOENT，双击启动直接
 * 闪退。修复走 `fileURLToPath`（正确解码）。本测试在本机（非 ASCII 路径）是
 * 真回归；在 ASCII 路径的 CI 上退化为平凡真。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultProjectRoot } from '../src/protocol/client.js';

describe('defaultProjectRoot：引擎 spawn 的落点必须真实存在', () => {
  it('项目根不含百分号编码（非 ASCII 路径解码正确）', () => {
    const root = defaultProjectRoot();
    expect(root).not.toContain('%');
  });

  it('项目根真实存在且装着 ai_code.py（cwd 无效 = spawn ENOENT = 双击闪退）', () => {
    const root = defaultProjectRoot();
    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, 'ai_code.py'))).toBe(true);
  });
});
