/**
 * 同步输出（DEC 私有模式 **2026**）—— 把一批写入**原子化**，消掉撕裂/频闪。
 *
 * 出处：pi 的主屏渲染器每批写入都包一层 `\x1b[?2026h` … `\x1b[?2026l`
 * （`packages/tui/src/tui-main-screen.ts:280,302`）。Claude Code 的 Ink 分支也用了它。
 *
 * 为什么需要：Ink 自己会 diff 再按帧写出，但**没有**这层包裹 —— 长转录时每次重画
 * 都是一串写入，终端可能"扫到一半"就显示出来，看起来就是闪一下。
 * 包在中间后终端会等这一批结束再一次性上屏。
 *
 * 不认识的终端会**忽略**这两个序列（私有模式约定），所以零兼容风险；就算被忽略，
 * 行为与现在完全一致。
 */

/** 只要求这一个方法，方便测试塞假流。 */
export interface WritableStream {
  write: (chunk: string) => unknown;
}

export interface SyncOutputOptions {
  /** 默认 `process.stdout.isTTY`：不是真终端（管道/测试）时**不要**包，免得污染输出。 */
  enabled?: boolean;
}

/**
 * 包住 `stream.write`，把**同一批**写入合并成一次带同步标记的写。返回还原函数。
 *
 * "同一批"的边界：Ink 一次 render 会在同一个 tick 里连续写若干段，
 * 所以用**微任务**收尾 —— 延迟为零、不会让人看出慢半拍。
 */
export function wrapSynchronizedOutput(
  stream: WritableStream,
  options: SyncOutputOptions = {},
): () => void {
  const enabled = options.enabled ?? Boolean((globalThis as { process?: { stdout?: { isTTY?: boolean } } })
    .process?.stdout?.isTTY);
  if (!enabled) return () => undefined;

  const original = stream.write.bind(stream);
  let pending = '';
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    if (!pending) return;
    const body = pending;
    pending = '';
    original(`\x1b[?2026h${body}\x1b[?2026l`);
  };

  stream.write = (chunk: string): unknown => {
    pending += String(chunk);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
    return true;
  };

  return () => {
    flush();                       // 还原前先把欠着的一批吐出去，免得丢一帧
    stream.write = original;
  };
}
