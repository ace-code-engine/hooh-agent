/**
 * 选择器的**焦点与窗口算术** —— 纯函数，不碰 Ink、不读终端宽度。
 *
 * ## 借鉴（dsh-TUI，MIT；只借口径，不拷文件）
 *
 * | 我们这里 | 上游落点 | 借的是什么 |
 * |---|---|---|
 * | `listWindow` | `src/components/listWindow.ts:22-49`（编译产物 `lib/types/components/listWindow.js:22-49`） | 按**行**预算开窗：从焦点项向两侧**交替**扩张，优先补累计行数少的一侧（焦点大致居中）；任一侧再加会超预算或到边界就停 |
 * | `PickerRow.height` | `lib/types/components/MigratePicker.js:22` | 每项**恒占固定行高**（标签 1 行 + 说明 1 行），预算按行算而不是按项数算 |
 * | `pickerWindow` | `lib/types/components/CommandSuggestions.js:31-46` | 窗口被裁剪时如实报出上下各藏了几项（脚注），而不是闷掉 |
 *
 * ## 我们的差异（有意为之，不是漏抄）
 *
 * 1. **不要 `gap` 参数**：上游那个 `gap` 是给「容器 gap 空行」留的；我们把**组标题行
 *    也算进该项自己的 `height`**（见 `pickerWindow`），一个参数就够，少一个能传错的旋钮。
 * 2. **窗口首项落在组中段时补一行组标题**：上游卡片里没有分组概念（分组在 ace 的
 *    `render/menu.ts` 那侧）。补出来的这一行要**从预算里扣掉**，否则"行预算"是假的 ——
 *    多出来的标题行会把面板撑破，正是窗口化要防的那类 bug。
 * 3. **边界不环绕**：到顶/到底就停。与 ace 既有口径一致（`render/menu.windowBounds`
 *    的 docstring："列表有头有尾，转圈会让人分不清自己走到哪了"）。上游的
 *    `chatOverlay.wrapIndex` 是环绕的，这条**故意不抄**。
 */

export interface PickerRow {
  /** 该项的正文行高：1 = 只有标签，2 = 标签 + 说明。 */
  height: number;
  /** 分组标题（**已翻译**）。同组连续项里只有第一条给 `group` 也够用 —— 判据是"与上一项不同"，不是"自己非空"。 */
  group?: string;
}

/** 该项是不是它所在组的**第一条**（`group` 与上一项不同）。 */
export function isGroupStart(rows: readonly PickerRow[], index: number): boolean {
  const group = rows[index]?.group;
  return Boolean(group) && group !== rows[index - 1]?.group;
}

/** 把焦点夹进 `[0, count)`；空列表或非法值一律回 0。 */
export function clampFocus(focus: number, count: number): number {
  const n = Math.max(0, Math.trunc(count) || 0);
  if (n === 0) return 0;
  const f = Math.trunc(focus);
  if (!Number.isFinite(f)) return 0;
  return Math.min(Math.max(f, 0), n - 1);
}

/** 相对移动焦点并夹边界（**不环绕**）。`delta` 为 0、NaN 时原地不动。 */
export function moveFocus(focus: number, delta: number, count: number): number {
  const d = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return clampFocus(clampFocus(focus, count) + d, count);
}

/** 勾选/取消一个 key；返回**新数组**（不改原数组）。顺序 = 勾选先后。 */
export function toggleKey(keys: readonly string[], key: string): string[] {
  const out = keys.filter((k) => k !== key);
  if (out.length === keys.length) out.push(key);
  return out;
}

/**
 * 焦点居中的窗口切片（按行预算）。
 *
 * 策略与上游 `listWindow` 相同：从焦点出发两边交替长，**焦点可见性优先于预算** ——
 * 焦点项本身就超过 `maxRows` 时仍然单独把它返回（宁可超一行，也不能让光标消失在屏幕外）。
 *
 * @param heights - 每项的固定行高（≥1）。
 * @param focusIndex - 焦点项下标（越界自动夹）。
 * @param maxRows - 列表区可用**行数**。
 */
export function listWindow(
  heights: readonly number[],
  focusIndex: number,
  maxRows: number,
): { start: number; end: number } {
  if (heights.length === 0) return { start: 0, end: 0 };
  const focus = clampFocus(focusIndex, heights.length);
  const raw = Math.trunc(maxRows);
  const budget = Number.isFinite(raw) ? Math.max(1, raw) : 1;
  const h = (i: number): number => Math.max(1, Math.trunc(heights[i] ?? 1) || 1);

  let start = focus;
  let end = focus + 1;
  let upUsed = 0;
  let downUsed = 0;
  for (;;) {
    const up = start > 0 ? h(start - 1) : Number.POSITIVE_INFINITY;
    const down = end < heights.length ? h(end) : Number.POSITIVE_INFINITY;
    const used = h(focus) + upUsed + downUsed;
    const canUp = used + up <= budget;
    const canDown = used + down <= budget;
    if (!canUp && !canDown) return { start, end };
    if (canUp && (!canDown || upUsed <= downUsed)) {
      start -= 1;
      upUsed += up;
    } else {
      end += 1;
      downUsed += down;
    }
  }
}

export interface PickerWindow {
  /** 可见区间 `[start, end)`（**项**下标）。 */
  start: number;
  end: number;
  /** 首项位于组中段时，需要在它上方补的那一行组标题（已翻译）。 */
  leadGroup: string | undefined;
  /** 焦点上方还有几**项**没画出来（脚注用）。 */
  hiddenAbove: number;
  hiddenBelow: number;
}

/**
 * 选择器实际要画的那一段：把「组标题行」也算进行预算后的窗口。
 *
 * 组标题的账只有两种情形：
 *   - 首项**正好是**某组第一条 → 它那 1 行已经算进 `heights`（见下），直接画；
 *   - 首项落在组中段（上一项同组、但没画出来）→ 必须补 1 行标题，于是**从预算里扣 1 行重算**。
 *
 * 扣完那 1 行后若新的首项仍在组中段，仍然只需要补 1 行 → 总行数恰好回到预算内，
 * 所以重算一次就够（不必循环）。
 */
export function pickerWindow(
  rows: readonly PickerRow[],
  focusIndex: number,
  maxRows: number,
): PickerWindow {
  if (rows.length === 0) {
    return { start: 0, end: 0, leadGroup: undefined, hiddenAbove: 0, hiddenBelow: 0 };
  }
  const raw = Math.trunc(maxRows);
  const budget = Number.isFinite(raw) ? Math.max(1, raw) : 1;
  // 组标题行算在**它所属的第一项**头上：于是"每项行高固定"这条依然成立。
  const heights = rows.map((r, i) => Math.max(1, Math.trunc(r.height) || 1) + (isGroupStart(rows, i) ? 1 : 0));

  const leadOf = (start: number): string | undefined => {
    const group = rows[start]?.group;
    return group && !isGroupStart(rows, start) ? group : undefined;
  };

  let win = listWindow(heights, focusIndex, budget);
  let leadGroup = leadOf(win.start);
  if (leadGroup !== undefined && budget > 1) {
    win = listWindow(heights, focusIndex, budget - 1);
    leadGroup = leadOf(win.start);
  } else if (budget <= 1) {
    leadGroup = undefined; // 预算只剩一行：焦点优先，标题让位
  }
  return {
    start: win.start,
    end: win.end,
    leadGroup,
    hiddenAbove: win.start,
    hiddenBelow: rows.length - win.end,
  };
}
