# WP-GUI · 把 TUI 当作 GUI 来写 —— 总纲与进度

> 状态:**实现中**(2026-10-10 立项)。
> 本文是这次改造的**唯一权威参照**:摸底结论、内核已验证事实、规范约束、
> 批准方案、进度日志全在这一张卡里。做完后按仓库惯例把结论并入
> `docs/TUI-SWISS-SPEC.md`(新增「交互层」节)与 `docs/HANDOFF.md`。

## 〇、目标与边界

给 `frontend/`(TypeScript + Ink 主 TUI)补齐 GUI 级体验,三条轨:

1. **鼠标 / 触摸板完整交互** —— 滚轮、点击、hover、拖拽全部接通;
2. **浮层窗口系统** —— 面板不再整屏切换,改为输入行上方的浮层;
3. **动画与微交互** —— ≤5 Hz,规范之内。

**硬边界(一条都不能破)**:

- 瑞士风格规范(`docs/TUI-SWISS-SPEC.md`)是**硬约束**,GUI 化在其内做;
- 只动 `frontend/`,Python `ui/` 冻结面不碰,引擎协议与权限语义不碰;
- vendored 内核 `frontend/vendor/dsh-ink/lib/` 的 **135 个 `.js` 零字节改动**
  (逐字节拷贝的合规证据),允许改的是项目自有的 `kernel.js` / `kernel.d.ts` 门面;
- 不加任何新依赖;
- **对等原则**:每个鼠标动作必须有键盘等价物(`KEYMAP-CLAUDE-PARITY.md` 纪律)。

---

## 一、项目与 TUI 现状(摸底结论)

### 1.1 项目:HooH(互)/ ACE

面向编码代理的**执行层** CLI:模型提出动作,权限闸门 / 路径边界 / 写前快照 /
HMAC 审计由 harness 代码裁决。v1.1.0,MIT。分层:

| 层 | 位置 | 技术 |
|---|---|---|
| 引擎/CLI | `ai_code.py`(~9800 行)、`execution_layer.py` | Python |
| 核心支撑 | `core/`(~40 模块) | Python 纯标准库 |
| **主 TUI** | `frontend/` | TS + React 19 + Ink(vendored dsh-ink) |
| 旧 UI(冻结) | `ui/` | Python,只修 bug |
| 执行器 | `executor/`、`engine/` | Go(沙箱)、Rust(元处理) |

前端经 NDJSON stdio(`--serve`,PROTOCOL_VERSION=1)与引擎通信;
`ace.cmd` → 有 Node 跑 `frontend/src/index.tsx`,否则回退 Python UI。

### 1.2 frontend/ 组件清单(改造前)

```
src/
  index.tsx → Root.tsx(备用屏开关/语言) → App.tsx(826 行,状态接线)
  state/store.ts        reducer + applyEvent(事件→转录条目)
  protocol/client.ts    spawn ai_code.py --serve,NDJSON,seq 校验
  keys/registry.ts      键位注册表(声明/平台别名/保留集/冲突检测,649 行)
  theme/tokens.ts       色板(与 ui/ace_theme.py 有跨语言守卫测试)
  i18n.ts + 各组件 i18n.ts   三语言(zh/en/ja),缺键显式标记
  components/
    Banner / Home / Transcript / Input(680 行,菜单+vim) / StatusLine / Spinner
    PermissionDialog / ChoiceDialog / Menu / Markdown / ToolCard / TaskTree
    pickers/Picker  prefs/PrefPicker  settings/SettingsPanel  session-tree/SessionTree
    help/HelpOverlay  draft-editor/DraftEditor  wizards/  usage/(三件套)
    design-system/(primitives.tsx + containers.tsx,12 件设计系统)
  tui/
    alternate-screen-kernel.tsx  备用屏(内核版,<AlternateScreen mouseTracking>)
    scroll-box.tsx               自制虚拟化滚动(键盘翻页,无鼠标)
    synchronized.ts              DEC2026 包装(非内核路径用)
  render/  markdown/diff/menu/glyphs/spinner/vim 等纯函数渲染层
```

### 1.3 交互模型现状

- **纯键盘**:面板(App.tsx 的 `Panel` 联合类型)整屏换掉主界面;一次一个;
- `?` 帮助、Ctrl+R 历史搜索、vim 模式、补全菜单都在;
- 备用屏(全屏)已传 `mouseTracking` 给内核——**但没有一个组件消费鼠标事件**;
- `scroll-box.tsx` 注释明记代价:"拿不到鼠标滚轮/拖选(内核版才有)";
- 面板切换 = 元素类型替换,App 不卸载(状态托管在 Root/ App,防转录清空回归)。

---

## 二、内核能力清单(逐项验证过的事实)

dsh-ink v0.12.0(MIT,135 文件逐字节 vendored)内建了全套 GUI 原语,
应用层只用了一小半。**以下是本次改造依赖的已验证事实**:

1. **门面窄,内核宽**:`kernel.js` 只转口 13 个导出;`kernel.js`/`kernel.d.ts`
   是项目自有文件,**可以扩**(lib/ 不可动)。
2. **鼠标一等公民**:
   - 启用:SGR 1000/1002/1003+1006(`termio/dec.js` 的 `ENABLE_MOUSE_TRACKING`);
   - 解析:`parse-keypress.js` 的 `parseMouseEvent`(含 ConPTY 分片宽限);
   - 分发:`components/app.js` 的 `handleMouseEvent`(731 行起)→
     `hit-test.js` 的 `hitTestWithOverlays`(绝对定位节点按**挂载逆序**命中 = 浮层 z 序内建);
   - **分发不被备用屏状态门控** —— 主屏写一次模式序列即可用(ink.js 只在
     `setAltScreenActive(active, mouseTracking)` 记 `altScreenMouseTracking`,
     用于重断言时机,不用于事件门控);
   - `Box` 运行时接受 `onClick / onContextMenu / onDragStart/Move/End / onWheel /
     onMouseEnter / onMouseLeave / onFocus / onBlur / onKeyDown / tabIndex / autoFocus`
     (`components/box.js:5`),事件类在 `events/`(Pointer/Click/Wheel/Drag/
     ContextMenu/Focus/Keyboard/Paste),`ClickEvent.cellIsBlank` 可滤空白区误点;
   - **滚轮位置优先路由**(app.js:678-700):wheel 先命中指针下的滚动容器,
     消费则不走全局键路径 —— "exactly one layer scrolls";
   - 逃生口:内核 `DSH_TUI_DISABLE_MOUSE=1`(关点击保滚轮)。
3. **动画时钟**:`components/clockcontext.js` 单一共享 `setInterval` 时钟
   (16 ms `FRAME_INTERVAL_MS`,终端失焦自动减速),配套
   `useAnimationFrame(intervalMs|null)`(离屏自动暂停,keepAlive 驱动时钟)、
   `useAnimationTimer`(非 keepAlive)、`useInterval`(共享时钟的 setInterval)。
4. **渲染管线**:打包 cell 缓冲 + 脏矩形 diff + DECSTBM 硬件滚动 + DEC2026
   同步输出(`SKIP` 探测),全帧 ~2.9KB、移动选区 ~270B、空闲 0B。
5. **未转口但存在的组件**:`Button`、`Link`(OSC8)、`Image`(sixel/kitty)、
   `Newline`、`Spacer`、`RawAnsi`、`NoSelect`;选择/搜索高亮/反白都是
   StylePool 纯 SGR 叠加。

---

## 三、规范约束(实现时逐条对照)

出自 `docs/TUI-SWISS-SPEC.md`(v1,验收:去色仍可读):

- 左对齐,永不居中;
- **无边框**:分区只用整宽细线(`-` 或 DEC 线,**禁 `─`**——GBK 下双宽);
- **一屏一个强调色**,其余灰阶;ok/warn/err 只出现在状态标记;
- 层级工具**恰好五个**:留白 / ALL-CAPS+字距标签 / 默认前景色上的 bold /
  三档灰阶 / **反白=选中**(hover 高亮用它,不算新工具);
- **禁背景填充**,"块"用 2 格左条 `▌` 或整宽细线;
- 动画 **≤5 Hz** 且只在有事发生时;reduced-motion 全静态;
- 网格:页边 2 列、列距 4、块间 1 空行;数值/时间列**定宽右对齐**;
  宽度一律按显示宽度(East Asian Width);
- **禁 `dim`(SGR 2)**,次级灰用 `38;5;245`;
- conhost 黑名单字形:`─ ● ■ ◆ · …`;安全字形:`█ │ ▌ ▏ ▶`;
- 无色档靠**字形形状**区分,不靠颜色。

设计语言补充(`TUI-DESIGN-STUDY.md` / `TUI-ENGINE.md`):
两车道渲染(定稿内容只进 scrollback 一次)、状态行丢弃顺序明确、
预览折叠行数是常量且同屏给"还剩 N 行 + 展开键"、审批 Esc=拒绝是硬契约、
主屏优先/备用屏显式进入、单帧重排 ≤8 ms。

---

## 四、顺带清偿的既有债务

- `scroll-box.tsx` "拿不到鼠标滚轮"欠账(注释里明记)→ Phase 1 清偿;
- HANDOFF-FRONTEND §四.2 "六条功能轨没有肉眼看过" → Phase 4 真机清单覆盖;
- `model_delta`/`status` 事件有 schema 无发射点 → **本次不碰**(协议面);
- 多行粘贴折叠、用户自定义键位 → 不在本次范围。

---

## 五、批准的实施方案

### Phase 0 — 地基:门面扩容 + 全局鼠标 + 动效基建

1. **扩门面**(`kernel.js` + `kernel.d.ts`,项目自有):
   - `BoxProps` 补鼠标/焦点 props 的**精确类型**(事件类形状见 §二.2);
   - 转口 `useAnimationFrame` / `useInterval` / `measureElement`
     (specifier 大小写沿用内核内部写法 —— ESM 按 specifier 字符串缓存,
     两种大小写 = 两个模块实例,见 kernel.js 头部警告)。
2. **主屏鼠标**:`src/tui/mouse-tracking.tsx` —— 常挂组件,仿
   `AlternateScreen` 的 `useInsertionEffect` + `TerminalWriteContext`,
   写 `ENABLE_MOUSE_TRACKING`,卸载 DISABLE。逃生口:内核
   `DSH_TUI_DISABLE_MOUSE=1` 照旧;新增 `ACE_NO_MOUSE=1` 完全关闭
   (恢复终端原生选择);主屏选择用 Shift+拖拽(文档化)。
3. **动效基建**:`src/tui/motion.tsx` —— `useReducedMotion()`(统一
   `ACE_REDUCE_MOTION=1`)+ 帧预算常量(动效上限 5 Hz/200 ms、
   浮层过渡 2 步 ≤250 ms、流式光标 2 Hz)。

### Phase 1 — 鼠标完整交互

1. ScrollBox 滚轮(`onWheel` + 既有 follow-tail/detach/refollow 三态)、
   滚动条槽点击翻页、滑块拖拽;
2. `design-system` 新增 `ClickableRow`(hover 反白 + 点击,键盘等价保留),
   接入:Picker/PrefPicker、Input 菜单候选、Home 行、PermissionDialog/
   ChoiceDialog、SettingsPanel 行、SessionTree 节点、HelpOverlay、wizards、
   ToolCard 头部展开;
3. 提示文案 i18n ×3 语言(新键走守卫测试)。**既有惯例**(`.workbuddy-ai/memory/2026-10-06.md`):
   组件局部三语字典的值用反引号模板串(守卫只扫 `'…'`/`"…"`),`*_KEYS` 用
   「先声明、再 `export {}`」写法;
4. 对等原则:每个鼠标动作有键盘等价。

### Phase 2 — 浮层窗口系统

1. `design-system/overlay.tsx`:底部锚定(输入行上方)绝对定位浮层
   (hitTestWithOverlays 挂载逆序 = z 序),瑞士视觉:上下整宽细线 +
   `▌` + ALL-CAPS 标题,无框无底色;背景转录降 text_3 灰;超高内容
   内部 ScrollBox(带滚轮);Esc 关闭;
2. 面板迁移(`Panel` 状态机不动,只换渲染形态):`/resume`、四个闭集
   选择器、`/tree`、`/config`、`?` 帮助 → 浮层;DraftEditor **保持全屏**;
   审批/选择框压浮层之上(既有语义);
3. 单浮层原则:一次一层。

### Phase 3 — 动画与微交互(≤5 Hz)

1. Spinner 迁共享时钟 + reduced-motion 静帧;
2. 流式光标 `▌` 2 Hz 脉冲(活动流式时);
3. hover 高亮不加动画;选择确认后 200 ms 单帧反白闪光;
4. 浮层开合背景灰阶 2 步过渡(~250 ms),reduced-motion 直达终帧;
5. ContextBar/进度条**保持静态**(动画无信息增量,记录决策不做了)。

### Phase 4 — 验证与守卫

1. vitest:ClickableRow/Overlay/ScrollBox 滚轮语义;`renderToScreen`+
   `cellAtIndex` 金样 60/80/120 列;一屏一强调色断言;reduced-motion
   单帧断言;i18n ×3 守卫;
2. `tsc --noEmit` + `npm test` + 既有集成测试全绿;
3. 真机人工清单(Windows Terminal):hover/点击/滚轮/浮层/动画、
   cp936 字形核对;
4. 文档:SWISS-SPEC 新增「交互层」节、KEYMAP 加鼠标列、HANDOFF 更新;
5. demo 纪律(REL-06):首屏文案若变,重录 landing/happy/blocked 并 `--check`。

### 提交切分

1. `feat(tui): 门面扩容 + 主屏鼠标 + 动效基建`
2. `feat(tui): 鼠标交互全接通`
3. `feat(tui): 浮层窗口系统`
4. `feat(tui): 微交互动效(≤5Hz)`
5. `docs+test: 规范交互层/守卫/demo`

⚠️ 工作区另有**用户未提交**的 demo/CI/ace_io 改动("跨平台录制可复现"主题),
提交时**只 add 本次改造自己的文件**,绝不混入。

---

## 六、风险与对策

| 风险 | 对策 |
|---|---|
| 主屏鼠标 vs 终端原生选择 | Shift+拖拽原生选择文档化;`ACE_NO_MOUSE=1` + `DSH_TUI_DISABLE_MOUSE=1` 双逃生口 |
| 挂起/复焦后模式丢失 | 内核 app.js:452 已有重断言机制,spike 验证;不足则监听 `terminalfocus` 自行重断言 |
| hover 引发转录全量重渲染 | 行组件局部 state;内核 node-cache 有未变节点测量缓存兜底 |
| 主屏绝对定位浮层与 inline 布局共存 | Phase 2 首日 spike 验证 hitTestWithOverlays 实测 |
| conhost 字形回退 | 只用已验证字形 `█ │ ▌ ▏ ▶`,真机清单核对 |
| 两份 React 单实例纪律 | 不新增 import 路径,组件只从 `kernel.js` 取内核件 |

---

## 七、可借鉴素材库(G:\agents,2026-09-27 快照)

**29 个开源编码 agent 的浅克隆**(无 git 历史,更新=删目录重跑),工作区 2.70 GB,
报告与脚本在 `_inventory/`。用户口径:"这里都是开源的,借鉴一下就行" —— 与仓库
第三方纪律一致:**读实现、自己重写,不拷文件**(`THIRD-PARTY-NOTICES.md` 口径)。

### 重点挖掘对象(与三轨的对应)

| 仓库 | 星/栈 | 挖什么 |
|---|---|---|
| `repos/opencode` | 210k★ TS(自研 opentui + Solid) | 鼠标路由、浮层/命令面板、动效 |
| `repos/pi` | 110k★ TS(自研) | 已借鉴过 ScrollView/键位注册表;再挖 SGR 鼠标、滑杆、hover |
| `repos/codex` | 127k★ Rust(ratatui) | 鼠标模式启用面、overlay 架构、动效常量 |
| `repos/gemini-cli`(+`repos/qwen-code` 分叉) | 107k★ TS(**Ink+React,与我们同栈**) | 对话层/浮层分离、spinner、鼠标有无 |
| `repos/oh-my-pi` | 33k★ TS(pi 系) | pi 之上加了什么 GUI 件 |
| `repos/crush` | 28k★ Go(bubbletea/lipgloss) | 鼠标事件→动作映射、pager/dialog |
| `repos/Codewhale` | 41k★ Rust(备选) | — |

### 尚未考察的本地工件(G:\agents 根目录)

- `dsh-effort-slider-backup/` + `apply-slider-merge.mjs` ~ `apply-slider-merge-19.mjs`
  —— 一整套"强度滑杆"合并 codemod(至少跑了 19 遍),疑似此前把 dsh 的 effort
  slider 往某处移植的工作现场;**内容未读**。Phase 1 做 ToolCard/滑杆类拖拽件
  之前先看它,能少走弯路。
- `check-light-contrast.mjs`(亮色对比度检查)、`seat-audit.md`、`ft-*.yml`、
  `pi-cli/`(pi 启动器)、`pi-home/`、`_inventory/`(抓取报告)。

### 环境备忘(出自 G:\agents\README.md)

直连 github 不稳,镜像链 gh-proxy.com→ghfast.top→gitclone.com→ghproxy.net;
git 一律 `-c http.sslBackend=openssl`;`GIT_LFS_SKIP_SMUDGE=1`。

### 三份挖掘任务书(2026-10-10 已派发、被中断未执行,可原样重派)

1. **opencode + gemini-cli/qwen-code**:鼠标启用与路由 / 浮层 z 序与焦点 /
   spinner 与帧率管理;
2. **pi + oh-my-pi**:SGR 鼠标 / 滑杆控件(键盘+拖拽)/ 浮层 / 微交互
   (spinner 帧表、reduced-motion);
3. **codex + crush**:ratatui 鼠标与 overlay 架构 / bubbletea 鼠标、pager、动效常量。

产出口径:每条发现 = 文件路径 + 机制一句话 + "可移植到 Ink 内核?"判断,
只留结论进本卡 §八(发现清单),不拷码。

---

## 八、进度日志

- **2026-10-10** 立项。摸底三份报告完成(组件盘点 / 内核能力 / 规范债务),
  方案经用户批准(三轨全做、规范硬约束、只动 frontend/)。Phase 0 开工。

- **2026-10-10(同日)** **Phase 0 代码落地 —— `tsc`/`vitest` 尚未跑**(当次被中断,
  这是下一步第一件事):
  - `kernel.js` 追加 6 组转口:`TerminalWriteContext`、`ENABLE/DISABLE_MOUSE_TRACKING`、
    `useTerminalFocus`、`useAnimationFrame`、`useAnimationTimer`+`useInterval`、
    `measureElement`;
  - `kernel.d.ts` 补 6 个事件接口(`KernelPointerEvent/KernelClickEvent/
    KernelWheelEvent/KernelDragEvent/KernelKeyboardEvent/KernelFocusEvent`,逐字段
    对着 `events/*.js` 运行时类写的)+ `BoxProps` 交互 props(tabIndex/autoFocus/
    onClick/onWheel/onMouseEnter/onMouseLeave/onDrag*/onContextMenu/onFocus/onBlur/
    onKeyDown)+ 上述转口声明(加了 `RefObject` import);
  - 新增 `src/tui/mouse-tracking.tsx`:主屏 SGR 鼠标启用,三时机(挂载 ENABLE /
    卸载 DISABLE / `reassertKey` 变化重写),复焦自愈(`useTerminalFocus`),
    逃生口 `ACE_NO_MOUSE=1` + 内核 `DSH_TUI_DISABLE_MOUSE=1` 语义不变,
    Shift+拖拽原生选择文档化在文件头;
  - 新增 `src/tui/motion.ts`:`MOTION` 常量(`frameMs:200`=5Hz 上限、
    `streamCursorMs:500`=2Hz、`overlaySteps:2×125ms`)+ `useReducedMotion()`
    统一出口;
  - `Root.tsx`:`<MouseTracking reassertKey={fs}>` 包在 `<AlternateScreen enabled={fs}>`
    **外层**(备用屏卸载清理会写 DISABLE,幸存层的 layout 相 insertion effect
    最后写 ENABLE,时序成立)。
  - 验证注意(沿用 2026-10-06 备忘):本机 `npm ci` 被 safe-delete 拦 → `npm install`;
    `design-system.test.tsx`/`status-parity.test.ts` 本机 spawnSync EBUSY 是环境特有,
    CI 不受影响;前端 i18n 惯例 = 组件局部三语字典用**反引号**串(守卫只扫 `'…'`)、
    `*_KEYS` 用「先声明再 `export {}`」写法。

- **2026-10-10** 用户指路 `G:\agents` 素材库(§七);三份挖掘代理被中断,任务书留存。
  随后全部记录落盘:本卡 + `.workbuddy-ai/memory/2026-10-10.md` + 跨会话记忆。
