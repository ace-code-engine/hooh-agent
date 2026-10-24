/**
 * working-activity — a live "working line" for DeepSeek Harness agents.
 *
 * Folds the durable session stream (turn/step/tool/stream events) plus
 * `agent/status` into a playful real-time status line, then publishes it two
 * ways, both optional:
 *
 * - TUI: registers the `${activity}` prompt slot on `ctx.tuiPrompt` when the
 *   TUI is composed; add `${activity}` to `theme.leftPrompt` to see it.
 * - Session log: appends log-only `activity/status` events (never surface
 *   events) for Web and other UI consumers; replay ignores them.
 *
 * The state machine itself lives in `./status.ts` (pure, clock-injected); this
 * module only wires events, the render tick, and the two sinks.
 * @module @deepseek-ai/dsh-working-activity
 */
import type { Context } from '@deepseek-ai/cordis';
export type * from './events.js';
export declare const name = "working-activity";
/** Configurable knobs; every key has a sane default. */
export type Config = {
    /** Playful copy pool; false renders plain functional labels. */
    phrases?: boolean;
    /** Append `activity/status` session events for UI consumers. Default OFF:
     *  dsh-session's append() cannot mark events ignorable, and the resume
     *  read path refuses logs containing unknown non-ignorable types — every
     *  appended snapshot makes the whole session unresumable. Re-enable only
     *  for a log-replaying consumer on a harness that supports ignorable
     *  appends. The live status line (prompt slot / session events) is
     *  unaffected by this flag. */
    publish?: boolean;
    /** Status render tick interval in ms. */
    tickMs?: number;
    /** Minimum interval in ms between published events while the line is stable. */
    publishIntervalMs?: number;
    /** Maximum displayed detail length (paths/commands/patterns). */
    detailLimit?: number;
    /** Exact tool-name → action-copy pools (case-insensitive match). */
    customActions?: Record<string, string[]>;
    /** Inject the `⏵` self-narration contract into the system prompt and surface it. */
    narrate?: boolean;
    /** UI language: `auto` follows `DSH_TUI_LANG` → `~/.dsh-tui/lang.json` →
     *  OS locale → zh; `zh`/`en` pin the copy directly. */
    lang?: 'auto' | 'zh' | 'en';
    /** Default frame preset name (informational for UI consumers; the TUI
     *  resolves the persisted `frames` choice itself). */
    frames?: string;
    /** lively: full flourish (default) / minimal: functional labels only. */
    mode?: 'lively' | 'minimal';
    /** Per-feature switches; explicit values override `mode` defaults. */
    features?: Record<string, boolean>;
    /** Extra thinking phrases appended to the base pool. */
    customPhrases?: string[];
    /** Show an estimated tokens/s prefix while streaming. */
    showTokPerSec?: boolean;
    /** Work reminder after this many turn-hours (0 = off). */
    workRemindAt?: number;
    /**
     * Append a JSON trace of every distinct rendered line (phase, copy-pool
     * inputs, slot) to the debug log — the only way to answer "why did it say
     * THAT" after the fact, since the line is derived, not stored. Default OFF.
     */
    debugLog?: boolean;
};
export declare const Config: Schemastery<Config>;
/**
 * Wire the working-activity plugin.
 * @param ctx - Cordis context (agent loop + session services composed).
 * @param config - Validated plugin config (schema defaults applied).
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map