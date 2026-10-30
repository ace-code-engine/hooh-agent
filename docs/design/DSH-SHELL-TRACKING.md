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
- [ ] re-vendor 到上游 0.16.1
- [ ] 工具表达第 1 项:ToolRow resultView 投影
- [ ] questions/ 面板接入(choice_request 不再自动取消)
- [ ] Launchpad 资产决策(鲸鱼 → HooH 或保留关闭)
- [ ] 命令候选接 initialize 的 commands(替换 entry 硬编码六条)
