/**
 * 语言根 —— **界面语言必须跟着引擎走**。
 *
 * 为什么需要它：前端有**自己一份字典**（`i18n.ts`），而 `/lang` `/provider` 是引擎在执行。
 * 之前字典是启动时按 `--lang` 建一次、之后再也不动 —— 于是"引擎旁白变英文、斜杠后面的
 * 提示还是中文"（实测投诉）。更糟的是 `index.tsx` 的注释早写着"这样 `/lang` 切换后菜单
 * 会跟着变"，那句话此前**并不成立**。
 *
 * 独立成模块而不是塞在 `index.tsx` 里：`index.tsx` 是入口脚本，**import 它就会执行主流程**
 * （测试里 import 一次就把 CLI 跑起来了）。入口只管碰外部世界，组件层保持纯粹。
 *
 * 语言的两个来源，判据分明：
 *   1. 启动：命令行 `--lang` 显式给了就听用户的；没给就用引擎握手时报的 `lang`。
 *   2. 运行中：引擎切语言会发 `language` 事件 → 换字典 + 重渲染（菜单/提示一起变）。
 */

import React from 'react';

import { App, reducer, type AceClientLike } from './App.js';
// 备用屏用**内核版**（`?1049` 由内核连同它的帧缓冲/污染检测一起管）。
// 回滚 = 把下面这行换回 `'./tui/alternate-screen.js'`（自制 1049 版一直原样留着）。
import { AlternateScreen } from './tui/alternate-screen-kernel.js';
import { I18n, SUPPORTED, type Lang } from './i18n.js';
import type { AceEvent } from './protocol/types.js';
import type { BuildMenuOptions } from './render/menu.js';
import { initialState } from './state/store.js';

export interface RootProps {
  /** 只要 `on`（收事件）与可选 `off`（退订）—— 测试里的假客户端没有 `off`。 */
  client: AceClientLike & {
    off?: (event: string, listener: (...args: any[]) => void) => unknown;
  };
  i18n: I18n;
  colorOf: (token: string) => string | undefined;
  menuOptions: BuildMenuOptions;
  /** 命令行 `--lang`（给了就压过引擎报的那个）。 */
  commandLineLang?: Lang;
  /** 引擎握手报的界面语言。 */
  engineLang?: string;
  initialMessage?: string;
  /** 备用屏全屏：转录交给自带滚动视口（终端没有回滚，历史得自己管）。 */
  fullscreen?: boolean;
}

export function Root({
  client,
  i18n,
  colorOf,
  menuOptions,
  commandLineLang,
  engineLang,
  initialMessage,
  fullscreen = false,
}: RootProps): React.ReactElement {
  /** 只认三种支持的语言：引擎报了个没见过的值不许把界面变成键名堆。 */
  const apply = (raw: string | undefined): void => {
    if (raw && (SUPPORTED as readonly string[]).includes(raw)) i18n.setLanguage(raw as Lang);
  };
  // 转录状态挂**在这里**而不是 `App` 里：内核备用屏只有挂载/卸载语义（没有 `enabled`），
  // 下面 `enabled` 一翻就是换元素类型 ⇒ `App` 卸载重挂。状态住在 Root（这层不重挂），
  // `/fullscreen off` 才不会把转录清空 —— 见 `AppProps.state` 那段注释。
  const [state, dispatch] = React.useReducer(reducer, undefined, initialState);
  // 备用屏开关：起步听命令行，之后可以**被引擎的 `/fullscreen` 改**（配置回来时同步）。
  const [fs, setFs] = React.useState<boolean>(fullscreen);
  // 启动语言**只决定一次**（`useState` 初始化函数只跑一次）。
  // 别写成"渲染期每次都 apply"：那样运行中切到英文后，`setLang` 引发的重渲染会
  // 拿引擎**初始**的 `engineLang`（zh）再 apply 一遍，把语言掰回中文 —— 实测踩过。
  const [curLang, setLang] = React.useState<Lang>(() => {
    apply(commandLineLang ?? engineLang);
    return i18n.language;
  });
  // `t` 的依赖里带上语言：换语言就换一个新的 `t`，订阅了它的子组件（菜单等）跟着重算。
  // 注意**不能**用 `key={curLang}` 去逼重渲染 —— 那会把整个 App 卸载重挂，转录区会被清空。
  const t = React.useCallback(
    (k: string, p?: Record<string, string | number>) => i18n.t(k, p),
    [curLang],
  );

  React.useEffect(() => {
    const onEvent = (ev: AceEvent): void => {
      if (ev.type !== 'language') return;
      apply(String(ev.lang ?? ''));
      setLang(i18n.language);                // 换语言 = 换一套文案 → 必须重渲染
    };
    client.on('event', onEvent);
    return () => {
      client.off?.('event', onEvent);
    };
  }, [client]);

  return (
    <AlternateScreen enabled={fs}>
      <App
        client={client}
        t={t}
        fullscreen={fs}
        onFullscreenChange={setFs}
        state={state}
        dispatch={dispatch}
        colorOf={colorOf}
        menuOptions={menuOptions}
        {...(initialMessage !== undefined ? { initialMessage } : {})}
      />
    </AlternateScreen>
  );
}
