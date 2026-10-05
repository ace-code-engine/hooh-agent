/**
 * 偏好选择器族的验收：每一项都必须**帧证据证明**，不许"看着像"。
 * 键走 mountTree 的假 stdin（与 scroll-box.test.tsx 同款的 tick 形状）。
 */
import { describe, expect, it } from "vitest";

import { AccentPicker, EffortDial, LangPicker, PrefRow, ThemePickerLite } from "../src/components/prefs/index.js";
import { PREFS_KEYS, PREFS_LOCALES } from "../src/components/prefs/i18n.js";
import { displayWidth } from "../src/render/text.js";
import { renderLines } from "./helpers/screen.js";
import { tick } from "./fake-engine.js";
import { mountTree } from "./mount.js";

const pickZh = (k: string) => k;

describe("prefs/ 偏好选择器", () => {
  it("四件套都能渲出带符号的整屏幕（含选中行）", () => {
    const accent = renderLines(<AccentPicker t={pickZh} onPick={() => {}} onClose={() => {}} width={80} />, 80);
    expect(accent.text).toContain("Jade ● 玉绿");             // 外语名 + 中文说明
    expect(accent.text).toContain("强调色");                     // 三语表里的 zh 标题

    const theme = renderLines(<ThemePickerLite t={pickZh} onPick={() => {}} onClose={() => {}} width={80} />, 80);
    expect(theme.text).toContain("高对比");

    const lang = renderLines(<LangPicker t={pickZh} onPick={() => {}} onClose={() => {}} width={80} />, 80);
    expect(lang.text).toContain("日本語");

    const dial = renderLines(<EffortDial t={pickZh} onPick={() => {}} onClose={() => {}} width={80} />, 80);
    expect(dial.text).toContain("◆");                          // max 档符号（与 ui/ace_effort 对齐）
  });

  it("PrefRow 的宽度按列宽走，两行不会交错", () => {
    const s = renderLines(
      <div>
        <PrefRow item={{ id: "a", label: "宽" }} focused={true} current={false} comboWidth={8} />
        <PrefRow item={{ id: "b", label: "普通项" }} focused={false} current={true} comboWidth={8} />
      </div>,
      40,
    );
    for (const line of s.lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(40);
    }
  });

  it("↑↓ 能移动；回车选定当前那一项；按数字直接选", async () => {
    let picked: string | null = null;
    const tree = mountTree(
      <LangPicker t={pickZh} width={80} onPick={(id) => { picked = id; }} onClose={() => {}} />,
    );
    await tick();
    tree.stdin.write("\u001b[B");    // ↓
    await tick();
    tree.stdin.write("\r");          // Enter
    await tick();
    expect(picked).toBe("en");
    tree.unmount();

    picked = null;
    const t2 = mountTree(
      <LangPicker t={pickZh} width={80} onPick={(id) => { picked = id; }} onClose={() => {}} />,
    );
    await tick();
    t2.stdin.write("3");             // 直接按 3 ⇒ ja
    await tick();
    expect(picked).toBe("ja");
    t2.unmount();
  });

  it("Esc 关掉面板", async () => {
    let closed = 0;
    const tree = mountTree(
      <LangPicker t={pickZh} width={80} onPick={() => {}} onClose={() => { closed += 1; }} />,
    );
    await tick();
    tree.stdin.write("\u001b");
    await tick();
    await tick();          // 内核的 Esc 要再等一拍才被当'独立 Esc'（CSI 序列防呆）
    expect(closed).toBe(1);
    tree.unmount();
  });

  it("PREFS_KEYS 的每个键在 zh/en/ja 里都有非空值", () => {
    for (const k of Object.values(PREFS_KEYS)) {
      for (const lang of ["zh", "en", "ja"] as const) {
        const row = PREFS_LOCALES[lang] as Record<string, string>;
        expect(typeof row[k], `缺 ${lang}.${k}`).toBe("string");
        expect(row[k].length).toBeGreaterThan(0);
      }
    }
  });
});
