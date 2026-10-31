# dsh-TUI UI 树 → HooH（A 方案：**迁到我们自己这边，不是去调它**）

> 目标：`ace` 打开的**就是这套界面**，UI 代码住在我们仓库里，数据来自 ace 自己的引擎。
> 不是 B（B 是反过来的：让 dsh-tui 那个外部程序去调 ace 的端点 —— 已实现，见
> `docs/design/DSH-TUI-BRIDGE.md`，但那不满足"迁到我们自己上面"）。

## 2026-10-31 re-vendor 到上游 v0.17.0（源码整树）

用户拿到 **dsh-TUI v0.17.0 完整源码**（GitHub main 分支 zip，3402 项），照
`docs/design/DSH-SHELL-TRACKING.md` §一 的流程整树重迁：

| 事项 | 结果 |
| --- | --- |
| 基线 | `frontend/dsh-ui/` 从 v0.12 时代（949 文件）→ **v0.17.0**（src 1814 文件 + tui-profile/protocols 覆盖） |
| 保留区 | `hooh/` 适配层、`_vendor/` 垫片、`tui-profile/`、`tsconfig.json`、本文件 —— 全部不动 |
| HooH 覆盖重放 | ① `adapter/standard/{negotiate,protocols,tui-extension,types,validate}.ts` 的 `@dsh-std/*` 运行时 import 改指 `hooh/stubs/dsh-std.js`；② `components/activityFrames.ts` 顶掉 `dsh-working-activity`（数据源接 `frontend/src/render/spinner.ts`）；③ 品牌三处：`branding.ts` 的 `BRAND_SPLASH_WORDS`（deepseek 档 → `HooH`）、`splashFonts.ts` 的 `TOP_WORD/BOTTOM_WORD`、`LogoV2.tsx` 词标 `✦ HooH`、`screens/Launchpad.tsx` 铭牌 `HooH v…` |
| 桩升级 | `hooh/stubs/dsh-std.ts`：`ProtocolCatalog`/`ManifestDefinitionCatalog` 从常量对象升级为空壳类（0.17 的 `adapter/standard/` 对它们 `new` + 方法调用）；`PluginManifest`/`ComponentManifest` 按新取用面补结构类型；投影函数返回 any（同 `_vendor` 垫片从宽口径） |
| 适配层升级 | `hooh/adapter.ts`：`AceSnapshot.commands` 从 `{name,description}[]` 升为上游 **`CommandCompletion`** 形状（新树 palette 要求 `replacement`/`commandLine`）；`hooh/entry.tsx` 适配 `render()` 返回 `Promise<Instance>`（`await app` 后再 `waitUntilExit()`）；`hooh/App.tsx` 错误边界色键 `red/gray` → `error/inactive`（0.17 的 ThemedText 只认主题键） |
| 依赖 | **零新增 npm 包**：运行时闭包（从 hooh 六入口追踪，1221 文件）所需包 node_modules 全有；`sixel`/`sharp` 只在图片渲染 Worker 里真正加载（与 0.12 相同）；`zod` 的唯一用户 `dsh-adapter/plugin.ts` 无上游消费者；`@anthropic-ai/claude-agent-sdk` 全是 type-only |
| 门禁 | vitest **57 文件 / 692 条全绿**（与基线逐条对齐）；dsh-ui 树 tsc 119 条（旧树基线 83，同源第三方类型噪声，见"为什么不追"）；`npm run build` 错误集合与 HEAD **逐条 IDENTICAL**（53 条，全是 test/ 引入 dsh-ui 的迁移自带边界）；ink 渲染探针（假 stdio）与真入口（`ACE_MOCK=1`）8–12 秒全程存活 |
| **自退出缺陷** | **不再复现**。v0.12 树挂载后 ~370ms 无声退出；v0.17 树同环境（管道 stdin / 继承 stdin / winpty 伪 TTY）均持续存活。候选修复点：新内核 `componentDidCatch` 的 nested-update 溢出恢复（不再直接退场）、unmount 的 `shutdownInput` 输入所有权闸门、`wrappedRender` 首帧微任务边界。**待真终端复验后**，DSH-SHELL-TRACKING 的「回退默认入口」可重评 |

## 现在的状态

| 步骤 | 状态 |
| --- | --- |
| ① **整棵树搬进来** | ✅ `frontend/dsh-ui/`：**v0.17.0**（src 1814 个 TS/TSX + `tui-profile/protocols` + `_vendor/*`） |
| ② **模块解析全部干净** | ✅ **`找不到的模块 = []`**（原 49 个缺模块，全部由**仓库内**的 vendor 类型 + 精确垫片解决） |
| ② 残余类型错 | v0.12 时 55 个 → v0.17.0 树 119 个，**全是第三方代码的类型等式噪声**（树大了 3 倍；见下"为什么不追"） |
| ③ **接口垫层 + 第一屏跑起来** | ✅ Launchpad 已渲染；**Chat 那条链端到端通了**；**常驻聊天页已接**（见下） |
| ③ 其余屏（Settings / SessionTree / 面板…）与上游那个 `Chat`（要 `channel: Channel`） | ⬜ 未开始 |
| ④ **入口切换**（`ace` 起这套 UI） | ✅ **`ace ui [一句话]`**（真入口 = 常驻引擎 + 迁入的界面） |

## 第 ③/④ 步：现在已经是一个能用的界面了

```
ace ui                      # 起常驻界面：首屏（Launchpad）→ 打字 → 转录页
ace ui "现在几点了"          # 起来就先发一句
```

数据流（**没有一步是外部程序**）：

```
ace 引擎（`ai_code.py --serve`，**常驻**一个进程 = 一条会话）
  ↓ hooh/engine.ts  AceEngine：起进程 / 握手 / turn(text) → 事件
  ↓ hooh/engine.ts  rowsFromEvents()：事件 → 上游的行模型
      · user_message → kind:'user'      · final     → kind:'assistant'
      · tool_call    → kind:'tool'（ToolRow：name/argsText/status:'running'）
      · tool_result  → 回填同一张卡（status ok/error · resultText · durationMs）
      · notice       → kind:'notice'
  ↓ 上游 `MessageList`（一行没改）：`❯ 提问` / `• Datetime_now({})` / `● 回答`
```

无头验（三个 smoke 都进我们的门禁）：

| 脚本 | 验什么 |
| --- | --- |
| `hooh/smoke.tsx` | 迁入的 Launchpad 用我们的 `AceSnapshot` 画出来 |
| `hooh/smoke-chat.tsx` | 真引擎一轮 → 上游投影器 → `MessageList` |
| `hooh/smoke-app.tsx` | 常驻 App：一轮之后转录里有**提问 + 工具卡 + 回答** |
| `hooh/smoke-entry.tsx` | 入口两页都画得出来（首屏 / 转录页） |

**踩到的坑**：`EngineOptions.mock` 的默认值一开始写成"不传就 mock"，真入口会静默走离线剧本 ——
改成 `mock === true` 才加 `--mock`（真入口默认真模型，只有测试/演示才 mock）。

## 第 ③ 步：端到端已经通了（可验证）

```
真 ace 引擎（`ai_code.py --serve`，真进程）
     ↓  hooh/engine.ts：起进程 / 发 user.message / 收 NDJSON 事件
     ↓  hooh/engine.ts 的 toDshEvents()：**两套词表的词典**（user_message→user/message、final→assistant/message…）
     ↓  上游 `projectDshSessionEventsToSnapshots()`（一行没改）
     ↓  上游 `MessageList`（一行没改）
画面上：  ❯ 用一句话说明这个工作区是干什么的
          ● 当前时间是 2026-10-13 06:51:40
```

两条门禁（都在 `frontend/test/`，进我们的 CI）：

| 测试 | 守什么 |
| --- | --- |
| `dsh-ui-smoke.test.ts`（4 条） | 迁入的 UI **画得出来**，且画面数据是我们的（模型/权限/目录/动作表/品牌） |
| `dsh-ui-engine.test.ts`（3 条） | **接线**：引擎真起进程真出事件、`user/message` 映射通、回答被上游组件画出来 |

## 接这一层时替掉/补上的外部件（都在我们仓库里）

| 外部件 | 处置 |
| --- | --- |
| `dsh-working-activity`（活动指示器插件） | **顶掉**：`components/activityFrames.ts` 改成取**我们的**帧表（`src/render/spinner.ts`，单一真源），导出名与形状不变 |
| `@dsh-std/*`（插件标准 6 个包） | **只迁类型**（`_vendor/dsh-std` 精确垫片）；运行时改指 `hooh/stubs/dsh-std.ts` 的空实现；并且做成 `file:` 依赖的**桩包**（`_vendor/dsh-std/<name>`，可复现，不靠手工塞 node_modules） |
| `#tui-profile/*`（上游 package.json 的 imports 别名） | 加进 `frontend/package.json` 的 `imports` |
| `signal-exit` | 装 v4（它们的 `ink/ink.tsx` 要 `onExit`） |

## 第 ③ 步已经做到的（可验证）

```
frontend/dsh-ui/hooh/adapter.ts   ace 快照 → Launchpad props（**动作表用上游的状态机** `resolveLaunchpadActions`，喂我们的状态）
frontend/dsh-ui/hooh/smoke.tsx    无头渲染（假 stdio 喂**它们自己的**渲染器），打印帧
frontend/test/dsh-ui-smoke.test.ts  把上面那条**纳入我们的门禁**（4 条断言）
```

渲出来的首屏（宽 100，数据全是我们的）：

```
                    ███   ██▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄███   ██          ← 大字 HooH（它们的块字字体）
              ╭──────────────────────────────────────────╮
              │ ❯ 说点什么，或输入 / 看命令…               │
              ╰──────────────────────────────────────────╯
                deepseek-v4-flash  ·  Max  ·  code  ·  readonly   ← 我们的 AceSnapshot
                     继续「把 dsh-TUI 的 U…」  会话与工作区  设置  帮助  ← 上游状态机 + 我们的会话标题
                          ● Tips：输入 / 看全部命令，/setup 可随时重跑引导
G:\AI_Project\ace                                        HooH v1.1.0
```

品牌三处已在我们自己的副本里改掉（不必再去打补丁装好的包）：
`components/splashFonts.ts` 的 `TOP_WORD/BOTTOM_WORD` → `HooH` / 空；
`components/LogoV2.tsx` 的 `✦ dsh-TUI` 与纯文字档；`screens/Launchpad.tsx` 右下角 `dsh-tui v…` → `HooH v…`。

**踩到的第一个运行时坑**：它们的 `ink/ink.tsx` 要 `signal-exit` v4 的 `onExit`，我们这边是 v3
（`npm i signal-exit@^4.1.0` 解决）；另外无头渲染时假 stdin **必须继承 `EventEmitter`**
（它们的 App 用 `addListener('readable')`）。

**故意不并进 `frontend/tsconfig.json`**（它只 include `src/test/tools`）：这棵树是"在建工程"，
让它把 ace 现有的 tsc/vitest 弄红是反的。它有自己的 `dsh-ui/tsconfig.json`。

## 依赖是怎么解决的（全部落在仓库内，可移植）

| 类别 | 做法 | 体积 |
| --- | --- | --- |
| 24 个 `@deepseek-ai/*` 平台包 | 从本机全局 dsh 安装**只拷 `.d.ts` + `package.json`** 到 `_vendor/platform/` | 142 文件 / 0.7 MB |
| `dsh-working-activity` / `sharp` / `sixel` / `lovely-mermaid` | 同样只借类型（本机 dsh profile 里装着）| 58 个类型文件 |
| `@dsh-std/*`（6 个模块） | **精确垫片**：脚本扫全树取出真正 import 的符号，逐名 `export type X = any` / `export declare const X: any` | 21 个符号 |
| `#tui-profile/*` / `@dsh-tui-vendor/*` | `paths` 指向已搬入的 `tui-profile/protocols` / `_vendor/mathjax-tex-svg` | — |
| 真 npm 包（`marked` / `diff` / `yaml` / `highlight.js` / `lodash-es` / `figures` / `semver` / `supports-hyperlinks` / `bidi-js` / `cli-highlight`） | 真装（`npm install`） | — |

### 0.17.0 追加：`ace app`（整壳）的**运行时**平台依赖

类型垫片只够 tsc；整壳要**真的跑起来**（cordis 组合根、`dsh-adapter/*` 的值
import），启动路径上静态 import 的 `@deepseek-ai/*` 平台包必须在运行时可解析。
做法：`dsh-ui/node_modules/` 里对本机全局 dsh 安装（`npm root -g` 下的
`@deepseek-ai/dsh/node_modules/*`，0.2.1-rc.x 家族）**逐包建 junction**（cordis
生态必须单实例——全进程共用同一份），另加 `dsh-working-activity`（0.5.x，
取自全局 dsh-tui 的依赖）。**这是本机一次性装配，不入库**——新克隆要跑
`ace app` 需先装好官方 dsh（`npm i -g @deepseek-ai/dsh`），然后：

```powershell
$g = "$(npm root -g)\@deepseek-ai\dsh\node_modules"
$nm = "frontend\dsh-ui\node_modules"; mkdir $nm -Force | Out-Null
Get-ChildItem $g -Directory | ForEach-Object {
  if (-not (Test-Path "$nm\$($_.Name)")) { New-Item -ItemType Junction -Path "$nm\$($_.Name)" -Target $_.FullName | Out-Null }
}
# dsh-working-activity（上游 TUI 的活动指示插件，被我们顶掉数据源但类型/帧表仍引用）
$tui = "$(npm root -g)\@deepseek-harness-tui\dsh-tui\node_modules\dsh-working-activity"
if (-not (Test-Path "$nm\dsh-working-activity")) { New-Item -ItemType Junction -Path "$nm\dsh-working-activity" -Target $tui | Out-Null }
```

两点纪律：**cordis 单实例**（junction 共用全局那份，绝不能 npm 再装一份进树）；
`dsh-ui/tsconfig.json` 的 paths **不得**把有运行时实体的包映射到纯 `.d.ts`
（tsx 运行时也吃 paths，会把真 import 解析到没有 JS 的类型文件上——实测
`FEATURE_FLAGS is not provided` 就是这么来的）。`sharp` / `sixel` /
`lovely-mermaid` 只有图片 Worker 懒加载才需要，纯类型垫片即可，不必 junction。

## 为什么不追那 55 个类型错（刻意的决定）

它们是**第三方代码在"类型子集"下**的类型等式差异：上游在自己完整的依赖图里能过，
我们只 vendor 了 `.d.ts`，于是像 `BalanceResult.reason`、`MountReservationResult` 这类
跨包类型在我们这边长得和上游不同。**追平它们没有价值，而且有害**：

- 价值低：那是上游的代码，不是我们的接线；类型对不对由**运行**来验（下一步就是跑起来）。
- 有害：为了让它们过，我们要么改上游代码（从此不能跟上游更新），要么把类型放宽到 `any`
  （等于放弃类型）。

所以本树的定位是：**迁入的第三方代码，不做 tsc 门禁，靠 `tsx` 直接跑**（`tsx` 是
transpile-only，不做类型检查）。**门禁在 `frontend/src/` 里我们自己写的适配层上** ——
那边走严格 tsconfig、跑 vitest、进 CI。

## 第 ③ 步要实现的接口（这就是"平台"）

| 接口 | 谁在用 | 我们要喂什么 |
| --- | --- | --- |
| `@deepseek-ai/dsh-session` | session 投影、转录 | ace 的 `session` 事件流（`user_message`/`tool_call`/`final`） |
| `@deepseek-ai/dsh-llm` + `dsh-llm-pi-ai` | 模型选择、流式 | ace 的模型配置与 `model_delta` |
| `@deepseek-ai/dsh-commands` | 斜杠命令树 | ace 的 `COMMANDS` + 自定义命令 |
| `@deepseek-ai/dsh-user-questions` / `dsh-user-approval` | 提问 / 审批面板 | ace 的 `permission_request` / `choice_request`（已有 `QuestionPump`） |
| `@deepseek-ai/dsh-settings` / `schemastery` | `/settings` 面板 | ace 的 `cfg` + `ace_theme` |
| `@deepseek-ai/cordis` | 插件宿主 | **不实现**：用一个几十行的 EventEmitter 替掉（我们不分发插件） |
| `dsh-working-activity` | 活动指示器 | **顶掉**：`ui/ace_spinner` + `ui/ace_noise_circle` 已经做完了同一件事 |

## 两条硬规矩

1. **不要**用 `declare module 'X';` 这种 shorthand 垫片 —— 实测把 403 变成 751
   （690 个 TS2709「命名空间当类型用」）。要嘛借真 `.d.ts`，要嘛按符号写精确垫片。
2. 平台的 `.d.ts` 是**借来的类型**，不是运行时。运行时（谁在什么时候发什么事件）由
   第 ③ 步我们自己接 —— 类型过了不等于跑得起来。
