/**
 * Language resolution + copy dictionary for the working-activity plugin.
 *
 * The plugin follows the dsh-tui UI language without importing it: the same
 * chain dsh-tui resolves (`DSH_TUI_LANG` env → `~/.dsh-tui/lang.json` → OS
 * locale → zh) is read here directly, so a `/lang en|zh` switch (or the
 * /settings language pick) hot-swaps this plugin's narration and status-line
 * copy on the next render tick.
 *
 * Resolution order:
 *   1. `setLangOverride()` — a plugin-level `lang: zh|en` config key
 *      (cordis.yml) or an explicit test pin.
 *   2. `DSH_TUI_LANG` env var — pinned at process start.
 *   3. `~/.dsh-tui/lang.json` — the persisted dsh-tui choice, mtime-cached
 *      so the per-tick status render never re-reads an unchanged file.
 *   4. OS locale guess (`LC_ALL` / `LC_MESSAGES` / `LANG`); POSIX/C means
 *      "no locale selected" and maps to English.
 *   5. `zh` — the original hard-coded language.
 *
 * The dictionary is a flat key → per-language string map; `t(key, params)`
 * substitutes `{{name}}` placeholders. Missing keys render the key itself so
 * a typo is visible instead of silently blank.
 * @module @deepseek-ai/dsh-working-activity/lang
 */
export type Lang = 'zh' | 'en';
/** The languages shipped with the plugin, in display order. */
export declare const LANGS: readonly ["zh", "en"];
declare const dict: {
    readonly 'narrate-instruction': {
        readonly zh: "[状态栏] 你有一个状态栏展示给用户。【必须】在每个步骤/子任务开始时（不只是调用工具前），在回复正文的最前面单独写一行：⏵ 你在做的具体事情（不超过20字），然后换行继续正常回复。整轮回复只写一行 ⏵，不要重复。信息为主——让人一眼知道你在干什么，风格自然、可以带点俏皮。例：⏵ 修复登录页样式、⏵ 查一下报错原因、⏵ 给补丁跑个验证。切换任务时必须更新。";
        readonly en: "[Status line] You have a status line visible to the user. [Required] At the start of each step or subtask (not only before tool calls), write exactly one standalone line at the very beginning of your response: ⏵ a concrete description of what you are doing (20 words max), then continue with the normal response on the next line. Write only one ⏵ line per response and do not repeat it. Prioritize information so the user can understand the current work at a glance; keep the style natural and optionally playful. Examples: ⏵ Fixing the login page styles, ⏵ Investigating the error, ⏵ Running validation for the patch. Update it when the task changes.";
    };
    /** Plain (non-playful) phase labels. */
    readonly 'waiting-label': {
        readonly zh: "等待模型响应";
        readonly en: "Waiting for model";
    };
    readonly 'thinking-label': {
        readonly zh: "思考中";
        readonly en: "Thinking";
    };
    /** Elapsed suffix: zh glues the char, en keeps a space. */
    readonly 'line-elapsed': {
        readonly zh: "总{{elapsed}}";
        readonly en: "total {{elapsed}}";
    };
    /** Plain-mode completion prefix (playful pools pick their own). */
    readonly 'done-prefix': {
        readonly zh: "搞定 ✓";
        readonly en: "Finished";
    };
    /** Turn-completion summary. */
    readonly 'done-summary': {
        readonly zh: "{{tools}} · 想{{thinking}} 干{{tooling}}";
        readonly en: "{{tools}} · thought {{thinking}} worked {{tooling}}";
    };
    readonly 'tool-count-one': {
        readonly zh: "{{count}} 工具";
        readonly en: "{{count}} tool";
    };
    readonly 'tool-count-many': {
        readonly zh: "{{count}} 工具";
        readonly en: "{{count}} tools";
    };
    /** Consecutive-tool streak badge (replaces the old flame emoji). */
    readonly 'tool-streak': {
        readonly zh: "工具x{{count}}";
        readonly en: "tool x{{count}}";
    };
    /** Approval badge while a tool is parked on the user's decision. */
    readonly 'tool-waiting-approval': {
        readonly zh: "在等你批准";
        readonly en: "awaiting your approval";
    };
    /** Subagent count in the done summary. */
    readonly 'subagent-count': {
        readonly zh: "子代理 {{count}} 个";
        readonly en: "{{count}} subagents";
    };
    /** Work-reminder copy after `workRemindAt` turn-hours. */
    readonly 'work-remind': {
        readonly zh: "已连续工作 {{hours}} 小时，歇会儿？";
        readonly en: "Worked {{hours}}h straight — take a break?";
    };
};
export type I18nKey = keyof typeof dict;
export type I18nParams = Record<string, string | number>;
/** Force (or release) the active language; `auto` re-enables the chain. */
export declare function setLangOverride(lang: Lang | 'auto'): void;
/** The currently active language. */
export declare function langNow(): Lang;
/** Translate a dictionary key, substituting `{{name}}` placeholders. */
export declare function t(key: I18nKey, params?: I18nParams): string;
/** Is a value a valid shipped language code? */
export declare function isLang(value: unknown): value is Lang;
/**
 * Read the persisted dsh-tui language choice.
 *
 * The probe is cached twice over: the parsed value is reused while the file's
 * mtime is unchanged, and even the `statSync` itself is skipped for
 * {@link LANG_FILE_PROBE_TTL_MS}. Both halves matter — one render translates
 * several keys, and a host that never wrote the file would otherwise pay a
 * FAILED stat on every one of them (issue #14).
 *
 * @param nowMs - Instant to measure the probe cache against.
 * @returns the persisted language, or `undefined` when the file is absent or
 * holds no valid `{ lang }` value.
 */
export declare function readLangFile(nowMs?: number): Lang | undefined;
/**
 * Drop the file cache so the next read probes the filesystem immediately.
 * Called whenever the language is pinned explicitly, so a switch is never
 * delayed by the probe TTL.
 */
export declare function invalidateLangCache(): void;
/**
 * Guess the language from the OS locale (`LC_ALL`, `LC_MESSAGES`, `LANG`),
 * defaulting to `zh`. POSIX/C means "no locale selected" and conventionally
 * maps to English (what CI runners report). An absent locale variable
 * (typical on Windows) defaults to `zh`.
 */
export declare function detectLocaleLang(): Lang;
export {};
//# sourceMappingURL=lang.d.ts.map