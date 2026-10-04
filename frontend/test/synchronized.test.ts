/**
 * 同步输出包裹的测试 —— 一条不显眼但**直接决定频闪**的机制。
 *
 * 判据三件：① 同一批多段写入合并成**一次**带 `?2026` 的写；
 * ② 非 TTY（管道/测试）时**完全不包**（否则往管道里灌控制序列）；
 * ③ 还原函数把 `write` 放回去，并把欠着的一批先吐出去（不丢帧）。
 */

import { describe, expect, it } from 'vitest';

import { wrapSynchronizedOutput, type WritableStream } from '../src/tui/synchronized.js';

function fake(): { stream: WritableStream; out: string[] } {
  const out: string[] = [];
  return { out, stream: { write: (chunk: string) => { out.push(chunk); return true; } } };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('同步输出（?2026）', () => {
  it('同一批写入合并成一次带同步标记的写', async () => {
    const { stream, out } = fake();
    const restore = wrapSynchronizedOutput(stream, { enabled: true });
    stream.write('第一段');
    stream.write('第二段');
    expect(out).toHaveLength(0);            // 还没到微任务，一段都别急着吐
    await tick();
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('\x1b[?2026h第一段第二段\x1b[?2026l');
    restore();
  });

  it('不是 TTY 就完全不包（管道里不许出现控制序列）', async () => {
    const { stream, out } = fake();
    const restore = wrapSynchronizedOutput(stream, { enabled: false });
    stream.write('裸写');
    await tick();
    expect(out).toEqual(['裸写']);
    restore();
  });

  it('还原时把欠着的一批先吐出去，并把 write 放回原样', async () => {
    const { stream, out } = fake();
    const restore = wrapSynchronizedOutput(stream, { enabled: true });
    stream.write('欠着的一批');
    restore();                              // 还没到微任务就还原
    expect(out).toEqual(['\x1b[?2026h欠着的一批\x1b[?2026l']);
    stream.write('还原之后');
    await tick();
    expect(out[out.length - 1]).toBe('还原之后');
  });
});
