/**
 * **大小写门禁**：相对 import 的 specifier 必须与磁盘上的真实文件名**逐字对齐（含大小写）**。
 *
 * 为什么这条测试必须存在：Windows 的文件系统大小写不敏感，`./components/Box.js` 能找到
 * `box.js`，本机一切正常；到了 Linux（CI 跑在 ubuntu-latest）就直接
 * `Failed to load url ./lib/types/ink/components/Box.js … Does the file exist?`。
 * 2026-10-31 就是这么红的：迁入的 ink 内核里 29 个文件名在拷贝过程中被压成了小写，
 * 而文件内容（和它们互相 import 的写法）是上游的大驼峰 —— 于是 41 个测试文件在 CI 上
 * 连 collect 都过不去，本机 692 条全绿。**只有 CI 是 Linux 才暴露**，所以这里把判据做成
 * 不依赖文件系统的字符串比对：Windows 上也照样能查出 Linux 上才会炸的写法。
 *
 * 判据：枚举源码目录里每个相对 specifier，把它按「真实大小写」逐级解析一遍；
 * 大小写对不上就报，并且给出正确的写法。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['src', 'test', 'vendor/dsh-ink', 'dsh-ui'];
const SKIP_DIRS = new Set(['node_modules', '.vite', 'dist', 'build', 'out', '.vitest-tmp', '_vendor']);
const EXTS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs', '.json'];

const dirCache = new Map<string, Set<string>>();
function children(dir: string): Set<string> {
  let names = dirCache.get(dir);
  if (!names) {
    try {
      names = new Set(fs.readdirSync(dir));
    } catch {
      names = new Set();
    }
    dirCache.set(dir, names);
  }
  return names;
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs|cjs|js)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
}

/** 逐级比对：从 ROOT 走到 abs，每一级目录项都必须**大小写精确**存在 */
function existsExact(abs: string): boolean {
  const rel = path.relative(ROOT, abs);
  if (!rel || rel.startsWith('..')) return false;
  let cur = ROOT;
  for (const part of rel.split(path.sep)) {
    if (!children(cur).has(part)) return false;
    cur = path.join(cur, part);
  }
  return true;
}

/** specifier 可能用 .js 指 .ts（tsx 运行时），也可能省略扩展名 / 指向目录 index */
function candidates(abs: string): string[] {
  const out = [abs];
  const m = /\.(js|mjs|cjs)$/.exec(abs);
  if (m) for (const x of ['.ts', '.tsx', '.mts']) out.push(abs.slice(0, -m[0].length) + x);
  for (const x of EXTS) out.push(abs + x);
  for (const x of EXTS) out.push(path.join(abs, 'index' + x));
  return out;
}

/** 同目录下大小写不同的那个真实文件名（没有则 null） */
function caseVariant(abs: string): string | null {
  const dir = path.dirname(abs);
  const name = path.basename(abs);
  for (const n of children(dir)) if (n !== name && n.toLowerCase() === name.toLowerCase()) return n;
  return null;
}

interface Problem {
  file: string;
  spec: string;
  shouldBe: string;
}

function scan(): { problems: Problem[]; files: number; specs: number } {
  const files: string[] = [];
  for (const d of SCAN) walk(path.join(ROOT, d), files);
  const problems: Problem[] = [];
  let specs = 0;
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\1/g;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      const spec = m[2];
      specs += 1;
      const base = path.resolve(path.dirname(file), spec);
      let real: string | null = null;
      for (const cand of candidates(base)) {
        if (existsExact(cand)) { real = null; break; }        // 精确命中，没问题
        const variant = caseVariant(cand);
        if (variant) { real = path.join(path.dirname(cand), variant); break; }
      }
      if (!real) continue;
      const rel = path.relative(path.dirname(file), real).split(path.sep).join('/');
      problems.push({
        file: path.relative(ROOT, file).split(path.sep).join('/'),
        spec,
        shouldBe: rel.startsWith('.') ? rel : `./${rel}`,
      });
    }
  }
  return { problems, files: files.length, specs };
}

describe('相对 import 的大小写（Linux 上与 Windows 行为不同，这里在 Windows 上也守）', () => {
  const { problems, files, specs } = scan();

  it('扫到的文件与 specifier 够多（否则这条门禁是空转）', () => {
    expect(files).toBeGreaterThan(1000);
    expect(specs).toBeGreaterThan(2000);
  });

  it('每个相对 specifier 都能按**真实大小写**解析到磁盘上的文件', () => {
    const detail = problems
      .slice(0, 20)
      .map((p) => `${p.file}: "${p.spec}" 应为 "${p.shouldBe}"`)
      .join('\n');
    expect(detail, '以下 specifier 的大小写与磁盘不符（Windows 能跑、Linux 会 Failed to load url）').toBe('');
  });
});
