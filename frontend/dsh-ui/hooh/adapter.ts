/**
 * **HooH 的适配层**（A 方案第 ③ 步的起点）—— 把 ace 的状态喂成这套 UI 的 props。
 *
 * 为什么要单独一层：迁入的树是**纯展示**的（`Launchpad` 收的全是数据 + 回调），
 * 它自己不知道 ace 的存在。这层就是"谁给数据"的答案：
 *
 *   ace 引擎（`--serve` 的 NDJSON：session/model_delta/tool_call/permission_request/final）
 *        ↓  这一层
 *   dsh-ui 的 props（query / actions / model / effort / preset / permission / …）
 *
 * **动作表用它们的逻辑、我们的状态**：`resolveLaunchpadActions(state)` 是上游写的
 * 状态机（哪一步该提示什么），我不重写它 —— 只把 ace 的快照按它的输入形状喂进去。
 * 这是"迁到我们自己这边"的正确姿势：**皮肤与状态机照抄，数据源换成我们的**。
 */

import { resolveLaunchpadActions, type LaunchpadAction } from '../components/launchpadActions.js'
import type { LaunchpadLayout } from '../components/launchpadLayout.js'

/** ace 侧能给首屏的东西（先只列首屏用得到的；引擎接上后再长）。 */
export interface AceSnapshot {
  /** `ai_code.version.__version__` */
  version: string
  /** 当前模型名（引擎的 `cfg.model` / `/model`） */
  model: string
  /** 权限档：readonly / write / full */
  permission: string
  /** 工作目录 */
  cwd: string
  /** git 分支（不在仓库里就空） */
  branch?: string | undefined
  /** 思考强度档位 */
  effort?: string | undefined
  /** 目标/预设名 */
  preset?: string | undefined
  /** 最近一条会话的首句（没有就不显示"接着上次"） */
  lastSessionTitle?: string | undefined
  /** 有没有后台任务在跑（ace 的队列/工具看板） */
  jobsRunning?: boolean
  /** 斜杠命令候选（`/` 补全用） */
  commands?: readonly string[]
  /** 首次启动（提示换成首启那句） */
  firstRun?: boolean
  /** 星标过没有（上游的 star 提示；ace 不弹就恒 true = 不提示） */
  starred?: boolean
}

/**
 * ace 快照 → 上游那台状态机要的输入。
 *
 * 四个字段里 `updateAvailable` 在 ace 没有对应物（我们没有自更新链路）⇒ 恒 false，
 * 而不是编一个"有更新"去骗用户点。
 */
export function actionState(snap: AceSnapshot): {
  lastSessionTitle?: string
  jobsRunning: boolean
  updateAvailable: boolean
  starDue: boolean
} {
  return {
    ...(snap.lastSessionTitle ? { lastSessionTitle: snap.lastSessionTitle } : {}),
    jobsRunning: snap.jobsRunning === true,
    updateAvailable: false,
    starDue: false,
  }
}

/** 首屏动作表：**用上游的状态机**，喂 ace 的状态。 */
export function launchpadActions(snap: AceSnapshot): readonly LaunchpadAction[] {
  return resolveLaunchpadActions(actionState(snap))
}

/** 首屏那一坨 props 里跟数据有关的部分（回调由入口文件给）。 */
export function launchpadData(snap: AceSnapshot): {
  whale: boolean
  whaleIdle: boolean
  whaleGirl: boolean
  starred: boolean
  firstRun: boolean
  actions: readonly LaunchpadAction[]
  model: string
  effort: string
  preset: string
  permission: string
  commands: readonly string[]
  cwd: string
  branch: string
  tuiVersion: string
  kernelVersion: string
  layout: LaunchpadLayout | undefined
} {
  return {
    // 鲸鱼：上游首屏那个像素吉祥物。HooH 迁过来先**关掉** —— 我们的吉祥物是
    // 噪声圆盘（`frontend/src/components/NoiseDisc.tsx`），接线时替换掉这一段。
    whale: false,
    whaleIdle: false,
    whaleGirl: false,
    starred: snap.starred !== false,
    firstRun: snap.firstRun === true,
    actions: launchpadActions(snap),
    model: snap.model,
    effort: snap.effort ?? 'max',
    preset: snap.preset ?? 'code',
    permission: snap.permission,
    commands: snap.commands ?? [],
    cwd: snap.cwd,
    branch: snap.branch ?? '',
    tuiVersion: snap.version,
    // 内核版本段：ace 没有"dsh 内核"，留空即不画（上游读不到就不画，同一条口径）
    kernelVersion: '',
    layout: undefined,
  }
}
