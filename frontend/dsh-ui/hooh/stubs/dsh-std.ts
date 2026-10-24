/**
 * `@dsh-std/*` 的**运行时空实现**（HooH 迁移）。
 *
 * 那 6 个包是 DSH 的**插件标准**（命令/消息/展示/存储的协议声明 + 宿主注册 API）。
 * 迁移到 ace 时**不迁插件宿主**（我们不分发 DSH 插件），所以：
 *   · 类型：`dsh-ui/_vendor/dsh-std/*` 里按符号写精确垫片（tsc 用）；
 *   · 运行时：就是这个文件 —— 全是能安全调用的空实现。
 *
 * **为什么不能只写类型**：`adapter/standard/*.ts` 在**运行时** import 它们
 * （`register(...)`、`ProtocolCatalog`…），只有类型的裸模块名在 Node 里解析不到
 * （`ERR_MODULE_NOT_FOUND`）。所以把那几处 import 改指到本文件。
 *
 * 空实现的语义：注册即忽略、校验即放行、投影即原样返回 —— 插件宿主不在场时
 * 这些调用本来也不会产生任何可见行为。
 */

/** 注册一类插件扩展点：忽略，返回一个空的注销函数（与上游返回 Disposer 同形状）。 */
export function register(..._args: unknown[]): () => void {
  return () => {}
}

/** 协议目录（上游是个集合对象）。空目录。 */
export const ProtocolCatalog: Record<string, unknown> = Object.freeze({})

/** 清单定义目录。空目录。 */
export const ManifestDefinitionCatalog: Record<string, unknown> = Object.freeze({})

/** 声明一个协议定义：原样返回（调用方只把它登记进目录，我们不做登记）。 */
export function defineProtocolDeclaration<T>(def: T): T {
  return def
}

/** 投影/解析清单：原样返回输入，认不出就返回 `undefined`（与上游"读不到就不画"同口径）。 */
export function projectManifest(value: unknown): unknown {
  return value
}

export function parseManifest(value: unknown): unknown {
  return value
}

/** 消息事件校验：插件宿主不在场 ⇒ 一律放行（返回 true）。 */
export function validateMessageEvent(..._args: unknown[]): boolean {
  return true
}

/** 存储侧校验（上游有 6 个 validate*）：同一条口径，放行。 */
export const validateGetInput = (..._a: unknown[]): boolean => true
export const validateGetOutput = (..._a: unknown[]): boolean => true
export const validateSetInput = (..._a: unknown[]): boolean => true
export const validateSetOutput = (..._a: unknown[]): boolean => true
export const validateDeleteInput = (..._a: unknown[]): boolean => true
export const validateDeleteOutput = (..._a: unknown[]): boolean => true
export const validateItem = (..._a: unknown[]): boolean => true
export const validateMessage = (..._a: unknown[]): boolean => true
