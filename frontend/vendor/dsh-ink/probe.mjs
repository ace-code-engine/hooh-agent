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
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
const checks = [
  ['react resolved from ./node_modules is v19 (not ace frontend/node_modules v18)', React.version.startsWith('19.')],
  ['path A paints all three strings', textA.includes('ace kernel probe') && textA.includes('left') && textA.includes('right')],
  ['path B emits all three strings', plain.includes('ace kernel probe') && plain.includes('left') && plain.includes('right')],
  ['path B opens synchronized update', raw.includes('\u001b[?2026h')],
  ['path B closes synchronized update', raw.includes('\u001b[?2026l')],
];
console.log(`\nstdout bytes captured: ${raw.length}`);
console.log('ANSI head: ' + JSON.stringify(raw.slice(0, 90)));
console.log('\n=== VERDICT ===');
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
