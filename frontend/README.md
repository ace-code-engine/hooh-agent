# HooH 前端（TypeScript + Ink）

HooH 的主前端。**独立进程**，通过 `ace --serve` 的双向 NDJSON 协议跟 Python 引擎对话。

与 `ui/`（Python 手写 ANSI 那套）**并存**：那边保留为回退路径（没装 Node / 无头 / 终端太小），
这边是主路径。两者共用同一份 i18n 字典与同一套语义 token，不各写一份。

## 为什么是独立进程

引擎是 Python，前端是 Node —— 中间必须有条管道。**审批对话框**是这条管道存在的理由：
引擎需要一个答案时会**阻塞**等 `permission.answer`（`execution_layer.py` 从不读 stdin、
不持有回调，它只维护 `pending_permission` 并返回状态码）。单向的事件流做不了这件事。

协议形体照 `docs/ADR-002-executor-boundary.md` 里已经论证过的 Go 执行器那套：
`v` / `req`·`resp`·`event` / `id` 相关 / `seq` 单调（丢帧检测）/ `initialize` 握手。

## 跑起来

```bash
cd frontend
npm install
npm start -- --mock -m "现在几点"     # 离线，不需要 API key
npm test                              # vitest：单元 + 假引擎界面 + 真引擎集成
npm run build                         # tsc --noEmit：只查 src/ + tools/（迁入树另有一套尺度）
npm run preview                       # 把真实渲染帧打到终端（见下）
```

**`npm run preview` 是给"看一眼"用的**：它用 `ink-testing-library` 渲染**真组件**，
喂一段脚本化的事件流（首屏 / 流式增量 / 工具卡片 / 审批框 / 任务树），把每一步的帧
按顺序打出来。`docs/HANDOFF-FRONTEND.md` §四.2 记着"六项的视觉效果一次都没被人眼看过
（开发环境没有 TTY）"—— 这个脚本就是为了解掉那件事：**排版现在可验了**。

```bash
npm run preview                 # 直接看
npm run preview -- --plain      # 剥掉 ANSI，方便贴进 issue
FORCE_COLOR=1 npm run preview   # 看配色（PowerShell: $env:FORCE_COLOR=1; npm run preview）
```

> 颜色那一条有坑：脚本用的是**假 stdout**，chalk 于是认为"不是终端"并把颜色关掉。
> 要看到配色必须在**启动 node 之前**设 `FORCE_COLOR`（chalk 在 import 时就定级了）。
> 没设时脚本自己会把这句话打出来 —— 排版照旧可验，配色不行，这一点不装。


常用参数：`--project-root <dir>` · `--mock` · `--lang zh|en|ja` · `--python <path>` · `--no-stream`。

**Python 解释器**：默认按 `ACE_PYTHON` → 已知路径 → `python` 的顺序探测。
Windows 上裸 `python` 常常是 Microsoft Store 的执行别名**存根** —— 它不报错、无输出、
退出码 49，症状是"引擎一声不响就退了"。本机可用的是 `C:\aider_env\Scripts\python.exe`，
探测顺序已优先它。

## 结构

```
src/
  index.tsx              入口：解析参数 → 起引擎 → 挂界面（所有碰外部世界的动作都在这里）
  App.tsx                接线：client / 状态 / 组件。依赖**注入**，所以能用假引擎测界面
  i18n.ts                直接读根级 locales/*.json，降级口径与 ui/i18n.py 逐条一致
  protocol/
    client.ts            协议客户端：spawn / 分帧 / id 相关 / 丢帧检测。唯一碰进程与管道的模块
    types.ts             协议类型 + 事件类型集合（与 core/ace_events.EVENT_TYPES 对齐）
  state/store.ts         转写区**纯 reducer**：不碰 React，事件顺序类问题可穷举测
  theme/tokens.ts        语义 token。**名与值以 ui/ace_theme.py 为准**，此处只多做一步 ANSI 名 → hex
  components/
    Transcript.tsx       转写区（按条目类型分别渲染）
    ToolCard.tsx         工具卡片（字形沿用 ui/ace_cards.py 那套：◌ ◐ ✓ ✗）
    PermissionDialog.tsx 授权对话框（once / session / deny，顺序与 ui/ace_turn 对齐）
    Input.tsx            输入行（忙时排队、Esc 两段式中断）
    StatusLine.tsx       状态行（宽度不够先丢低优先级分段，与 ui/ace_layout 同口径）
test/
  theme.test.ts          token 名与值 ↔ ui/ace_theme.py **逐条比对**
  protocol.test.ts       事件类型 ↔ core/ace_events.EVENT_TYPES；审批三态 ↔ agent_runner.GRANT_*
  i18n.test.ts           字典真的载入了（读不到会安静地全线退化成键名）
  store.test.ts          reducer 的事件顺序穷举
  app.test.tsx           假引擎驱动界面（含授权对话框的按键）
  statusline.test.tsx    底栏：引擎分段优先 / 语义档→token
  preview.test.ts        `npm run preview` 还活着（每帧非空 + 关键画面在）
  integration.test.ts    **真引擎**：真管道、真协议、真审批往返
  fake-engine.ts         假引擎（与 tools/preview.tsx **共用一份**，两份会漂）
tools/
  preview.tsx            `npm run preview`：渲真组件、打印帧
```

## 两条测试纪律

1. **跨语言一致性靠读源码比对，不靠人记得同步。** `theme.test.ts` 与 `protocol.test.ts`
   直接读 `ui/ace_theme.py` / `core/ace_events.py` / `agent_runner.py`。那边改名这边没跟，
   测试就红 —— 而不是等到运行时某个功能静默不工作。

2. **假引擎必须镜像真客户端的语义。** `app.test.tsx` 里的假引擎刻意也实现了"首个订阅者
   到来前先缓冲事件"（真 `AceClient` 有这一层，因为引擎的 `session_start` 发得比界面挂载早，
   而事件流没有重放）。不镜像的话，测试会默认"事件推出去就有人收"，于是测试全绿、线上丢事件。

## 与 Python 侧的边界

引擎那侧的一切仍以 Python 为准：权限裁决、工具执行、快照回滚、守门 —— 前端**只画，不裁决**
（与 `ui/__init__.py` 的定位一致）。前端能做的最危险的事就是递一个"允许"，而那个答案照样
要过 `grant_pending_permission` 的门。

协议本身的契约测试在 Python 侧：`test_all.py` 的 `[69]` 段（真子进程往返）。
