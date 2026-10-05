/** streaming/ 验收（全走真函数与渲染帧）。 */
import { describe, expect, it } from "vitest";

import {
  SearchBar, SplitDiff, StreamingMarkdown,
  STREAM_KEYS, STREAM_LOCALES,
  diffRows, flushStream, streamChunks,
} from "../src/components/streaming/index.js";
import { displayWidth } from "../src/render/text.js";
import { renderLines } from "./helpers/screen.js";
import { tick } from "./fake-engine.js";
import { mountTree } from "./mount.js";

const t = (k: string) => (STREAM_LOCALES.zh as Record<string, string>)[k] ?? k;

describe("streaming/", () => {
  it("streamChunks 只吐完整行，尾巴留尾巴；flush() 把它收走", () => {
    let work = { trailing: "", committed: [] as readonly string[] };
    let out = streamChunks("# 标题\n正文一\n未完", work);
    work = out.work;
    expect(out.flushed).toEqual(["# 标题", "正文一"]);
    expect(work.trailing).toBe("未完");
    out = streamChunks("整的一行", work);      // 没换行就不算完整
    work = out.work;
    expect(out.flushed).toEqual([]);
    out = streamChunks("\n", work);            // 现在一行完整了
    work = out.work;
    expect(out.flushed).toEqual(["未完整的一行"]);
    const finalFlush = flushStream(work);
    expect(finalFlush.flushed).toEqual([]);
  });

  it("StreamingMarkdown 按内容出列，不吞行", () => {
    const s = renderLines(<StreamingMarkdown content={"# 标题\n\n" + "**加粗字**"} width={60} />, 60);
    expect(s.text).toContain("标题");
    expect(s.text).toContain("加粗字");
    for (const l of s.lines) expect(displayWidth(l)).toBeLessThanOrEqual(60);
  });

  it("diffRows 每行一个槽位：+/-/空格/~/? 都不混淆", () => {
    const rows = diffRows(["--- a/x.ts", "-旧行", "@@ -1,2 +1,2 @@", "+新行", " 上下文", "乱入行"]);
    expect(rows.map((r) => r.slot)).toEqual(["?", "-", "~", "+", " ", "?"]);
  });

  it("SplitDiff：窄屏单列，宽屏双栏；行宽不溢出；槽位不变", () => {
    const lines = ["--- a/x.ts", "-旧行", "@@ -1,2 +1,2 @@", "+新行", " 上下文"];
    const narrow = renderLines(<SplitDiff lines={lines} width={30} />, 30);
    for (const l of narrow.lines) expect(displayWidth(l)).toBeLessThanOrEqual(30);
    expect(narrow.text).toContain("-");                       // 槽位在

    const wide = renderLines(<SplitDiff lines={lines} width={120} />, 120);
    for (const l of wide.lines) expect(displayWidth(l)).toBeLessThanOrEqual(120);
    expect(wide.text).toContain("-");
    expect(wide.text).toContain("+");
  });

  it("SearchBar：位置号 '3/12' 上屏；无命中显式写没有", () => {
    const zh = STREAM_LOCALES.zh as Record<string, string>;
    const s = renderLines(
      <SearchBar query="abc" hits={12} hitIndex={2} onChange={() => {}} onFirst={() => {}} onClose={() => {}} t={t} width={70} />,
      70,
    );
    expect(s.text).toContain("abc");
    expect(s.text).toContain("3/12");
    const s0 = renderLines(
      <SearchBar query="xyz" hits={0} onChange={() => {}} onFirst={() => {}} onClose={() => {}} t={t} width={70} />,
      70,
    );
    expect(s0.text).toContain(zh[STREAM_KEYS.none]);
  });

  it("SearchBar 按键能调 onChange（写输入）与 onClose（Esc）", async () => {
    let q = "";
    let closed = 0;
    const tree = mountTree(
      <SearchBar query={q} hits={0} onChange={(v) => { q = v; }} onFirst={() => {}} onClose={() => { closed += 1; }} t={t} width={70} />,
    );
    await tick();
    tree.stdin.write("ab");
    await tick();
    await tick();
    expect(q).toContain("ab");
    tree.stdin.write("\u001b");
    await tick();
    await tick();
    expect(closed).toBe(1);
    tree.unmount();
  });

  it("STREAM 三语表键全（zh/en/ja）", () => {
    const zh = Object.keys(STREAM_LOCALES.zh).sort();
    expect(Object.keys(STREAM_LOCALES.en).sort()).toEqual(zh);
    expect(Object.keys(STREAM_LOCALES.ja).sort()).toEqual(zh);
  });
});
