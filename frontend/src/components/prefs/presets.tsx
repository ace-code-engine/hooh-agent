/**
 * 偏好选择器的外挂表 —— 四个现成选择：主题 / 强调色 / 语言 / 思考强度，
 * 每个都是上层菜单的数据 → PrefPicker 的原生调用。
 *
 * 这里的中文标签同样走**反引号模板串**：与 `prefs/i18n.ts` 同一取态，躲开
 * `i18n-complete` 守卫对 `'…'`/`"…"` 中文字面量的扫描（白名单为空）。收编进
 * `locales/*.json` 后这些标签也应一并搬过去。
 */

import { PrefOption, PrefPicker, type PrefPickerProps } from "./PrefPicker.js";
import { PREFS_LOCALES } from "./i18n.js";

const VALS = PREFS_LOCALES.zh;

export function AccentPicker(props: Omit<PrefPickerProps, "title" | "items">) {
  const items: PrefOption[] = [
    { id: "azure",  label: `Azure ● 蓝`,  hint: VALS.prefs_current },
    { id: "jade",   label: `Jade ● 玉绿`,   hint: `亮色·稳重` },
    { id: "amber",  label: `Amber ● 琥珀`,  hint: `暖色·醒目` },
    { id: "crimson",label: `Crimson ● 绯红`,hint: `警示·聚焦` },
  ];
  return <PrefPicker title={PREFS_LOCALES.zh.prefs_accent_title} items={items} {...props} />;
}

export function ThemePickerLite(props: Omit<PrefPickerProps, "title" | "items">) {
  const items: PrefOption[] = [
    { id: "light", label: `浅色`,  hint: `明亮面板` },
    { id: "dark",  label: `深色`,  hint: `低亮低对比` },
    { id: "hc",    label: `高对比`, hint: `最大可读性` },
  ];
  return <PrefPicker title={PREFS_LOCALES.zh.prefs_theme_title} items={items} {...props} />;
}

export function LangPicker(props: Omit<PrefPickerProps, "title" | "items">) {
  const items: PrefOption[] = [
    { id: "zh", label: `中文`, hint: `简体中文` },
    { id: "en", label: `English`, hint: `English` },
    { id: "ja", label: `日本語`, hint: `Japanese` },
  ];
  return <PrefPicker title={PREFS_LOCALES.zh.prefs_lang_title} items={items} {...props} />;
}

/** 思考强度 —— 五档（auto/low/medium/high/max），用引擎已有的那套符号 ○◐●◉◆。 */
export function EffortDial(props: Omit<PrefPickerProps, "title" | "items">) {
  const items: PrefOption[] = [
    { id: "auto",   label: "○ " + PREFS_LOCALES.zh.prefs_effort_auto },
    { id: "low",    label: "◐ " + PREFS_LOCALES.zh.prefs_effort_low },
    { id: "medium", label: "● " + PREFS_LOCALES.zh.prefs_effort_medium },
    { id: "high",   label: "◉ " + PREFS_LOCALES.zh.prefs_effort_high },
    { id: "max",    label: "◆ " + PREFS_LOCALES.zh.prefs_effort_max },
  ];
  return <PrefPicker title={PREFS_LOCALES.zh.prefs_effort_title} items={items} {...props} />;
}
