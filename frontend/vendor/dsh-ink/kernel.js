/**
 * vendored 内核（dsh-ink）的**运行时公开入口** —— 换内核后 `src/**` 统一从这里 import。
 *
 * 为什么要有这个文件（而不是让 src 直接深路径 import）：
 *   1. 内核是编译产物（135 个 `.js`，零 `.d.ts`），TS 直接深路径 import 报 `TS7016`；
 *      相邻的 `kernel.d.ts` 只给这**一个**入口补类型，vendor 里的 135 个 `.js` 一个字节不动。
 *   2. 一句话定死 specifier，随后四路写手照抄即可。
 *
 * ⚠️ **大小写不是笔误，必须照抄**：Windows 上 `Box.js` 与 `box.js` 是同一个文件，
 * 但 Node 的 ESM 缓存**按 specifier 字符串**记模块 —— 同一个 `.js` 写两种大小写就是
 * **两个模块实例**（实测 `TerminalSizeContext` 两条路径拿到的是两个不同的 context 对象，
 * Provider 就白包了，`useTerminalSize()` 当场抛"must be used within an Ink App component"）。
 * 所以下面凡内核自己也 import 的文件，一律**沿用内核内部的写法**（首字母大写）：
 *   `Box.js`（内核 6 处这么写）/ `Text.js` / `TerminalSizeContext.js`。
 * 其余文件内核内部无人引用，按磁盘真实名字（小写）。
 *
 * 依赖前置（缺一不可，见 `.recon/S1-switch-foundation.md` 接口 A）：
 *   1. `node frontend/vendor/dsh-ink/setup-deps.mjs` —— 建 `vendor/dsh-ink/node_modules/` 的 junction；
 *   2. `vendor/dsh-ink/node_modules/{react,react-reconciler}` **必须指到 ace 的 `frontend/node_modules`**
 *      （不是 dsh-tui 那份）。否则核实用 dsh-tui 的 React、`src/**` 用 ace 的 React ——
 *      两份 React 19 的元素能互认，但 **hook 不行**：src 组件一调 `useState` 就
 *      "Invalid hook call"，屏幕静默变空。见报告里的实测。
 */
export { default as Box } from './lib/types/ink/components/Box.js';
export { default as Text } from './lib/types/ink/components/Text.js';
export { default as ScrollBox } from './lib/types/ink/components/scrollbox.js';
export { AlternateScreen } from './lib/types/ink/components/alternatescreen.js';
export { TerminalSizeContext } from './lib/types/ink/components/TerminalSizeContext.js';

export { default as useInput } from './lib/types/ink/hooks/use-input.js';
export { default as useApp } from './lib/types/ink/hooks/use-app.js';
export { useTerminalSize } from './lib/types/ink/hooks/use-terminal-size.js';

export { default as render, renderSync, createRoot } from './lib/types/ink/root.js';
export { renderToScreen } from './lib/types/ink/render-to-screen.js';
export { cellAtIndex } from './lib/types/ink/screen.js';
