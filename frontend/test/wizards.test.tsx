/** 向导族验收：有界面形状、有键位线索、有中英对齐；不跳情。 */
import { describe, expect, it } from "vitest";

import { DoctorPanel, WIZARD_LOCALES } from "../src/components/wizards/index.js";
import { displayWidth } from "../src/render/text.js";
import { renderLines } from "./helpers/screen.js";

const t = (k: string) => (WIZARD_LOCALES.zh as Record<string, string>)[k] ?? k;

describe("wizards/ 向导族", () => {
  it("DoctorPanel 三态行都登屏，列宽对齐（中文注记不拉乱列）", () => {
    const rows = [
      { status: "ok" as const,   label: "Python（检测到 3.12）", note: "OK" },
      { status: "warn" as const, label: "前端依赖 tsx",          note: "可选" },
      { status: "err" as const,  label: "配置文件损坏",            note: "修一修" },
    ];
    const s = renderLines(<DoctorPanel rows={rows} t={t} width={70} />, 70);
    expect(s.text).toContain("环境自检");
    expect(s.text).toContain("Python");
    expect(s.text).toContain("配置文件损坏");
    expect(s.text).toContain("✓");
    expect(s.text).toContain("⚠");
    expect(s.text).toContain("✗");
    for (const line of s.lines) expect(displayWidth(line)).toBeLessThanOrEqual(70);
  });

  it("wiz_* 三语表键全且值非空", () => {
    const zh = Object.keys(WIZARD_LOCALES.zh).sort();
    expect(Object.keys(WIZARD_LOCALES.en).sort()).toEqual(zh);
    expect(Object.keys(WIZARD_LOCALES.ja).sort()).toEqual(zh);
    for (const k of zh) {
      for (const lang of ["zh", "en", "ja"] as const) {
        const v = (WIZARD_LOCALES[lang] as Record<string, string>)[k];
        expect(typeof v).toBe("string");
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });
});
