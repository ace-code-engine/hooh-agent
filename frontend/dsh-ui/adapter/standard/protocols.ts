// HooH 迁移：`@dsh-std/*`（插件标准）**只迁类型**，不迁运行时 ——
// 这里改指 `hooh/stubs/dsh-std.js` 的空实现（我们不分发 DSH 插件）。
/**
 * Canonical re-export surface for dsh-std public protocol packages.
 *
 * This is the only place in the new adapter where dsh-std runtime/type APIs
 * are re-exported for the legacy adapter layer. Consumer modules that still
 * live in `src/dsh-adapter/` during incremental migration should import from
 * here instead of importing `@dsh-std/*` directly.
 */

export { parseManifest, projectManifest } from '../../hooh/stubs/dsh-std.js'
export { validateMessageEvent } from '../../hooh/stubs/dsh-std.js'
export {
  validateDeleteInput,
  validateDeleteOutput,
  validateGetInput,
  validateGetOutput,
  validateSetInput,
  validateSetOutput,
} from '../../hooh/stubs/dsh-std.js'
