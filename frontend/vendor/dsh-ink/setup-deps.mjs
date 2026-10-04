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
import { symlinkSync, existsSync, mkdirSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UPSTREAM = process.env.DSH_TUI_PKG
  || 'C:/Users/69215/AppData/Roaming/npm/node_modules/@deepseek-harness-tui/dsh-tui';
const UP_NM = join(UPSTREAM, 'node_modules');
const DEST_NM = join(HERE, 'node_modules');

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
let made = 0, kept = 0;
const bad = [];

for (const [name, want] of Object.entries(PINS)) {
  const target = join(UP_NM, name);
  const link = join(DEST_NM, name);
  if (!existsSync(target)) { bad.push(`${name}: not installed at ${target}`); continue; }
  const have = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version;
  if (have !== want) bad.push(`${name}: pinned ${want}, found ${have}`);

  mkdirSync(dirname(link), { recursive: true });
  if (existsSync(link) || (lstatSync(link, { throwIfNoEntry: false }) ?? false)) { kept++; continue; }
  symlinkSync(target, link, 'junction');
  made++;
}

console.log(`setup-deps: ${made} junctions created, ${kept} already present, ${Object.keys(PINS).length} pinned`);
if (bad.length) { console.error('MISMATCH/ABSENT:\n  ' + bad.join('\n  ')); process.exit(2); }
// resolve-through sanity check (proves the junction is live, not a stale copy)
for (const n of ['react', 'react-reconciler', 'chalk']) {
  console.log(`  ${n} -> ${realpathSync(join(DEST_NM, n))}`);
}
