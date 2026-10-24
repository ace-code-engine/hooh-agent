/**
 * **噪声圆盘**（首屏那个图形）—— `ui/ace_noise_circle.py` 的 TypeScript 镜像。
 *
 * 参考件是 `circle-noise-fill.html`：646² 画布上一个半径 0.447×边长的圆盘，按 5 层 fBm
 * 噪声的**排名**当出生阈值，3.5 秒成团点满。搬进终端就必须是**二维格子网格** ——
 * 一行几格的那种是进度条，不是这个图形。
 *
 * 与 Python 那份的分工：Python 是 `--engine` 屏的开屏（`_play_banner_animation`），
 * 这一份是 Ink 前端首屏左侧的吉祥物。**算法逐条对应**，但不追求逐帧字节相同
 * （两边的 `Math.sin`/`math.sin` 末位可能不同，而那个差别看不见）：
 * 这里钉的是结构性质 —— 确定性、成团、对称、四角空。
 */

/** 默认网格：终端格 2:1，列数要是行数的两倍才"看着圆"。 */
export const DISC_COLS = 14;
export const DISC_ROWS = 7;

/** 明暗 ramp（暗 → 亮）。空的地方是空格：圆盘是"从黑底长出来"的。 */
export const RAMP = ' ░▒▓█';

/** 噪声频率按归一化坐标调（源件那个 .05 是按 646 像素调的）。 */
export const FREQ = 1.9;
const OCTAVES = 4;
const SEED = 1;

function hash2(x: number, y: number, seed = SEED): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** 二维值噪声：格点取值、格点间平滑插值 —— 相邻格接近才有"成团生长"。 */
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** 多层值噪声（fBm）：层数越多细节越碎。 */
export function fbm(x: number, y: number, octaves = OCTAVES): number {
  let s = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < Math.max(1, octaves); o++) {
    s += amp * vnoise(x * freq, y * freq);
    norm += amp;
    freq *= 2.07;
    amp *= 0.5;
  }
  return norm ? s / norm : 0;
}

function smooth(p: number): number {
  const q = Math.max(0, Math.min(1, p));
  return q * q * (3 - 2 * q);
}

/**
 * 每格的出生阈值（`rows × cols`，圆外是 `null`）。
 *
 * 阈值 = 该格在全盘排名里归一化后的位置 ⇒ **阈值就是已填比例**（源件 :50 同一口径）。
 * `null` = 圆外，永远不填（源件那句 `continue`）。
 */
export function birthThresholds(cols = DISC_COLS, rows = DISC_ROWS, freq = FREQ): (number | null)[][] {
  const nc = Math.max(2, Math.floor(cols));
  const nr = Math.max(2, Math.floor(rows));
  const samples: Array<{ v: number; i: number; j: number }> = [];
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nc; i++) {
      const u = ((i + 0.5) / nc) * 2 - 1;
      const v = ((j + 0.5) / nr) * 2 - 1;
      if (Math.hypot(u, v) > 1) continue;
      samples.push({ v: fbm(u * freq, v * freq), i, j });
    }
  }
  const grid: (number | null)[][] = Array.from({ length: nr }, () => Array<number | null>(nc).fill(null));
  if (samples.length === 0) return grid;
  samples.sort((a, b) => a.v - b.v);
  const last = Math.max(1, samples.length - 1);
  samples.forEach((s, rank) => {
    grid[s.j]![s.i] = rank / last;
  });
  return grid;
}

export interface DiscFrameOptions {
  cols?: number;
  rows?: number;
  /** 正向帧数（0 → 满盘）。 */
  steps?: number;
  /** 接上**倒放**（填满之后往回走）—— 开屏那条"最长的时候倒放"就是这么来的。 */
  reverse?: boolean;
  ramp?: string;
  freq?: number;
}

/**
 * 圆盘的帧序列：每帧 = `rows` 行、每行 `cols` 列。
 *
 * - **末帧 == 满盘**（`reverse` 时末帧是"消散后的空"，与 Python 那份同一条口径）；
 * - 明暗走字形 ramp，**只取上段**：源件的高光只有 10%，铺满整条 ramp 会变成渐变色块。
 */
export function discFrames(options: DiscFrameOptions = {}): string[][] {
  const cols = Math.max(2, Math.floor(options.cols ?? DISC_COLS));
  const rows = Math.max(2, Math.floor(options.rows ?? DISC_ROWS));
  const steps = Math.max(2, Math.floor(options.steps ?? 6));
  const ramp = options.ramp && options.ramp.length > 1 ? options.ramp : RAMP;
  const grid = birthThresholds(cols, rows, options.freq ?? FREQ);
  const top = ramp.length - 1;

  const frameAt = (p: number): string[] => {
    const thr = smooth(p);
    const out: string[] = [];
    for (let j = 0; j < rows; j++) {
      let line = '';
      for (let i = 0; i < cols; i++) {
        const b = grid[j]![i];
        if (b === null || b === undefined || b > thr) {
          line += ' ';
          continue;
        }
        const shade = (i / Math.max(1, cols - 1) + j / Math.max(1, rows - 1)) / 2;
        const lo = Math.min(top, 2);
        line += ramp[Math.min(top, lo + Math.round(shade * (top - lo)))]!;
      }
      out.push(line);
    }
    return out;
  };

  const marks = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const frames = marks.map(frameAt);
  if (options.reverse) {
    for (let i = marks.length - 2; i >= 0; i--) frames.push(frameAt(marks[i]!));
  }
  return frames;
}
