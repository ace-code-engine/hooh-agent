/**
 * Markdown 受控子集解析 —— **纯函数**，不碰 Ink。
 *
 * 为什么不用现成的 markdown 库：Python 侧（`ui/ace_markdown.py`）刻意只做**受控子集**，
 * 理由写在那边 —— 模型输出的 Markdown 里什么样的怪东西都有（未闭合的代码围栏、
 * 嵌套十几层的列表、表格里塞管道符），一个"什么都能解析"的库会把这些照单全收，
 * 然后渲染成一屏谁也看不懂的东西。这里只认"终端里渲染出来是有意义的"那几种。
 *
 * 刻意**不做**：HTML、脚注、引用链接、嵌套列表（>1 层）、表格。
 * 遇到不认识的就当普通段落文字 —— **不丢内容**比"结构化得对"重要。
 *
 * 解析与渲染分离：本模块产出 Block 树（可穷举断言），Ink 组件只负责把它画出来。
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: Span[][] }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'table'; rows: TableRow[] }
  | { kind: 'hr' };

/**
 * 表格的一行 = **单元格数组**；一个单元格 = **行内片段数组**（与段落同构，可取粗体/行内代码）。
 * 三层容易写错成两层，所以给个名字。
 */
export type TableRow = Span[][];

/** 行内解析：`**粗**` / `*斜*` / `` `码` ``。都不嵌套（受控子集的取舍）。 */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  // 三段一起扫，保证 `**a** *b*` 这种混排按出现顺序切分。
  const re = /(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    const tok = m[0]!;
    if (tok.startsWith('**')) spans.push({ text: tok.slice(2, -2), bold: true });
    else if (tok.startsWith('`')) spans.push({ text: tok.slice(1, -1), code: true });
    else spans.push({ text: tok.slice(1, -1), italic: true });
    last = m.index + tok.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length ? spans : [{ text }];
}

const FENCE = /^\s*(```+|~~~+)\s*(\w*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*([-*_])\s*(\1\s*){2,}$/;
const UL = /^(\s*)[-*+]\s+(.*)$/;
const OL = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
/** 表格分隔行：`|---|:--:|`。判据与 `ui/ace_markdown._TABLE_SEP` 同一套。 */
const TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/** 像表格行吗？（至少两个 `|`，且不是围栏）—— 与 `ace_markdown.is_table_row` 同口径。 */
export function isTableRow(line: string): boolean {
  const t = String(line ?? '').trim();
  return (t.match(/\|/g)?.length ?? 0) >= 2 && !t.startsWith('```');
}

/** 拆单元格：去掉首尾的 `|`，各格 trim。 */
function splitCells(line: string): string[] {
  let t = String(line ?? '').trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

/**
 * 把一段 Markdown 解析成 Block 列表。
 *
 * 未闭合的代码围栏**按已闭合处理**（把剩下的都当代码）—— 流式渲染时"围栏刚打了一半"
 * 是常态，若按未闭合丢弃，用户会看到代码块闪一下再没了。
 */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = String(text ?? '').split('\n');

  let para: string[] = [];
  let list: { ordered: boolean; items: Span[][] } | null = null;
  let quote: string[] = [];
  let fence: { lang: string; lines: string[] } | null = null;

  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ kind: 'paragraph', spans: parseInline(para.join('\n')) });
      para = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
      list = null;
    }
  };
  const flushQuote = (): void => {
    if (quote.length) {
      blocks.push({ kind: 'quote', spans: parseInline(quote.join('\n')) });
      quote = [];
    }
  };
  const flushAll = (): void => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]!;
    const line = raw.replace(/\s+$/, '');

    if (fence) {
      const close = FENCE.exec(line);
      if (close) {
        blocks.push({ kind: 'code', lang: fence.lang, lines: fence.lines });
        fence = null;
      } else {
        fence.lines.push(raw);
      }
      continue;
    }

    const openFence = FENCE.exec(line);
    if (openFence) {
      flushAll();
      fence = { lang: openFence[2] ?? '', lines: [] };
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    if (HR.test(line)) {
      flushAll();
      blocks.push({ kind: 'hr' });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      flushAll();
      blocks.push({ kind: 'heading', level: h[1]!.length, spans: parseInline(h[2]!.trim()) });
      continue;
    }

    const ul = UL.exec(line);
    const ol = OL.exec(line);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const ordered = Boolean(ol);
      const body = (ol ? ol[2] : ul![2])!.trim();
      // 换列表类型（有序↔无序）就另起一个块，别混在一起
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(parseInline(body));
      continue;
    }

    const q = QUOTE.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]!);
      continue;
    }

    // 表格：本行像表行、**且下一行是分隔行**（`|---|:--:|`）—— 两条都满足才当表。
    // 只看"有竖线"会把正文里随手一个 `|` 误判成表（Python 侧 `is_table_row` +
    // `_TABLE_SEP` 同一条判据）。表在第一个非表行/空行处结束。
    if (isTableRow(line) && li + 1 < lines.length
        && TABLE_SEP.test((lines[li + 1] ?? '').trim())) {
      flushAll();
      const rows: TableRow[] = [];
      let i = li;
      for (; i < lines.length; i++) {
        const t = (lines[i] ?? '').trim();
        if (!t || !isTableRow(t)) break;
        if (TABLE_SEP.test(t)) continue;         // 分隔行不进数据
        rows.push(splitCells(t).map((c) => parseInline(c)));
      }
      if (rows.length) {
        blocks.push({ kind: 'table', rows });
        li = i - 1;
        continue;
      }
    }

    flushList();
    flushQuote();
    para.push(line);
  }

  if (fence) blocks.push({ kind: 'code', lang: fence.lang, lines: fence.lines }); // 未闭合也收
  flushAll();
  return blocks;
}

/**
 * 流式渲染的收尾判定：这段文本现在是不是**处在一个未闭合的代码围栏里**。
 *
 * 有了它，流式过程中就能把"还开着的那段"当代码块画，而不是等闭合了再突然变形 ——
 * 后者表现为代码在屏幕上"跳"一下，很像卡了。
 */
export function inOpenFence(text: string): boolean {
  let open = false;
  for (const line of String(text ?? '').split('\n')) {
    if (FENCE.test(line)) open = !open;
  }
  return open;
}

/** 纯文本化（供不需要样式的场合：日志、错误摘要、测试断言）。 */
export function toPlainText(blocks: Block[]): string {
  const spanText = (spans: Span[]): string => spans.map((s) => s.text).join('');
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        out.push(spanText(b.spans));
        break;
      case 'paragraph':
        out.push(spanText(b.spans));
        break;
      case 'quote':
        out.push(spanText(b.spans));
        break;
      case 'list':
        b.items.forEach((it, i) => out.push(`${b.ordered ? `${i + 1}.` : '-'} ${spanText(it)}`));
        break;
      case 'code':
        out.push(...b.lines);
        break;
      case 'table':
        // 单元格之间用 ` | ` 连，行间换行 —— 纯文本场合（日志/断言）看得懂就行
        b.rows.forEach((r) => out.push(r.map(spanText).join(' | ')));
        break;
      case 'hr':
        out.push('---');
        break;
    }
  }
  return out.join('\n');
}
