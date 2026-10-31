// HooH 的应用入口：以 hooh 内核启动 dsh-TUI 本尊（host-entry 组合根）。
//
// 为什么不用 bin/dsh-tui.js：那个启动器按"已安装的 npm 包 + 宿主 dsh"的布局找
// 编译产物（lib/types/...）；我们的树直接跑 TS（tsx），源码入口就够了。
//
// 这里做四件事：
//   1) 内核钉 hooh —— 无人在场也绝不回落 DSH（DSH 的裁决链不是我们的）；
//   2) 声明这是显式 TUI 启动（非 TTY 时上游按 invalid-explicit-launch 大声报错）；
//   3) **品牌一次性归一**：`~/.dsh-tui/settings.json` 是 dsh-TUI 系安装共享的
//      用户层。从全局 dsh 迁来的那份带着 `minimal: true`（隐藏开屏大字/logo、
//      精简底栏）——那是 dsh-TUI 的口味，不是 HooH 的。只在文档带 `imported`
//      标记（= 一次性自动迁移的产物，用户没在这份文件上做过选择）时才翻转
//      这三个键，并留下 `hoohNormalized` 标记保证**只做一次**；用户此后在
//      /settings 里的任何改动我们都尊重。
//   4) argv 原样交给上游组合根（--resume / -- 续参等都按它的契约走）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { HOOH_UI_VERSION } from '../../hooh/version.js'

process.env.DSH_TUI_BACKEND ??= 'hooh'
process.env.DSH_TUI_HOST_ENTRY ??= '1'
// 内核版本 == 产品版本：只有 `hooh/version.ts` 一个源（机械校验要求它等于
// core/version.py）。此前这里也写死过 '1.1.0'，升到 1.2.0 后内核选择器里
// 报的仍是旧版本 —— 同一个产品不该有两个版本号。
process.env.HOOH_VERSION ??= HOOH_UI_VERSION
process.env.DSH_TUI_LAUNCHER_VERSION ??= process.env.HOOH_VERSION
// 品牌字体钉死：开屏大字不再按日期轮换（上游彩蛋），HooH 每天长一个样。
// `shadow`（ANSI Shadow）有厚度、认得出 O——实测 9 款里最好的一款；
// 用户仍可在 /settings 里换（settings 优先于这个缺省）。
process.env.DSH_TUI_SPLASH_FONT ??= 'shadow'

/** 品牌一次性归一（见上 3)：幂等，认 `hoohNormalized` 标记。 */
function normalizeBrandSettings(): void {
  const file = join(homedir(), '.dsh-tui', 'settings.json')
  if (!existsSync(file)) return
  let doc: { version?: number; values?: Record<string, unknown>; imported?: unknown; hoohNormalized?: boolean }
  try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch { return }
  if (doc?.version !== 1 || doc.hoohNormalized === true) return
  // `imported` 在场 = 这份用户层是一次自动迁移写的，不是用户逐项选的。
  if (doc.imported === undefined) { doc.hoohNormalized = true; write(file, doc); return }
  const values = (doc.values ?? {}) as Record<string, unknown>
  if (values.minimal === true) values.minimal = false        // 开屏大字/logo 回来
  if (values.whale === true) values.whale = false            // 上游像素鲸 → 关（HooH 不是 dsh-TUI）
  if (values.whaleGirl === true) values.whaleGirl = false    // 鲸鱼娘立绘 → 关（同上）
  doc.hoohNormalized = true
  write(file, doc)

  function write(path: string, document: unknown): void {
    try { writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8') } catch { /* 尽力而为：下次启动再试 */ }
  }
}

normalizeBrandSettings()
export {}
await import('../../dsh-adapter/host-entry.js')