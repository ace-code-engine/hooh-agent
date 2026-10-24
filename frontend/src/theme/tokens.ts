/**
 * 语义主题 token —— **唯一真相源是 `ui/ace_theme.py`**。
 *
 * 为什么这份要跟 Python 那边逐字对齐：项目里原本就有三套色系各管各的
 * （`ace_theme.tc()` 返回 Rich 名 → `ace_layout.context_state_ansi` 返回裸 ANSI 名 →
 * `ace_fullscreen` 内联十六进制），三者之间没有任何转换层。Ink 前端如果再做第四套，
 * 就是四套并存 —— 换一次色要改四个地方，其中三个必然被漏掉。
 *
 * 所以这里的纪律是：**token 名与色板值照抄 `ace_theme.py`**。
 * `test/theme.test.ts` 会直接读那个 .py 文件逐条比对 —— 那边改了这边没跟，测试就红。
 *
 * 色板家族（与 `ace_theme.PALETTES` 同名）：
 *   dark / light                 旧的两套，值是 ANSI 色名
 *   mist-dark / mist-light / mist-ansi
 *                                dsh-TUI 的「Gentle Mist Blue」雾蓝家族，值是真彩 hex
 *   auto                         伪色板：按终端背景解析成 mist-light / mist-dark
 */

/** 17 个语义 token，顺序与 `ui/ace_theme.py` 一致。 */
export const TOKENS = [
  'text',
  'dim',
  'accent',
  'border',
  'error',
  'success',
  'warn',
  'info',
  'user_bg',
  'tool_pending',
  'tool_ok',
  'tool_fail',
  'perm_ro',
  'perm_write',
  'perm_full',
  'goal_active',
  'goal_paused',
] as const;

export type Token = (typeof TOKENS)[number];

/**
 * ANSI 色名 → chalk 色名。
 *
 * ## 为什么**不能**把色名转成十六进制（踩过）
 *
 * 第一版我把它转成了 xterm 的默认 16 色 hex（`ansiyellow → #808000`）。
 * 结果：黄色渲染成**橄榄绿**，提示符一片绿 —— 而且**所有颜色都不再跟随用户的终端主题**。
 *
 * 原因是 `ace_theme.py` 存的是「**色名**」不是「色值」：`ansiyellow` 的语义是
 * "用终端调色板里的 yellow"（多数主题配成亮黄），不是"用 #808000"。
 * Python 侧发的是色名，由终端决定实际 RGB；转成 hex 就把这个决定权抢走了。
 *
 * 所以这里映射到 **chalk 的色名**（`yellow` / `cyanBright`…）—— chalk 同样发
 * "用 3 号色"这种 SGR，终端照自己的调色板渲染。行为与 Python 侧一致。
 *
 * 只有 `bg:#RRGGBB` 那类**故意写死 RGB** 的底色 token 才用 hex（见 `bgFor`）。
 *
 * 雾蓝色板是**故意写死真彩**的（那是它的品牌色，本来就要求准确），
 * 所以 `colorFor` 对 `#RRGGBB` 原样放行 —— chalk 认 hex。
 */
export const ANSI_CHALK: Record<string, string> = {
  ansiblack: 'black',
  ansired: 'red',
  ansigreen: 'green',
  ansiyellow: 'yellow',
  ansiblue: 'blue',
  ansimagenta: 'magenta',
  ansicyan: 'cyan',
  ansiwhite: 'white',
  ansibrightblack: 'gray', // chalk 的 gray == 亮黑（8 号色）
  ansibrightred: 'redBright',
  ansibrightgreen: 'greenBright',
  ansibrightyellow: 'yellowBright',
  ansibrightblue: 'blueBright',
  ansibrightmagenta: 'magentaBright',
  ansibrightcyan: 'cyanBright',
  ansibrightwhite: 'whiteBright',
};

/**
 * 双套调色板 —— 值逐条照抄 `ui/ace_theme.py` 的 `THEMES`。
 * 注释里保留 Python 那侧对每个 token 的中文说明，免得这边改色时不知道它管什么。
 */
export const PALETTES: Record<ThemeName, Record<Token, string>> = {
  dark: {
    text: 'ansibrightwhite', // 正文
    dim: 'ansibrightblack', // 次要 / 弱化
    accent: 'ansiyellow', // 强调（标题 / 高亮）
    border: 'ansibrightblack', // 边框 / 分隔线
    error: 'ansired', // 错误
    success: 'ansigreen', // 成功
    warn: 'ansiyellow', // 警告
    info: 'ansicyan', // 信息
    user_bg: 'bg:#2b2b3c', // 用户消息底色
    tool_pending: 'ansiblue', // 工具三态 · 执行中
    tool_ok: 'ansigreen', // 工具三态 · 成功
    tool_fail: 'ansired', // 工具三态 · 失败
    perm_ro: 'ansiblue', // 权限 · 只读
    perm_write: 'ansiyellow', // 权限 · 可写
    perm_full: 'ansired', // 权限 · 全权
    goal_active: 'ansigreen', // 目标 · 进行中
    goal_paused: 'ansiyellow', // 目标 · 暂停
  },
  light: {
    text: 'ansiblack',
    dim: 'ansibrightblack',
    accent: 'ansiblue', // 浅底上比黄色清晰
    border: 'ansibrightblack',
    error: 'ansibrightred', // 浅底上增强对比
    success: 'ansigreen',
    warn: 'ansimagenta', // 浅底上黄字不可读
    info: 'ansiblue',
    user_bg: 'bg:#eef0f6',
    tool_pending: 'ansiblue',
    tool_ok: 'ansigreen',
    tool_fail: 'ansibrightred',
    perm_ro: 'ansiblue',
    perm_write: 'ansimagenta',
    perm_full: 'ansibrightred',
    goal_active: 'ansigreen',
    goal_paused: 'ansimagenta',
  },
  // 雾蓝家族 —— 逐条照抄 `ui/ace_theme.py` 的 MIST_DARK / MIST_LIGHT / MIST_ANSI
  'mist-dark': {
    text: '#E8E6E0', // 暖白正文
    dim: '#8D95A6', // 雾灰蓝
    accent: '#7DA1DE', // 雾蓝品牌色
    border: '#55606F', // 哑蓝灰
    error: '#DA8A93', // 柔玫瑰
    success: '#82B89D', // 雾绿
    warn: '#D8B270', // 柔琥珀
    info: '#7DA1DE',
    user_bg: 'bg:#242B3A',
    tool_pending: '#7DA1DE',
    tool_ok: '#82B89D',
    tool_fail: '#DA8A93',
    perm_ro: '#82B8C7',
    perm_write: '#E5C07B',
    perm_full: '#DA8A93',
    goal_active: '#82B89D',
    goal_paused: '#D8B270',
  },
  'mist-light': {
    text: '#343945',
    dim: '#8991A0',
    accent: '#3F6CC4',
    border: '#ABC2EC',
    error: '#C65D6B',
    success: '#4E9675',
    warn: '#C08A3E',
    info: '#3F6CC4',
    user_bg: 'bg:#DCE4FB',
    tool_pending: '#3F6CC4',
    tool_ok: '#4E9675',
    tool_fail: '#C65D6B',
    perm_ro: '#3F7E8F',
    perm_write: '#8A6A00',
    perm_full: '#C65D6B',
    goal_active: '#4E9675',
    goal_paused: '#C08A3E',
  },
  'mist-ansi': {
    text: 'ansibrightwhite',
    dim: 'ansiwhite',
    accent: 'ansibrightblue',
    border: 'ansiwhite',
    error: 'ansibrightred',
    success: 'ansibrightgreen',
    warn: 'ansibrightyellow',
    info: 'ansibrightcyan',
    user_bg: '40', // 背景黑（SGR 参数）
    tool_pending: 'ansibrightblue',
    tool_ok: 'ansibrightgreen',
    tool_fail: 'ansibrightred',
    perm_ro: 'ansibrightcyan',
    perm_write: 'ansibrightyellow',
    perm_full: 'ansibrightred',
    goal_active: 'ansibrightgreen',
    goal_paused: 'ansibrightyellow',
  },
};

/** 真是「一套色板」的名字；`auto` 是伪色板，不在其中。 */
export const PALETTE_NAMES = [
  'dark',
  'light',
  'mist-dark',
  'mist-light',
  'mist-ansi',
] as const;

export type ThemeName = (typeof PALETTE_NAMES)[number];

/** `auto` 解析出来的两个雾蓝色板（与 `ace_theme.AUTO_DARK/AUTO_LIGHT` 一致）。 */
export const AUTO_DARK = 'mist-dark';
export const AUTO_LIGHT = 'mist-light';

type Env = Record<string, string | undefined>;

/** COLORFGBG（格式 `fg;bg`）里背景色号 ≥ 8 视为浅色底。 */
function isLightBackground(env: Env): boolean {
  const fgbg = (env.COLORFGBG ?? '').trim();
  if (!fgbg) return false;
  const bg = fgbg.split(';').pop()?.trim() ?? '';
  return /^\d+$/.test(bg) ? Number(bg) >= 8 : false;
}

/**
 * 检测当前色板。优先级与 `ace_theme.detect_theme()` 逐条一致：
 * ① `ACE_THEME` 显式指定（认全部色板名）→ ② `COLORFGBG` 推断 → ③ 默认 dark。
 *
 * 刻意不在 TS 侧自己发明判据：两边对"现在是深色还是浅色"必须给出同一个答案，
 * 否则同一个终端里 Python 画的和 Ink 画的会是两套配色。
 *
 * 注意这里**不**自动切雾蓝：`--color auto` 才是"跟随背景用雾蓝家族"的显式请求。
 */
export function detectTheme(env: Env = process.env): ThemeName {
  const explicit = (env.ACE_THEME ?? '').trim().toLowerCase();
  if ((PALETTE_NAMES as readonly string[]).includes(explicit)) return explicit as ThemeName;
  return isLightBackground(env) ? 'light' : 'dark';
}

/** 覆盖式 `--color` 的落点：`{accent: '#FF9EC7'}`。 */
let OVERRIDES: Partial<Record<string, string>> = {};

/** 设置/清空覆盖（`--color accent=#FF9EC7,warn=#E0C08A`）。 */
export function setColorOverrides(overrides: Partial<Record<string, string>>): void {
  OVERRIDES = { ...overrides };
}

/** 当前生效的覆盖（测试用）。 */
export function colorOverrides(): Partial<Record<string, string>> {
  return { ...OVERRIDES };
}

/**
 * 解析 `--color` 的值，返回 `{theme, overrides, ok}`。
 *
 * 三种写法（与 Python 侧 `ace_theme.apply_color` 同一套语义）：
 *   `mist-dark`                    选色板（含 auto）
 *   `accent=#FF9EC7,warn=#E0C08A`  在当前色板上覆盖若干 token
 *   未知名字                        ok=false（调用方据此如实报错，不静默忽略）
 */
export function resolveColor(
  spec: string | undefined,
  env: Env = process.env,
): { theme: ThemeName; overrides: Partial<Record<string, string>>; ok: boolean } {
  const base = detectTheme(env);
  const text = (spec ?? '').trim();
  if (!text) return { theme: base, overrides: {}, ok: true };
  if (text.includes('=')) {
    const overrides: Partial<Record<string, string>> = {};
    for (const part of text.split(',')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key && value) overrides[key] = value;
    }
    return { theme: base, overrides, ok: Object.keys(overrides).length > 0 };
  }
  const name = text.toLowerCase();
  if (name === 'auto') return { theme: isLightBackground(env) ? AUTO_LIGHT : AUTO_DARK, overrides: {}, ok: true };
  if ((PALETTE_NAMES as readonly string[]).includes(name)) {
    return { theme: name as ThemeName, overrides: {}, ok: true };
  }
  return { theme: base, overrides: {}, ok: false };
}

/**
 * 取一个 token 在当前主题下的**前景**色名（喂给 Ink 的 `color`）。
 *
 * 返回 chalk 色名（`'yellow'` / `'cyanBright'`…）或真彩 hex（雾蓝色板）——
 * 前者让终端用自己的调色板渲染（见 `ANSI_CHALK` 上方那段），后者是品牌色本身。
 * 未知 token、或本身就是底色 token，返回 undefined（= 终端默认色，不抛）。
 */
export function colorFor(token: Token | string, theme: ThemeName): string | undefined {
  const raw = OVERRIDES[token] ?? (PALETTES[theme] as Record<string, string>)[token];
  if (raw === undefined || raw.startsWith('bg:')) return undefined;
  if (raw.startsWith('#')) return raw; // 真彩：chalk 认 hex
  return ANSI_CHALK[raw];
}

/**
 * 取一个 token 的**背景**色（喂给 Ink 的 `backgroundColor`）。
 *
 * 只有 `bg:#RRGGBB` 那类 token 有值 —— 那些是**故意写死 RGB** 的
 * （用户消息底色不能跟着终端主题变，否则浅色主题上会糊成一片）。
 */
export function bgFor(token: Token | string, theme: ThemeName): string | undefined {
  const raw = OVERRIDES[token] ?? (PALETTES[theme] as Record<string, string>)[token];
  if (raw === undefined) return undefined;
  if (raw.startsWith('bg:')) return raw.slice(3);
  if (raw.startsWith('#') && isBackgroundToken(token)) return raw;
  return undefined;
}

/** 底色类 token（`bg:#RRGGBB` 那些）真正的用途是背景，不是前景。 */
export function isBackgroundToken(token: Token | string): boolean {
  for (const theme of PALETTE_NAMES) {
    const v = (PALETTES[theme] as Record<string, string>)[token];
    if (v !== undefined) return v.startsWith('bg:');
  }
  return false;
}
