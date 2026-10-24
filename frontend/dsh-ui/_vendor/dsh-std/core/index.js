// HooH 迁移：`@dsh-std/core` 是 DSH 的插件标准（npm 上没有，上游 vendor 也是空的）。
// 我们不迁插件宿主（不分发 DSH 插件），所以这里给一个「点名即有」的空实现：
// 可调用、可索引、可 new —— 这些调用点都只是注册/声明，宿主不在场时本就没有可见行为。
const __noop = new Proxy(function () {}, {
  get: (_t, k) => (k === 'then' ? undefined : __noop),
  apply: () => __noop,
  construct: () => __noop,
})

export const ApiReference = __noop
export const ProtocolCatalog = __noop
export const ProtocolDefinition = __noop
