/**
 * Hooh 内核（HooH 引擎 = `ai_code.py --serve` 的 NDJSON 协议）的静态声明
 * （P0 manifest；字段语义见 `src/agent/backend-manifest.ts`）。
 *
 * 纯数据、零 import：构建期索引在每次启动都静态 import 本模块（纯 DSH 的
 * 启动也一样）。`backendExport` 指向 `index.ts` 的唯一入口。
 *
 * 为什么 HooH 是一个内核而不是一层壳：dsh-TUI 0.17 的多内核架构（P0）里，
 * "新增一个内核 = 新建 `src/backends/<id>/`，其余不改"。ace 引擎与官方 DSH、
 * Claude、Codex 同级——它有自己的权限裁决、快照与审计；TUI 只是把这套
 * 内核的会话画出来。这也正是 HooH 的架构主张：模型提出、代码裁决；
 * 界面再漂亮，裁决永远在引擎那侧。
 *
 * `capabilities` 是本内核的会话真正会应答的面的并集：
 * `session.ts` 组装的 capabilities（permissions/questions/models/effort/
 * commands/workingActivity/diagnostics）加上事件面实际发的（transcript 的
 * `record()` 只回放本进程内看到的事件）。声明不是承诺可用（成员可缺）；
 * 宿主把它读作"可能应答"，供准入陈述。
 */
import type { BackendManifest } from '../../agent/backend-manifest.js'

export const manifest: BackendManifest = {
  id: 'hooh',
  label: { kind: 'key', key: 'kernel-label-hooh' },
  shortLabel: 'HooH',
  product: 'hooh-agent',
  inTree: true,
  backendExport: 'hoohBackend',
  vendorPackages: [],
  capabilities: [
    'permissions', 'questions', 'models', 'effort', 'commands',
    'workingActivity', 'diagnostics', 'transcript',
  ],
  grants: [],
}
