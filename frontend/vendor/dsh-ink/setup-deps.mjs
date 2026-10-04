// Resolve the vendored kernel's public runtime deps WITHOUT copying any
// upstream node_modules into ace.
//
// The vendored files are ESM, so `NODE_PATH` does not apply (Node's ESM
// resolver ignores it). Instead we materialise a real `node_modules` directory
// next to the vendored tree and fill it with directory junctions pointing at
// the already-installed public packages. Node then resolves them by the normal
// nearest-node_modules walk, and each package's own transitive deps resolve via
// realpath inside the install tree.
//
// Run: node frontend/vendor/dsh-ink/setup-deps.mjs
//
// ⚠️ 陷阱一（ACE_OWNED）：react 与 react-reconciler **不**指向上游 dsh-tui，而是由 ace 自己的
// `frontend/node_modules/*` 提供。两份 React 19 的元素能互认，但 hook 不能 ——
// 内核用 dsh-tui 的 React、`src/**` 用 ace 的 React 时，带 `useState` 的组件抛
// "Invalid hook call" 并**静默渲染成空屏（零报错）**。
//
// ⚠️ 陷阱二（更隐蔽，同样是 ACE_OWNED）：**自身会 `import react` 的传递依赖**也不能建
// junction。Node 的 ESM 解析**按 realpath 走**：`usehooks-ts` 指向 dsh-tui 时，它自己的
// `import react` 会落到 `…\@deepseek-harness-tui\dsh-tui\node_modules\react` = 第二份 React。
// 后果不是空屏而是 **ERROR 屏**：内核 `use-input.js` 拿 ace 的 React、`usehooks-ts` 拿 dsh-tui 的
// React，任何调 `useInput` 的组件一渲染就 `Invalid hook call` /
// `Cannot read properties of null (reading 'useRef')`，且**不抛** —— 内核把它画成 ERROR 屏。
// 所以这几个包**一律不建 junction**，改由 `frontend/package.json` 声明、`npm install` 装进
// `frontend/node_modules`，让 Node 的「最近 node_modules 上溯」自然拿到唯一那份 react。
// 反过来也必须守住：`vendor/dsh-ink/node_modules/<name>` **不许**存在（有就 unlink 自愈）。
//
// 怎么知道哪些包"自身 import react"：`probe.mjs` 的 PATH E 会扫 `lib/**` 的全部 bare
// specifier + 每个包的源码；名单漂了 probe 就红。
import { symlinkSync, existsSync, mkdirSync, readFileSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UPSTREAM = process.env.DSH_TUI_PKG
  || 'C:/Users/69215/AppData/Roaming/npm/node_modules/@deepseek-harness-tui/dsh-tui';
const UP_NM = join(UPSTREAM, 'node_modules');
const DEST_NM = join(HERE, 'node_modules');
// ace 侧的 node_modules（frontend/node_modules）= 所有 react 使用者的唯一真源
const ACE_NM = join(HERE, '..', '..', 'node_modules');
// 自身会 `import react` 的包：必须由 ace 的 npm install 提供（frontend/node_modules），
// 且**不许**在 vendor/node_modules 里建 junction（junction 会让它的 react 落到 dsh-tui）。
// 其余 18 个包不 import react，junction 到 dsh-tui 是安全的。
// 名单由 probe.mjs PATH E 扫闭包复核；实测这三个正是闭包里全部 react 使用者。
const ACE_OWNED = new Set(['react', 'react-reconciler', 'usehooks-ts']);

// Public packages the kernel closure imports, pinned to the upstream versions.
export const PINS = {
  '@alcalzone/ansi-tokenize': '0.3.1',
  'auto-bind': '5.0.1',
  'bidi-js': '1.1.0',
  chalk: '6.0.1',
  'cli-boxes': '4.0.1',
  'code-excerpt': '4.0.0',
  'emoji-regex': '11.0.0',
  'get-east-asian-width': '1.7.0',
  'indent-string': '5.0.0',
  'lodash-es': '4.18.1',
  react: '19.3.0',
  'react-reconciler': '0.34.0',
  scheduler: '0.28.0',
  semver: '7.8.5',
  'signal-exit': '4.1.0',
  sixel: '0.16.0',
  'stack-utils': '2.0.6',
  'strip-ansi': '7.2.0',
  'supports-hyperlinks': '3.2.0',
  'usehooks-ts': '3.1.1',
  'wrap-ansi': '10.0.2',
};

mkdirSync(DEST_NM, { recursive: true });
let made = 0, kept = 0, repaired = 0;
const bad = [];
let unlinked = 0;

for (const [name, want] of Object.entries(PINS)) {
  const link = join(DEST_NM, name);
  if (ACE_OWNED.has(name)) {
    // ① 真源必须在 ace 这边（由 `cd frontend && npm install` 装出）
    const target = join(ACE_NM, name);
    if (!existsSync(target)) {
      bad.push(`${name}: 未安装于 ${target}（先跑 "cd frontend" 再 "npm install"）`);
      continue;
    }
    const have = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version;
    if (have !== want) bad.push(`${name}: pinned ${want}, found ${have}`);

    // ② vendor 侧**不许**有链接/目录；有链接就删（自愈），有真实目录则拒绝（那是第二份 React）
    const cur = lstatSync(link, { throwIfNoEntry: false });
    if (cur) {
      if (!cur.isSymbolicLink()) {
        bad.push(`${name}: ${link} 是真实目录而非 junction —— 这本身就是第二份 React，请手工删除后重跑`);
        continue;
      }
      unlinkSync(link); // 只删链接；旧版脚本留的 dsh-tui 版链接在这里被拆掉
      unlinked++;
    }
    continue; // 不建 junction：靠 Node 的最近 node_modules 上溯找到 frontend/node_modules
  }

  const target = join(UP_NM, name);
  if (!existsSync(target)) { bad.push(`${name}: not installed at ${target}`); continue; }
  const have = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version;
  if (have !== want) bad.push(`${name}: pinned ${want}, found ${have}`);

  mkdirSync(dirname(link), { recursive: true });
  const wantReal = realpathSync(target);
  const cur = lstatSync(link, { throwIfNoEntry: false });
  if (cur) {
    // 幂等 + 自愈：已存在还不够，必须确认它指向的就是本次想要的那份。
    // 旧版脚本把 react 指向了 dsh-tui，若照旧「存在就跳过」，错误的双 React 会永久留下。
    let curReal = null;
    try { curReal = cur.isSymbolicLink() ? realpathSync(link) : null; } catch { /* 目标已消失 */ }
    if (curReal && curReal.toLowerCase() === wantReal.toLowerCase()) { kept++; continue; }
    if (!cur.isSymbolicLink()) {
      bad.push(`${name}: ${link} 是真实目录而非 junction，请手工删除后重跑`);
      continue;
    }
    unlinkSync(link); // 只删链接，绝不碰目标内容（实测：junction 目标文件原样保留）
    repaired++;
  } else {
    made++;
  }
  symlinkSync(wantReal, link, 'junction');
}

console.log(`setup-deps: ${made} junctions created, ${repaired} re-pointed, ${unlinked} react-importer links removed, ${kept} already correct, ${Object.keys(PINS).length} pinned`);
if (bad.length) { console.error('MISMATCH/ABSENT:\n  ' + bad.join('\n  ')); process.exit(2); }

// 单实例自检：ACE_OWNED 的包必须解析到 ace 自己的 node_modules，且 vendor 侧一个链接都不留。
// 这是两个"两份 React"陷阱的共同硬不变量。
const ACE_PREFIX = realpathSync(ACE_NM).toLowerCase() + sep;
const notOwned = [];
for (const n of [...ACE_OWNED].sort()) {
  const p = realpathSync(join(ACE_NM, n));
  console.log(`  ${n} -> ${p} (no junction)`);
  if (!p.toLowerCase().startsWith(ACE_PREFIX)) notOwned.push(`${n} -> ${p}`);
  const stale = lstatSync(join(DEST_NM, n), { throwIfNoEntry: false });
  if (stale) notOwned.push(`${n}: vendor/dsh-ink/node_modules/${n} 仍在（会劫持该包自己的 react 解析）`);
}
// resolve-through sanity check (proves the junction is live, not a stale copy)
for (const n of ['chalk', 'wrap-ansi']) console.log(`  ${n} -> ${realpathSync(join(DEST_NM, n))} (junction)`);
if (notOwned.length) {
  console.error('单实例 React 被破坏（内核侧必须取 ace 的 frontend/node_modules）：\n  ' + notOwned.join('\n  ')
    + '\n带 useState 的组件会 "Invalid hook call" 并静默渲染成空屏；'
    + '\n调 useInput（usehooks-ts）的组件会 "Invalid hook call" 并被画成 ERROR 屏。');
  process.exit(1);
}
