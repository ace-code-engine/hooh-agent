/**
 * **无头 smoke 的界面语言钉子**。
 *
 * 为什么需要它：这套 UI 的界面语言在 `i18n.ts` **导入时**就被解析成一个模块级
 * 变量了（`resolveStartupLang()`：`DSH_TUI_LANG` → 持久化的 `/lang` 选择 →
 * OS locale → `zh`）。fixture 里什么都不设，语言就跟着宿主环境走 ——
 * 本机 zh-CN → 中文，CI 的无 locale Linux（`LANG=C.UTF-8`）→ 英文，
 * 于是测试里写死的中文断言（`继续「` / `说点什么` / `首屏画了: true`）跟着漂。
 *
 * 钉的是**产品自己的入口** `DSH_TUI_LANG`：它是 `i18n.ts` 文档化的**第一优先级**
 * （进程启动时定死），也是 `/lang` 与设置页之外唯一能"声明界面语言"的真实路径
 * （HooH 壳没有别的语言参数；`App`/`Launchpad` 都只读 `getLang()`）。
 * 这不是拿 CI 的 `LANG` 蒙混 —— 宿主的 locale 是环境噪声，fixture 要的界面语言
 * 是明确的 zh，两者必须解耦。
 *
 * **本文件必须在任何会 import `i18n.ts` 的模块之前被 import**：ESM 按 import
 * 声明顺序深度优先求值，所以四个 smoke 都以它为第一条 import。放到模块体里
 * （`process.env…` 写函数里）就晚了：静态 import 先求值。
 */
process.env.DSH_TUI_LANG = 'zh'
