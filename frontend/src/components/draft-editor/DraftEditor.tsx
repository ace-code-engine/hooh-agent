/**
 * 全屏草稿编辑器 —— **独立组件**，本波不接进 `App.tsx`（整合是下一波的事）。
 *
 * 借鉴 `dsh-TUI-main/src/components/PromptInput.tsx` 的**展开态编辑区**
 * （MIT，行号槽 `:3580-3596`、行窗口粘边 `:3365-3381`、Enter=换行/Tab=4 空格
 * `:2502-2565`）与 `PromptEditor.tsx` 的**整屏接管**（`:60-89`）。
 *
 * ## 与他们不一样的三条（都是有意的）
 *
 *   1. **不抄 module 级 sink + 挂在根末尾压兄弟**（`PromptEditor.tsx:22-89`）。
 *      那条契约依赖 fork 版 ink 的绘制顺序与 `opaque` 背景；ace 用上游内核，
 *      改成**整屏路由**：谁挂这个组件谁就占屏（`.recon/C-interaction.md` §③ 第 16 条）。
 *   2. **不铺背景色**（他们给编辑区上 `inputBackground`）。`docs/TUI-SWISS-SPEC.md`
 *      §1.5 明令禁止铺底色；光标行用**行号加粗 + 强调色**区分，选中范式仍是反显。
 *   3. **不做词级 undo**。撤销按 ace 的键位与粒度（`ctrl+_` / `ctrl+shift+-`，
 *      `ui/ace_keys.py:244-245`，逐键撤一步）—— 见 `Draft.undo` 的注释。
 *
 * ## 键位与语义（**确认 / 取消是明确的两条**）
 *
 * | 键 | 语义 |
 * |---|---|
 * | `Ctrl+S` | **确认**：`onConfirm(草稿全文)` —— 采纳 |
 * | `Esc` | **取消**：`onCancel()` —— **丢弃**本次进入编辑器后的所有改动（调用方自己决定要不要保留原文） |
 * | `Ctrl+_` / `Ctrl+Shift+-` | 撤销一步（ace 键位） |
 * | `Ctrl+G` | `$EDITOR` 往返（ace 注册表里 `external_editor` 的默认键，`keys/registry.ts:291`） |
 * | `Enter` / `Ctrl+J` / `Shift+Enter` | 插入换行（**不发送** —— 全屏编辑里回车必须是换行，照他们 `:2560-2565`） |
 * | `Tab` | 插入 4 个空格 |
 * | `←→↑↓` `Home` `End` `PgUp` `PgDn` | 光标移动（PgUp/PgDn 按可见行数翻） |
 * | `Ctrl+A` `Ctrl+E` `Ctrl+U` `Ctrl+K` `Ctrl+W` | 行首/行尾/删到行首/删到行尾/删一个词（与 `Input.tsx` 同口径） |
 * | `Backspace` `Delete` | 按**字**删（代理项不会被劈开） |
 *
 * ## i18n
 *
 * 文案一律走 `t()`，但**本波 `locales/*.json` 被别的写手独占**，不能加键 ——
 * 所以新键集中声明在 `DRAFT_KEYS` 里（不写 `t('字面量')`），并把三语值列进
 * `.recon/Q5-draft-editor.md`。整合波把那四个键写进三份字典即可，组件不用改。
 */

import { Box, Text, TerminalSizeContext, useInput } from '../../../vendor/dsh-ink/kernel.js';
import React, { useCallback, useReducer, useRef, useState } from 'react';

import { useColumns } from '../design-system/index.js';
import { Rule } from '../layout/PageMargin.js';
import { g } from '../../render/glyphs.js';
import { windowBounds } from '../../render/menu.js';
import { Draft, draftRows } from './buffer.js';
import { editInExternalEditor } from './external-editor.js';

export type Translate = (key: string, params?: Record<string, string | number>) => string;
export type ColorFn = (token: string) => string | undefined;

/**
 * 本组件新增的 i18n 键（三语值见 `.recon/Q5-draft-editor.md`）。
 * **刻意不写成 `t('draft_editor_title')`**：`test/i18n-complete.test.ts` 要求每个
 * 字面量键都已存在于三份字典里，而本波不加 locales —— 写成字面量会当场变红。
 */
export const DRAFT_KEYS = {
  title: 'draft_editor_title',
  position: 'draft_position',
  failed: 'draft_editor_failed',
  confirm: 'key_confirm',
} as const;

/** 编辑区之外的固定开销：标题 + 细线 + 位置行 + 提示行。 */
const CHROME_ROWS = 4;

export interface DraftEditorProps {
  /** 进入编辑器时的草稿全文（光标落在末尾）。 */
  value: string;
  t: Translate;
  color: ColorFn;
  /** `Ctrl+S`：采纳这段草稿。 */
  onConfirm: (text: string) => void;
  /** `Esc`：取消本次编辑。 */
  onCancel: () => void;
  /** 渲染宽度（列）。不给就取 `TerminalSizeContext`，再不给 80。 */
  width?: number;
  /** 终端高度（行）。不给就取 context，再不给 30。 */
  rows?: number;
  /** `$EDITOR` 解析用的环境变量（默认 `process.env`；测试注入假编辑器）。 */
  env?: NodeJS.ProcessEnv;
}

/**
 * 全屏草稿编辑。**它假设自己独占屏幕** —— 调用方负责只挂它一个。
 */
export function DraftEditor({
  value,
  t,
  color,
  onConfirm,
  onCancel,
  width,
  rows,
  env,
}: DraftEditorProps): React.ReactElement {
  const draftRef = useRef<Draft | null>(null);
  if (draftRef.current === null) draftRef.current = new Draft(value);
  const draft = draftRef.current;

  // 缓冲区是可变的（纯逻辑层），渲染靠这一颗计数器推。
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [notice, setNotice] = useState<string | null>(null);
  /** 外部编辑器跑着的时候吞掉所有键（终端已经交出去了，回来的字节不该编辑草稿）。 */
  const busyRef = useRef(false);

  const columns = useColumns(width);
  const terminalRows = rows ?? React.useContext(TerminalSizeContext)?.rows ?? 30;
  const visible = Math.max(1, terminalRows - CHROME_ROWS);
  const gutter = Math.max(2, String(draft.lineCount).length);

  const runEditor = useCallback(async (): Promise<void> => {
    busyRef.current = true;
    try {
      const outcome = await editInExternalEditor(draft.text, env === undefined ? {} : { env });
      if (outcome.kind === 'edited') {
        draft.replace(outcome.text);
        setNotice(null);
      } else if (outcome.kind === 'failed') {
        setNotice(t(DRAFT_KEYS.failed, { name: outcome.message }));
      } else {
        setNotice(null);
      }
    } finally {
      busyRef.current = false;
      bump();
    }
  }, [draft, env, t]);

  useInput(
    (input, key) => {
      if (busyRef.current) return;

      // ① 两个出口（确认/取消）排在最前面 —— 不许被任何编辑分支截胡
      if (key.ctrl && input === 's') {
        onConfirm(draft.text);
        return;
      }
      if (key.escape) {
        onCancel();
        return;
      }
      // ② 撤销：ace 的键位（`ui/ace_keys.py:244-245`），逐键一步
      if (key.ctrl && (input === '_' || input === '-')) {
        draft.undo();
        bump();
        return;
      }
      // ③ 外部编辑器（ace 注册表里 external_editor 的默认键）
      if (key.ctrl && input === 'g') {
        void runEditor();
        return;
      }
      // ④ 换行：全屏编辑里回车**不发送**（他们 `:2560-2565`）
      if (key.return) {
        draft.insert('\n');
        bump();
        return;
      }
      if (key.tab) {
        draft.insert('    ');
        bump();
        return;
      }
      if (key.backspace) {
        draft.backspace();
        bump();
        return;
      }
      if (key.delete) {
        draft.deleteForward();
        bump();
        return;
      }
      if (key.upArrow) {
        draft.moveUp();
        bump();
        return;
      }
      if (key.downArrow) {
        draft.moveDown();
        bump();
        return;
      }
      if (key.leftArrow) {
        draft.moveLeft();
        bump();
        return;
      }
      if (key.rightArrow) {
        draft.moveRight();
        bump();
        return;
      }
      if (key.pageUp) {
        draft.movePage(-1, visible);
        bump();
        return;
      }
      if (key.pageDown) {
        draft.movePage(1, visible);
        bump();
        return;
      }
      if (key.home) {
        draft.moveLineStart();
        bump();
        return;
      }
      if (key.end) {
        draft.moveLineEnd();
        bump();
        return;
      }
      if (key.ctrl && input === 'a') {
        draft.moveLineStart();
        bump();
        return;
      }
      if (key.ctrl && input === 'e') {
        draft.moveLineEnd();
        bump();
        return;
      }
      if (key.ctrl && input === 'u') {
        draft.killToStart();
        bump();
        return;
      }
      if (key.ctrl && input === 'k') {
        draft.killToEnd();
        bump();
        return;
      }
      if (key.ctrl && input === 'w') {
        draft.killWordLeft();
        bump();
        return;
      }
      // ⑤ 普通输入（含整块粘贴：`input` 里带 `\n` 由缓冲区自己拆行）
      if (input && !key.ctrl && !key.meta) {
        draft.insert(input);
        bump();
      }
    },
    { isActive: true },
  );

  const { from } = windowBounds(draft.lineCount, draft.row, visible);
  const rowsOut = draftRows(draft, { from, count: visible, width: columns, gutter });

  const hints = [
    t('key_hint', { shortcut: 'Ctrl+S', action: t(DRAFT_KEYS.confirm) }),
    t('key_hint', { shortcut: 'Ctrl+_', action: t('key_undo') }),
    t('key_hint', { shortcut: 'Ctrl+G', action: t('key_editor') }),
    t('key_hint', { shortcut: 'Esc', action: t('key_cancel') }),
  ].join('   ');

  return (
    <Box flexDirection="column" width={columns}>
      <Text bold color={color('accent')}>
        {t(DRAFT_KEYS.title)}
      </Text>
      <Rule width={columns} bleed={false} color={color} />

      {rowsOut.map((row) => (
        <Text key={row.no} wrap="truncate-end">
          <Text
            bold={row.isCaret}
            color={row.isCaret ? color('accent') : color('dim')}
          >
            {`${String(row.no).padStart(gutter)} ${g('│')} `}
          </Text>
          {row.isCaret ? (
            <>
              <Text color={color('text')}>{row.before}</Text>
              <Text color={color('accent')} inverse>
                {row.caret === '' ? g('▌') : row.caret}
              </Text>
              <Text color={color('text')}>{row.after}</Text>
            </>
          ) : (
            <Text color={color('text')}>{row.before}</Text>
          )}
        </Text>
      ))}

      <Text color={color('dim')} wrap="truncate-end">
        {t(DRAFT_KEYS.position, { line: draft.row + 1, total: draft.lineCount })}
      </Text>
      <Text color={color('dim')} wrap="truncate-end">
        {hints}
      </Text>
      {notice === null ? null : (
        <Text color={color('warn')} wrap="truncate-end">
          {notice}
        </Text>
      )}
    </Box>
  );
}
