/**
 * `$EDITOR` 往返 —— 把草稿写到临时文件、拉起外部编辑器、读回内容。
 *
 * 借鉴 `dsh-TUI-main/src/utils/externalEditor.ts`（MIT）：**解析/回读的规则照抄**，
 * 终端交接那半边**不抄**（他们用的是 fork 版 ink 的 `enter/exitAlternateScreen`
 * 私有实例，ace 的上游内核没这条契约 —— 见 `.recon/C-interaction.md` §③ 第 13 条）。
 *
 * 抄来的三条（他们 `:65-91`、`:239-292`）：
 *   1. `$EDITOR` 可以带参数（`"code --wait"`），拆命令行要**认引号**；
 *   2. 读回时两侧都把 CRLF 归一成 LF —— 只改行尾的编辑器不该算"改过"；
 *   3. 归一后草稿本来不以换行收尾、而存盘多了一个换行 ⇒ 去掉**那一个**
 *      （编辑器保存时补的终止换行，不是用户内容；用户自己加的空行留着）。
 *
 * 与他们**不一样**的一条：他们故意**没有兜底编辑器**（`EDITOR` 没设就报
 * `unavailable`，理由是"把不认识 vi 的人丢进 vi 是陷阱"）。本任务要求按平台兜底
 * `notepad` / `vi`（`✗` 不许出现上游品牌，兜底这两个是通用编辑器），所以
 * `resolveEditorCommand` 永远返回一条命令，`unavailable` 这个结局不存在。
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 一趟外部编辑的结局。
 *
 *   - `edited`：存盘内容与草稿不同 ⇒ 采纳 `text`
 *   - `unchanged`：内容一样，或编辑器**非零退出**（`:cq` 那种"我反悔了"的语义）⇒ 草稿不动
 *   - `failed`：进程起不来 / 临时文件读写挂了（`message` 里是失败的命令或错误原文）
 */
export type EditorOutcome =
  | { kind: 'edited'; text: string }
  | { kind: 'unchanged' }
  | { kind: 'failed'; message: string };

/**
 * 按引号拆一行命令（`code --wait`、`"C:\Program Files\...\nvim.exe" -f`）。
 * 单双引号都认；引号本身不进 argv。
 */
export function splitEditorCommand(commandLine: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: string | null = null;
  let hasToken = false;
  for (const ch of commandLine) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current !== '' || hasToken) args.push(current);
      current = '';
      hasToken = false;
      continue;
    }
    current += ch;
  }
  if (current !== '' || hasToken) args.push(current);
  return args;
}

/** 没设 `EDITOR` 时的兜底（按平台）。 */
export function defaultEditorCommand(platform: string = process.platform): string {
  return platform === 'win32' ? 'notepad' : 'vi';
}

/**
 * 解析出要拉起的 argv：`$EDITOR` → `$VISUAL` → 平台兜底。**永远有值**（不返回 undefined）。
 *
 * 为什么 `EDITOR` 优先于 `VISUAL`：readline 的惯例是 `VISUAL` 优先，但本任务的
 * 硬要求写的是"用 `process.env.EDITOR`"；ace 侧没有 `VISUAL` 的既有习惯，
 * 按任务来（`EDITOR` 优先，`VISUAL` 当次选）。
 */
export function resolveEditorCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): string[] {
  const raw = (env.EDITOR ?? '').trim() || (env.VISUAL ?? '').trim();
  const argv = raw === '' ? [] : splitEditorCommand(raw);
  return argv.length > 0 ? argv : [defaultEditorCommand(platform)];
}

export interface RunEditorOptions {
  /** 环境变量来源（测试注入）。 */
  env?: NodeJS.ProcessEnv;
  /** 平台判定（测试注入）。 */
  platform?: string;
  /** spawn 注入口（测试的可失败路径）。默认真 `spawn`。 */
  spawnFn?: typeof spawn;
}

/** 临时文件后缀：`.md` 让认 markdown 的编辑器（nvim/nano 语法）有高亮。 */
const DRAFT_FILE = 'draft.md';

/**
 * 编辑一段草稿。**绝不抛** —— 文件/进程/清理的每一种失败都映射成结局，
 * 界面去提示，而不是让调用方接一个没人处理的 rejection。
 */
export async function editInExternalEditor(
  draft: string,
  options: RunEditorOptions = {},
): Promise<EditorOutcome> {
  const argv = resolveEditorCommand(options.env ?? process.env, options.platform ?? process.platform);
  const launch = options.spawnFn ?? spawn;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), 'ace-draft-'));
    const file = join(dir, DRAFT_FILE);
    await writeFile(file, draft, 'utf8');

    const code = await new Promise<number>((resolve) => {
      let settled = false;
      const done = (value: number): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        // `stdio: 'inherit'`：真编辑器要拿到终端。**不用 pipe** —— 这里不需要捕获输出，
        // 而 pipe 在受限沙箱下会 EPERM（管道的边界，见运行时说明）。
        const child = launch(argv[0]!, [...argv.slice(1), file], { stdio: 'inherit' });
        child.once('error', () => done(-1));
        child.once('close', (value) => done(value ?? 1));
      } catch {
        done(-1);
      }
    });

    // -1 = 进程压根没起来（ENOENT 之类）；非零退出 = 编辑器自己拒绝保存
    if (code === -1) return { kind: 'failed', message: argv[0]! };
    if (code !== 0) return { kind: 'unchanged' };

    const saved = await readFile(file, 'utf8').catch(() => null);
    if (saved === null) return { kind: 'unchanged' };

    const normalized = saved.replace(/\r\n/g, '\n');
    const original = draft.replace(/\r\n/g, '\n');
    if (normalized === original) return { kind: 'unchanged' };
    const text =
      !original.endsWith('\n') && normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
    return text === original ? { kind: 'unchanged' } : { kind: 'edited', text };
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
