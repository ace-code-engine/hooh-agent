/**
 * vendored 内核的**运行时**入口。
 *
 * 单独一个 `.js` 转口，是因为内核是编译产物（`vendor/dsh-ink/lib/types/ink/**.js`）
 * 且 **vendor 只读**、没有 `.d.ts`：TS 直接 import 会报 TS7016（隐式 any）。
 * 相邻的 `kernel.d.ts` 补上这层类型，`screen.ts` 就能干净地 import './kernel.js'。
 *
 * 前置：`vendor/dsh-ink/node_modules/` 的依赖链接必须先建好一次（见 vendor README）：
 *   node frontend/vendor/dsh-ink/setup-deps.mjs
 */
export { renderToScreen } from '../../vendor/dsh-ink/lib/types/ink/render-to-screen.js';
export { cellAtIndex } from '../../vendor/dsh-ink/lib/types/ink/screen.js';
// 内核渲染器吃的就是这一份 React（19）。测试要建"内核认得的"元素树就得用它。
export { createElement, version } from '../../vendor/dsh-ink/node_modules/react/index.js';
// 内核自己的 Box/Text —— 今天 ace 的 src 还没搬过去，自检/骨架用它们建树。
export { default as Box } from '../../vendor/dsh-ink/lib/types/ink/components/Box.js';
export { default as Text } from '../../vendor/dsh-ink/lib/types/ink/components/Text.js';
