// HooH 迁移：`@dsh-std/storage` 是 DSH 的插件标准（npm 上不存在，上游 vendor 也是空的）。
// 我们不迁插件宿主 ⇒ 这里再导出我们的空实现。
export * from '../../../hooh/stubs/dsh-std.js'
