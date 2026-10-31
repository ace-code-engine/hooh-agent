# WP-DSH-SHELL · 迁入壳转正 + 上游版本跟进 —— 立项卡

> 状态:**实现中**(2026-10-24 立项)。
> 用户裁决:迁入的 dsh-TUI 壳(`frontend/dsh-ui`)从 2026-10-24 起是**主外壳**
> (plain `ace` = 它),渲染与工具表达以它为准;瑞士规范前端降为 `ace classic`
> 显式备用。上游(dsh-tui npm 包)版本跟进了之后,把用户要的工具表达继续抄进来。

## 〇、现状盘点(2026-10-24)

- 迁入树基线 ≈ 上游 **v0.12.0** 时代(`dsh-ui-smoke` 的版本自检打出来过
  "profile is already v0.16.1; this launcher copy is v0.12.0");npm 全局装的
  上游是 **v0.16.1**——**树落后上游 4 个 minor**。
- 壳的接线(本卡第一批,已落地):流式(`model_delta` 接流式助手行)、
  命令路由(`/x` 走 `command.exec`)、审批弹窗(`permission.answer` +
  persist 语义与 ace 前端同契约)、`choice_request` 如实自动取消。
- **已知没喂到上游渲染管线的**(工具表达的缺口清单,按用户感知排序):
  1. `ToolRow.resultView` / `smoothStreaming`——工具结果的富视图(diff/结构化)
     未投影,现在只有 `resultText` 纯文本;
  2. `SubagentRow` / `JobGroupRow`——subagent 与后台任务组的行模型未喂;
  3. `components/questions/`(AskUserQuestionPanel / PlanReviewPanel)——
     `choice_request` 现在是自动取消,该接真面板;
  4. Settings / SessionTree / Pane 浮层——第③步未完成项(`MIGRATION.md`);
  5. Launchpad 的鲸鱼/鲸鱼娘资产——ace 侧关着,决定要不要换成 HooH 资产。

## 一、版本跟进流程(每季度或用户点名时)

1. **对照**:`npm view @deepseek-harness-tui/dsh-tui version` vs `MIGRATION.md`
   里记录的 vendored 基线版本;
2. **re-vendor**:照 `frontend/dsh-ui/MIGRATION.md` 的迁入流程,把上游新版树
   拷进 `frontend/dsh-ui/`,**hooh/ 适配层(`adapter.ts` / `engine.ts` /
   `App.tsx` / `PermissionDialog.tsx`)不动**——接口变化在适配层消化;
3. **词典核对**:`engine.ts` 的行投影与事件映射跑一遍 smoke
   (`test/dsh-shell.test.ts` + `test/dsh-ui-smoke.test.ts`);
4. **挑工具表达**:对照本卡缺口清单,把用户点名的新渲染接上(改 `rowsFromEvents`
   的投影,不改上游组件);
5. 冒烟:`ace ui` 首屏 → 一轮真跑 → 工具卡可见。

## 二、硬边界

- 上游树**零字节修改**的纪律仅在 vendoring 那一刻成立;hooh/ 适配层是**我们的**,
  随便改;
- ace 引擎语义(权限/快照/审计)**永远**不因 UI 迁就而上移;
- 审批契约与 ace 前端保持同三态 + persist(`test/dsh-shell.test.ts` 钉住);
- 经典前端(`ace classic`)只修 bug,不再加功能(它是备胎,不是第二战线)。

## 三、进度日志

- 2026-10-24 立项:壳转正为默认入口(ace.cmd 重写分发:plain ace = dsh 壳,
  `ace classic` = 瑞士规范前端,均带失败留窗);补齐流式/命令/审批三根线;
  `engine.ts` 默认权限档对齐交互产品(write)。tsc 存量 80 行报错是迁移
  自带的"tsc 边界"(MIGRATION.md),本卡不背新债(改动后 79 行)。
- 2026-10-24 第二批(用户实测"点不了任何东西"):首屏接线是迁移遗留的
  **全空函数**——onAction/onCommandPick/onParamPick/onOpenWorkspace 全是
  `() => {}`,点击被静默吞掉。本轮接活:动作表按词表映射到 ace 命令
  (continue→/resume、settings→/config、jobs→/tasks、help→/help;没有
  对应物的动作如实进 notice),参数段铭牌(模型/强度/预设/权限)点击打开
  对应命令,命令候选点击直接执行,工作区名牌如实告知未接入。已知残留:
  命令候选表还是 entry 里硬编码的六条,待接 initialize 握手的 commands。
- 2026-10-24 第五批(用户澄清定位):壳的归属与调用源最终敲定——**壳源码整个
  vendored 在本仓(frontend/dsh-ui,上游 MIT),plain ace = 调本仓这份壳,
  绝不调全局 npm 的 dsh-tui**;归属在 THIRD-PARTY-NOTICES/双 README/
  LICENSE.upstream/MIGRATION.md 四处说清。用户实测两问题当场修:
  ①设置点不了 → 审批/选择弹窗选项接鼠标(内核 hit-test 本来就通,是弹窗
  选项没挂 onClick);②贼卡 → 流式节流(每条 model_delta 全量重投影+全树
  重渲染是主因,改 100ms 合帧、收尾 flush)。另有 App 层与上游首屏的
  双份输入冲突已修(首屏打字权归还上游输入处理)。启动器恢复 dsh 壳默认
  (上一轮的回退作废),classic = ace classic。
- 2026-10-24 第四批(用户实测"卡死在 /help 首屏"):**命令路径没挂监听**——
  /help 等命令的可见输出全部以 notice 事件回流,而 engine.command() 不挂
  listener,输出进不了投影 → 行永不增长 → 永远停在首屏。修复:command 挂
  listener(onEvent → 重投影)+ 读取 resp 的 keep_going(/exit 生效)。
  另:busy 时 Esc/Ctrl+C 可中断挂起轮次(session.interrupt + 本地解锁),
  进程退出时引擎子进程跟随关闭(孤儿防护)。winpty 探针里观察到的引擎
  code=null 退出经二分判定为探针自身 kill 的 job 树连带(纯管道同参数
  引擎全程存活),非产品缺陷;真控制台若复现,死亡提示会带 stderr 尾部。
- 2026-10-24 第三批续(用户实测"说话没任何回应"):第二层根因——壳把项目根
  取成 `process.cwd()`(ace.cmd pushd frontend 后 = frontend,相对路径),
  引擎 spawn 的 cwd 变成 frontend/frontend(不存在)→ 异步 ENOENT →
  AceEngine 没挂 error 监听,引擎死了无人知晓,轮次干等 120s 超时且 busy
  锁死全部按键。修复:项目根解析到**仓库绝对路径**(entry/engine 双处),
  spawn error/exit/EOF 全部可见化(发 notice + 释放等待者),stderr 从
  ignore 改为管道留档。实测(engine 层,frontend cwd + mock):完整事件流
  session_start→user_message→tool_call→model_delta→final 全部到达。
- 2026-10-24 第三批(用户实测"一按 / 就闪退"):根因是 commands 形状——
  CommandSuggestions 对每条取 `stringWidth(c.name)`,壳喂的是字符串数组,
  当场炸渲染树。改喂上游 LocalCommand 形状({name, description});同批把
  `choice_request` 接上真面板(choose/confirm/text 三种 kind,App 统一按键
  路由,空文本=取消落回默认值,secret 不回显)——/model /config 向导从此
  能用,「设置按不了」的根因(选择请求被自动取消)一并清除。winpty 真 TTY
  实测:按 / 进程存活、候选面板带描述正确渲染。
- [x] 2026-10-31 **回退默认入口**：壳的 ink 应用在挂载后 ~370ms 自行退出
      （waitUntilExit resolve，无渲染异常边界触发、无 stderr、无 process.exit——
      原因在迁入树自身，非壳外因素；经典前端同环境全程存活），修复前不转正。
      plain ace 回归 `frontend/src`（瑞士规范前端），`ace ui` 保留为显式入口。
      上一轮的「dsh 壳转正」决定作废，等缺陷修复后重评。
- [x] 2026-10-31 **re-vendor 到上游 v0.17.0**（用户提供 GitHub main 完整源码 zip，
      超出本卡原定的 0.16.1 目标）：整树重迁 `frontend/dsh-ui/`（src 1814 文件），
      hooh/ 适配层按新接口升级（CommandCompletion 形状 / render 返回 Promise /
      主题色键），桩类化（ProtocolCatalog/ManifestDefinitionCatalog），
      品牌三处重放，零新增 npm 包。门禁：692 条 vitest 全绿、build 错误集合与
      HEAD 逐条一致、tsc 噪声 83→119（同源，不追）。
- [x] 2026-10-31 **修壳的 ink 自退出缺陷（在 0.17.0 内核上不再复现）**：
      同环境三探针（假 stdio / 管道 stdin 真入口 / winpty 伪 TTY）8–12 秒全程
      存活；v0.12 树同条件 ~370ms 自退出。候选修复：新内核 componentDidCatch 的
      nested-update 溢出恢复、unmount 的 shutdownInput 所有权闸门、首帧微任务
      边界。**剩**：真终端人工复验（`ace ui` 实际跑）后重评「壳转正」。
- [x] 2026-10-31 **默认入口切到整壳**（用户裁决：双击 ace.cmd / hooh.cmd 直接进
      完整界面）：plain `ace` = `:fe_app`（dsh-TUI 本尊 + hooh 内核），
      `ace classic` = 瑞士规范前端（frontend/src），`ace ui` = 最小壳保留，
      `ace --mock` 经启动器译成 ACE_MOCK=1。经典前端再次降级为显式备用
      （上一次回退针对的是最小壳的 ink 自退出；整壳路线绕开了它）。
- [x] 2026-10-31 **首次真机验收反馈三连修**：① 命令面板 105 项全是裸 i18n 键
      （`cmd_context`）——引擎握手就地翻译（`locales/zh.json` 单一真源，
      69 条 ace 命令全部真文案；105 = 上游内置 ~60 + ace 69 去重，`[HooH]`
      标签 = 后端来源，合并规则上游定：本地同名优先）；② 标签栏蓝色鲸鱼
      emoji + 通知标题——`ChatTitle` 的标签题改 `HooH · <title>`，
      toast 标题 i18n 改 `HooH · 任务已完成`；③ **开屏 logo 不见**——
      `~/.dsh-tui/settings.json` 是 dsh-TUI 系共享用户层，从全局 dsh 一次性
      迁来的 `minimal: true` 把开屏大字藏了；app-entry 加**一次性品牌归一**
      （只认 `imported` 标记的文档，翻 `minimal/whale/whaleGirl` 三键，
      `hoohNormalized` 标记保证只做一次，用户此后改动全尊重）。实测归一
      已落盘。`ace --mock` 现在真正传到引擎（之前被整壳吞掉、悄悄走真模型）。
      启动 2.3s 分解：1.6s tsx 编译 1800 文件 + 0.6s 宿主组合根；
      esbuild 预打包可到 <500ms，记为后续项。
- [x] 2026-10-31 **开屏 logo 丑 → 真 bug**：品牌词写的是混合大小写 `HooH`，
      而开屏字形表只有 A-Z——小写 `oo` 掉进缺字兜底的空心方块，渲染成
      「H ▮▮ H」（真机截图）。三修：品牌词全大写 `HOOH`（splashFonts +
      branding）；开屏字体从按日期轮换（上游 9 款彩蛋）**钉成 `shadow`**
      （ANSI Shadow，最带质感的一款，`DSH_TUI_SPLASH_FONT` 缺省，
      /settings 仍可换）；无头帧验证 9 款全渲染正常。
- [x] 2026-10-31 **设置面板边框隐形**：卡片边框 token `promptBorder`
      （#55606F）在纯黑底上过暗，真机几乎不可见（用户截图只剩两截亮色残段）。
      无头帧验证边框字符本身完整（U+2502/╭╮╰╯ 全在）——是**可见性**问题
      不是渲染缺陷；`CARD_BORDER` 改 `inactive`（雾灰蓝，亮一档）。
- [x] 2026-10-31 **打包：整壳随 MSI 进发行包**。学习了 DSH 官方打包（Electron +
      electron-builder + 定制 NSIS：per-user、品牌侧栏、多语言、差分更新、
      代码签名——GUI 桌面应用的重型线）；HooH 是终端应用，沿用仓库既有的
      PyInstaller → WiX MSI + 便携 zip 线，把整壳作为**载荷**塞进去：
      `packaging/build_app_payload.ps1`（staged npm ci --omit=dev + @dsh-std
      桩从树内拷回 + @deepseek-ai 运行时从本机 dsh 安装合并 + 便携 node.exe
      + 自校验 + 启动冒烟），`ace.cmd` 双布局（源码树在 → 源码跑；只有
      `_internal\app` → 载荷跑，引擎 = 打包内 ace.exe 本身，HOOH_ENGINE_EXE）。
      一键链路 `packaging/build_release.ps1`。WiX 品牌化：ARPPRODUCTICON
      （互字 .ico）+ 开始菜单目录改名 HooH。可移植性：清掉三处写死的个人
      venv 探针（ace.cmd/setup_env.py/process.ts → 官方安装根 + 环境变量）。
      门禁：check_packaging 全绿（修掉品牌改名后的陈旧 smoke 标记 + Unreleased
      CHANGELOG 豁免）；载荷自校验 8523 文件/40.9MB 哈希一致；冻结引擎在
      ASCII 路径下整轮对话端到端跑通（EXIT 0）——本仓 G:\_归档\ 非 ASCII 路径
      + 会话沙箱会让 mock_turn/native_tools 两条 smoke 假失败，属环境伪影，
      CI（ASCII 路径）不受影响。
- [ ] **启动提速**：esbuild 预打包整壳成单文件（2.3s → 目标 <500ms）
- [ ] **启动提速**：esbuild 预打包整壳成单文件（2.3s → 目标 <500ms）
- [ ] **真终端验收 `ace app`**（有 TTY 的窗口里跑通一轮 + 审批面板 + /model）
- [ ] 工具表达第 1 项:ToolRow resultView 投影（`ace app` 路线下大部分随上游原生获得）
- [x] 2026-10-31 **Launchpad 资产决策：互字标方案已实现又被用户否决（「算了，
      不用」）**——HoohMark（块字互 + 入场动画 + 呼吸态）做出来看过之后，
      用户裁决不要吉祥物；接线已完整回退（LogoV2 恢复原 gate、组件删除），
      开屏保持「大字 HOOH（shadow 体）+ 文字信息」，无识别物。主题色维持
      雾蓝家族不变。此决定**不再重开**，除非用户点名。
