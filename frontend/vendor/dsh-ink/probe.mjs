// Independent probe: can the vendored kernel render on its own, from inside ace?
//
//   node frontend/vendor/dsh-ink/setup-deps.mjs   # once, wires public deps
//   node frontend/vendor/dsh-ink/probe.mjs        # this file
//
// Imports ONLY from ./lib/types/ink/** (the vendored tree) and writes:
//   out/screen.txt         cell screen as plain text (renderToScreen, no host/TTY/stdout)
//   out/ink-stdout.raw     raw ANSI frame stream captured from a fake non-TTY stdout
//   out/ink-stdout.escaped same, JSON-escaped so \x1b[?2026h / \x1b[?2026l are visible
import { Writable, Readable } from 'node:stream';
import { writeFileSync, mkdirSync, realpathSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire, isBuiltin } from 'node:module';

const HERE = import.meta.dirname;
const L = p => new URL(`./lib/types/ink/${p}`, import.meta.url).href;
const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const React = (await import('react')).default;
const { default: Box } = await import(L('components/Box.js'));
const { default: Text } = await import(L('components/Text.js'));
const { renderToScreen } = await import(L('render-to-screen.js'));
const { cellAtIndex } = await import(L('screen.js'));
const { default: render } = await import(L('root.js'));

const h = React.createElement;
const tree = h(Box, { flexDirection: 'column', paddingX: 1, borderStyle: 'round' },
  h(Text, { color: 'green', bold: true }, 'ace kernel probe'),
  h(Box, { flexDirection: 'row', gap: 1 },
    h(Text, null, 'left'),
    h(Text, { italic: true }, 'right')));

const screenToText = screen => {
  const rows = [];
  for (let y = 0; y < screen.height; y++) {
    let line = '';
    for (let x = 0; x < screen.width; x++) line += cellAtIndex(screen, y * screen.width + x).char;
    rows.push(line.replace(/\s+$/, ''));
  }
  return rows.join('\n');
};

console.log('=== PATH A: renderToScreen() — no host, no TTY, no stdout ===');
console.log(`react resolved: ${React.version}`);
const { screen, height } = renderToScreen(tree, 40);
const textA = screenToText(screen);
console.log(`width=${screen.width} height=${height} (yoga)`);
console.log(textA);
writeFileSync(join(OUT, 'screen.txt'), textA + '\n');

console.log('\n=== PATH B: render() (Ink) with fake non-TTY stdout -> raw ANSI ===');
const chunks = [];
const stdout = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } });
stdout.isTTY = false; stdout.columns = 40; stdout.rows = 12;
const stdin = new Readable({ read() {} });
stdin.isTTY = false;
const stderr = new Writable({ write(c, _e, cb) { cb(); } });
stderr.isTTY = false;

const inst = await render(tree, { stdout, stdin, stderr, patchConsole: false, exitOnCtrlC: false });
await new Promise(r => setTimeout(r, 250));
inst.unmount();
await new Promise(r => setTimeout(r, 100));

const raw = Buffer.concat(chunks).toString('utf8');
writeFileSync(join(OUT, 'ink-stdout.raw'), raw);
writeFileSync(join(OUT, 'ink-stdout.escaped'), JSON.stringify(raw));

const plain = raw.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');

// === PATH C: 单实例 React 守卫 ===
// 这个坑以前是**静默**的：两份 React 19 的元素能互认，hook 不能 —— 带 useState 的组件抛
// "Invalid hook call"，屏幕全空且零报错。所以这里同时断言「同一份文件 / 同一个对象」
// 和「一次性 useState 组件经内核真渲染一次，不是空屏」。
const FRONTEND = join(HERE, '..', '..');                 // ace/frontend
const aceRequire = createRequire(join(FRONTEND, 'src', 'ace-react.anchor.jsx'));   // src/** 的解析起点
const kernelRequire = createRequire(join(HERE, 'lib', 'types', 'ink', 'ink.js'));  // 内核的解析起点
const aceReactPath = realpathSync(aceRequire.resolve('react'));
const kernelReactPath = realpathSync(kernelRequire.resolve('react'));
const aceReconcilerPath = realpathSync(aceRequire.resolve('react-reconciler'));
const kernelReconcilerPath = realpathSync(kernelRequire.resolve('react-reconciler'));
const aceReact = (await import(pathToFileURL(aceReactPath).href)).default;

console.log('\n=== PATH C: single-React guard (ace 侧 vs 内核侧) ===');
console.log(`ace 侧 react:              ${aceReactPath}  v${aceReact.version}`);
console.log(`内核侧 react:              ${kernelReactPath}  v${React.version}`);
console.log(`ace 侧 react-reconciler:   ${aceReconcilerPath}`);
console.log(`内核侧 react-reconciler:   ${kernelReconcilerPath}`);

// 用 ace 侧的 React 造一个带 hook 的组件，交给内核真渲染一次 —— 这正是 src/** 的用法。
let hookText = '', hookErr = null;
try {
  const Stateful = () => {
    const [n] = aceReact.useState(7);
    return aceReact.createElement(Text, null, `hooks-alive-${n}`);
  };
  hookText = screenToText(renderToScreen(aceReact.createElement(Stateful), 40).screen);
} catch (e) { hookErr = e; }
console.log(`带 useState 的组件渲染结果: ${hookErr ? `抛错 ${hookErr.message}` : JSON.stringify(hookText.trim())}`);

// === PATH D: useInput 守卫（第二个"两份 React"陷阱）===
// `use-input.js` 自己 import react，又 import `usehooks-ts`，而 usehooks-ts **自己也 import react**。
// 一旦 usehooks-ts 被 junction 到 dsh-tui，Node 按 realpath 解析会让它拿到第二份 React：
// 内核拿 ace 的 dispatcher、usehooks-ts 要 dsh-tui 的 ⇒ `Invalid hook call` /
// `Cannot read properties of null (reading 'useRef')`，而且**不抛** —— 内核把它画成 ERROR 屏
// （真机上就是输入框起不来，却看不到任何报错）。所以这里真渲染一个调 useInput 的组件。
const { default: useInput } = await import(L('hooks/use-input.js'));
let uiText = '', uiErr = null;
try {
  const Composer = () => {
    useInput(() => {});
    return aceReact.createElement(Text, null, 'useinput-alive');
  };
  uiText = screenToText(renderToScreen(aceReact.createElement(Composer), 40).screen);
} catch (e) { uiErr = e; }
console.log(`\n=== PATH D: useInput 守卫（usehooks-ts 侧 react 必须与内核同一份）===`);
console.log(`带 useInput 的组件渲染结果: ${uiErr ? `抛错 ${uiErr.message}` : JSON.stringify(uiText.trim())}`);

// === PATH D2: 同一条陷阱走真机路径（Ink root → App 的 ErrorBoundary → ERROR 屏）===
// renderToScreen 没有 error boundary，坏了只表现为空屏；真机（renderSync/render）那条路会经过
// `components/app.js` 的 getDerivedStateFromError → ErrorOverview，画成 " ERROR " + 错误消息。
// 这里用和 PATH B 相同的假 stdout 真渲染一次 useInput 组件：断言输出里是预期文本、没有 ERROR 屏。
const uiChunks = [];
const uiStdout = new Writable({ write(c, _e, cb) { uiChunks.push(Buffer.from(c)); cb(); } });
uiStdout.isTTY = false; uiStdout.columns = 40; uiStdout.rows = 12;
const uiStdin = new Readable({ read() {} }); uiStdin.isTTY = false;
const uiStderr = new Writable({ write(c, _e, cb) { cb(); } }); uiStderr.isTTY = false;
const Composer = () => {
  // isActive:false —— 这条路径的 stdin 是假的，真开 raw mode 会先撞 Ink 的
  // "Raw mode is not supported"（环境限制，不是本陷阱）。hook 本身照跑：useInput 无条件调
  // useStdin() + usehooks-ts 的 useEventCallback()，两份 React 就是在这里炸。
  useInput(() => {}, { isActive: false });
  return aceReact.createElement(Text, null, 'useinput-alive');
};
let uiInkErr = null, uiInkRaw = '';
try {
  const inst = await render(aceReact.createElement(Composer), { stdout: uiStdout, stdin: uiStdin, stderr: uiStderr, patchConsole: false, exitOnCtrlC: false });
  await new Promise(r => setTimeout(r, 150));
  inst.unmount();
  await new Promise(r => setTimeout(r, 100));
} catch (e) { uiInkErr = e; }
uiInkRaw = Buffer.concat(uiChunks).toString('utf8').replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '');
console.log(`真机路径（render）输出: ${uiInkErr ? `抛错 ${uiInkErr.message}` : JSON.stringify(uiInkRaw.replace(/\s+/g, ' ').trim().slice(0, 120))}`);

// === PATH E: 闭包里每个"自身会 import react"的包都必须解析到 ace 那份 ===
// 先从 `lib/**` 里抓出全部 bare specifier → 包名，再扫每个包的源码判断它是否 import react，
// 是的话就断言「从该包目录解析 react」得到的与 ace 侧是同一份文件。
// 这正是 usehooks-ts 当初漏掉的地方：只比 react 包本身不够，谁**使用** react 才算数。
const REACT_IMPORT = /(?:from\s*['"]react(?:\/[^'"]*)?['"]|require\(\s*['"]react(?:\/[^'"]*)?['"]\s*\))/;
const BARE_SPEC = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
const bareSpecifiers = () => {
  const out = new Set();
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        for (const m of readFileSync(p, 'utf8').matchAll(BARE_SPEC)) {
          const s = m[1];
          // 相对路径不算公开包；Node 内置模块（含 history 里的 'fs'/'events' 写法）也不算
          if (!s.startsWith('.') && !s.startsWith('#') && !s.startsWith('node:') && !isBuiltin(s)) out.add(s);
        }
      }
    }
  };
  walk(join(HERE, 'lib'));
  return out;
};
const pkgNameOf = s => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);
// ponytail: 目录扫描（跳过 umd/）而不是完整模块图可达性 —— 够用且零依赖。已知上限：
// 某个包把 `import react` 只放在 Node 加载不到的 bundle 里时会误报（当前闭包无此情况）。
const importsReact = dir => {
  const stack = [dir];
  let files = 0;
  while (stack.length && files < 500) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'umd') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(js|mjs|cjs)$/.test(e.name)) { files++; if (REACT_IMPORT.test(readFileSync(p, 'utf8'))) return true; }
    }
  }
  return false;
};
// 包目录：从 probe 的解析点拿到入口文件，再上溯到 package.json.name 匹配的那一层。
// probe.mjs 与内核文件的 node_modules 上溯链完全相同（同一棵 vendor 树），所以解析结果一致。
const pkgDirOf = name => {
  let entry;
  try { entry = fileURLToPath(import.meta.resolve(name)); } catch { return null; }
  let d = dirname(entry);
  for (;;) {
    try { if (JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).name === name) return d; } catch { /* 继续上溯 */ }
    const up = dirname(d);
    if (up === d) return dirname(entry);
    d = up;
  }
};

console.log('\n=== PATH E: 闭包里 import react 的依赖逐个比对 ===');
const reactImporters = [];
const reactUse = [];
for (const name of [...new Set([...bareSpecifiers()].map(pkgNameOf))].sort()) {
  const dir = pkgDirOf(name);
  if (!dir) { console.log(`  (跳过) ${name}: 解析不到包目录`); continue; }
  if (!importsReact(dir)) continue;
  let reactFromPkg;
  try { reactFromPkg = realpathSync(createRequire(join(dir, 'noop.cjs')).resolve('react')); }
  catch (e) { reactFromPkg = `<解析失败 ${e.code}>`; }
  reactImporters.push(name);
  reactUse.push({ name, dir, reactFromPkg });
  console.log(`  ${name}\n      包目录: ${dir}\n      react -> ${reactFromPkg}`);
}
const reactMiss = reactUse.filter(u => u.reactFromPkg.toLowerCase() !== aceReactPath.toLowerCase());

const checks = [
  ['内核侧解析到的 react 是 v19（内核按 19.3.0 编译）', React.version.startsWith('19.')],
  ['path A paints all three strings', textA.includes('ace kernel probe') && textA.includes('left') && textA.includes('right')],
  ['path B emits all three strings', plain.includes('ace kernel probe') && plain.includes('left') && plain.includes('right')],
  ['path B opens synchronized update', raw.includes('\u001b[?2026h')],
  ['path B closes synchronized update', raw.includes('\u001b[?2026l')],
  ['react 单实例：ace 侧与内核侧解析到同一份文件', aceReactPath === kernelReactPath],
  ['react 单实例：ace React 与内核 React 是同一个对象', aceReact === React],
  ['react-reconciler 单实例：ace 侧与内核侧同一份文件', aceReconcilerPath === kernelReconcilerPath],
  ['带 useState 的组件经内核渲染不是空屏', !hookErr && hookText.includes('hooks-alive-7')],
  ['带 useInput 的组件经内核渲染拿到预期文本（不是空屏、不是 ERROR 屏）', !uiErr && uiText.includes('useinput-alive')],
  ['带 useInput 的组件经真机路径（render→App ErrorBoundary）不是 ERROR 屏', !uiInkErr && uiInkRaw.includes('useinput-alive') && !uiInkRaw.includes('ERROR')],
  ['PATH E 确实扫到 usehooks-ts（守卫本身没退化成空跑）', reactImporters.includes('usehooks-ts')],
  [`闭包里 import react 的包都解析到 ace 那份（${reactImporters.join(', ')}）`, reactImporters.length > 0 && reactMiss.length === 0],
];
console.log(`\nstdout bytes captured: ${raw.length}`);
console.log('ANSI head: ' + JSON.stringify(raw.slice(0, 90)));
console.log('\n=== VERDICT ===');
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
if (checks.some(([, ok]) => !ok)) {
  if (hookErr) console.error(`\n带 useState 的组件渲染失败：${hookErr.message}`);
  if (!hookErr && !uiText.includes('useinput-alive')) console.error(
    `\n带 useInput 的组件渲染结果不是预期文本（渲染成 ERROR 屏/空屏即为此陷阱的静默症状）。\n`
    + `  实际屏幕: ${JSON.stringify(uiErr ? String(uiErr.message) : uiText.trim())}`);
  if (!uiInkErr && (!uiInkRaw.includes('useinput-alive') || uiInkRaw.includes('ERROR'))) console.error(
    `\n真机路径（render → App ErrorBoundary）画出了 ERROR 屏 —— 输入框起不来就是这个症状。\n`
    + `  实际输出: ${JSON.stringify(uiInkRaw.replace(/\s+/g, ' ').trim().slice(0, 200))}`);
  if (reactMiss.length) console.error(
    '\n两份 React！下面这些包**自身 import react**，但解析到的不是 ace 那份：\n'
    + reactMiss.map(u => `  ${u.name}\n      包目录: ${u.dir}\n      它拿到: ${u.reactFromPkg}\n      ace 那份: ${aceReactPath}`).join('\n'));
  if (aceReactPath !== kernelReactPath || reactMiss.length || (uiErr === null && !uiText.includes('useinput-alive'))) console.error(
    '\n修：cd G:\\AI_Project\\ace\\frontend; npm install; node vendor\\dsh-ink\\setup-deps.mjs'
    + '\n（自身 import react 的包必须是 frontend/node_modules 里的真实目录，'
    + '绝不能在 vendor/dsh-ink/node_modules 里建 junction —— junction 会按 realpath 把它带回 dsh-tui 的第二份 React）');
  process.exit(1);
}
