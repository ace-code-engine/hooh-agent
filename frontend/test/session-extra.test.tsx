/** 会话扩展面板验收（都来自 mountTree，都是帧证据，不许"看着绿"）。 */
import { describe, expect, it } from "vitest";

import { SessionExtra, SESSX_LOCALES } from "../src/components/session-extra/index.js";
import { displayWidth } from "../src/render/text.js";
import { renderLines } from "./helpers/screen.js";
import { tick } from "./fake-engine.js";
import { mountTree } from "./mount.js";

const t = (k: string) => SESSX_LOCALES.zh[k as keyof typeof SESSX_LOCALES.zh] ?? k;

const JOBS = [
  { id: "j1", title: "迁移仓库", status: "running" as const, startedAt: "12:00", currentStep: "P2 代码块" },
  { id: "j2", title: "回填历史", status: "ok" as const,      startedAt: "11:41", currentStep: "收口" },
];
const AGENTS = [
  { name: "R4", status: "ok" as const, under: "迁移仓库", turns: 3 },
];

describe("session-extra/", () => {
  it("三态：有数据 / 暂无 / 还没拿数（loading）清晰可见", () => {
    const s1 = renderLines(<SessionExtra jobs={JOBS} agents={AGENTS} t={t} width={90} onClose={() => {}} />, 90);
    expect(s1.text).toContain("迁移仓库");
    expect(s1.text).toContain("P2 代码块");
    expect(s1.text).toContain("R4");
    expect(s1.text).not.toContain("暂无后台任务");

    const s2 = renderLines(<SessionExtra jobs={[]} agents={[]} t={t} width={90} onClose={() => {}} />, 90);
    expect(s2.text).toContain("暂无后台任务");
    expect(s2.text).toContain("暂无子代理");

    const s3 = renderLines(<SessionExtra jobs={undefined} agents={undefined} t={t} width={90} onClose={() => {}} />, 90);
    expect(s3.text).toContain(SSESSX_LOADING_TEXT());
    function SSESSX_LOADING_TEXT() { return "读不到（稍后）"; }
  });

  it("每行不超出列宽（中文不劈一半）", () => {
    const s = renderLines(<SessionExtra jobs={JOBS} agents={AGENTS} t={t} width={70} onClose={() => {}} />, 70);
    for (const line of s.lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(70);
    }
  });

  it("Tab 切窗，Enter 只奏当窗那一列的焦点", async () => {
    let picked: string | null = null;
    const tree = mountTree(
      <SessionExtra jobs={JOBS} agents={AGENTS} t={t} width={90}
        onPick={(_kind, id) => { picked = id; }}
        onClose={() => {}} />,
    );
    await tick();
    expect(picked).toBeNull();
    tree.stdin.write("\u0009");          // Tab 到 agents 列
    await tick();
    tree.stdin.write("\r");              // Enter
    await tick();
    expect(picked).toBe("R4");
    tree.unmount();
  });

  it("Esc 能关", async () => {
    let closed = 0;
    const tree = mountTree(
      <SessionExtra jobs={JOBS} agents={AGENTS} t={t} width={90} onClose={() => { closed += 1; }} />,
    );
    await tick();
    tree.stdin.write("\u001b");
    await tick();
    await tick();
    expect(closed).toBe(1);
    tree.unmount();
  });

  it("SESSX 三语表键组逐字一致", () => {
    const zh = Object.keys(SESSX_LOCALES.zh).sort();
    expect(Object.keys(SESSX_LOCALES.en).sort()).toEqual(zh);
    expect(Object.keys(SESSX_LOCALES.ja).sort()).toEqual(zh);
  });
});
