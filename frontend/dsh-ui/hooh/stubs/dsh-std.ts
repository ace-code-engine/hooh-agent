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

/**
 * 0.17.0：`adapter/standard/` 把这两个目录当**类**用（`new ProtocolCatalog({...})`、
 * 类型位 `protocols: ProtocolCatalog`），所以桩从常量对象升级成空壳类 ——
 * 实例行为就是空集合：能查的方法都按"插件宿主不在场"如实作答（查不到/不认识/不谈判）。
 */
export class ProtocolCatalog {
  constructor(..._args: unknown[]) {}
  /** 上游按坐标查协议定义：桩里永远查不到（返回 any：类型从宽是桩的既定口径）。 */
  resolve(..._args: unknown[]): any {
    return undefined
  }
  /** 上游的准入谈判：无插件宿主 ⇒ 无从谈判（调用方按未注册处理）。 */
  negotiate(..._args: unknown[]): any {
    return undefined
  }
  /** 上游问"这个协议你认识吗"：桩里一律不认识。 */
  understands(..._args: unknown[]): boolean {
    return false
  }
  [key: string]: any
}

export class ManifestDefinitionCatalog {
  constructor(..._args: unknown[]) {}
  /** 上游按贡献类型取清单定义：桩里没有登记 ⇒ undefined（"读不到就不画"口径）。 */
  extension(..._args: unknown[]): any {
    return undefined
  }
  [key: string]: any
}

/** 插件清单的最小结构类型（0.17.0 `adapter/standard/types.ts` 与
 *  `negotiate/validate` 的取用面；深层结构 any —— 准入路径在 HooH 不跑，
 *  类型从宽同 `_vendor` 垫片口径）。 */
export interface PluginManifest {
  readonly id: string
  readonly package?: unknown
  readonly facets: { readonly host: { readonly apiVersion: string } }
  readonly requires: { readonly contracts: any[] }
  readonly subscriptions: any[]
  readonly permissions: any[]
  readonly contributes: { readonly commands: any[] }
  readonly [key: string]: any
}

/** 组件清单（上游由 @dsh-std/manifest 解析冻结；桩里给最小结构）。 */
export type ComponentManifest = PluginManifest

/** 声明一个协议定义：原样返回（调用方只把它登记进目录，我们不做登记）。 */
export function defineProtocolDeclaration<T>(def: T): T {
  return def
}

/** 投影/解析清单：原样返回输入，认不出就返回 `undefined`（与上游"读不到就不画"同口径）。
 *  返回 any：0.17.0 的 negotiate/validate 直接在投影结果上取 `.contracts`/`.host`，
 *  桩的类型从宽（同 `_vendor` 垫片 any 口径），不在准入这条不跑的路径上追类型。 */
export function projectManifest(value: unknown): any {
  return value
}

export function parseManifest(value: unknown): any {
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
