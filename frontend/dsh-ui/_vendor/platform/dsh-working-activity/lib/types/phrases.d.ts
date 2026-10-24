/**
 * Copy pools for the working-activity status line: short, colloquial, playful
 * fragments with a "live person" vibe, in both Chinese and English. The zh
 * pools are the original copy; the en pools mirror the same tone — deadpan,
 * meme-y, occasionally unhinged. Everything here is pure data + pure pickers;
 * the active language is resolved per pick via `langNow()`.
 * @module @deepseek-ai/dsh-working-activity/phrases
 */
import type { WaitingReason } from './activity-event.js';
/** A pool of copy fragments. */
export type PhrasePool = readonly string[];
/** Pick one random entry; repeated draws avoid the previous entry when possible. */
export declare function pickPhrase(entries: PhrasePool, previous?: string): string;
/** A rotation window: the turn's seed, and which window of it. */
export interface PhraseSlot {
    readonly seed: number;
    readonly slot: number;
}
/**
 * Deterministic 32-bit mix of a seed and a window index (avalanche, then mask).
 *
 * The point is reproducibility, not cryptography: the same inputs must always
 * produce the same value, so a reader may re-derive a phrase as often as it
 * likes without the copy moving under it.
 */
export declare function mixSlot(seed: number, slot: number): number;
/**
 * Deterministic sibling of {@link pickPhrase}.
 *
 * The projected line is READ far more often than it is written — a client ticks
 * it, the host validates it, a checkpoint may re-render it — so picking at
 * random inside a read makes the copy churn on every read (measured: three
 * different phrases across three consecutive 500 ms reads). This picks by
 * position instead: one phrase per window, always the same phrase for the same
 * window, and adjacent windows differ.
 * @param entries - The pool to draw from.
 * @param seed - Per-turn seed (the turn's start time), so turns differ.
 * @param slot - Rotation window index within the phase.
 */
export declare function pickPhraseAt(entries: PhrasePool, seed: number, slot: number): string;
/** Thinking phrases while the model works without a tool. */
export declare const THINKING_PHRASES: readonly string[];
/** Tiered phrases when thinking runs long (elapsed >= threshold). */
export declare const THINKING_TIERS: readonly {
    /** Minimum thinking ms for this tier. */
    readonly atMs: number;
    readonly pool: readonly string[];
}[];
/** Phrases shown while waiting for the first streamed token. */
export declare const WAITING_PHRASES: readonly string[];
/** Tool-name patterns mapped to playful action verbs. */
export declare const ACTION_MAP: readonly {
    readonly test: RegExp;
    readonly actions: readonly string[];
}[];
/** Fallback verbs for unknown tools. */
export declare const FALLBACK_ACTIONS: readonly string[];
/** Tool failure phrases, replacing a bare ✗. */
export declare const FAIL_PHRASES: readonly string[];
/** Turn-completion phrases. */
export declare const DONE_PHRASES: readonly string[];
/** Night-owl phrases mixed in between 00:00 and 06:00 local time. */
export declare const NIGHT_PHRASES: readonly string[];
/** English thinking phrases — casual, meme-y, alive. */
export declare const EN_THINKING_PHRASES: readonly string[];
/** English tiered phrases when thinking runs long. */
export declare const EN_THINKING_TIERS: readonly {
    readonly atMs: number;
    readonly pool: readonly string[];
}[];
/** English phrases while waiting for the first token. */
export declare const EN_WAITING_PHRASES: readonly string[];
/** English tool-name → action verbs. */
export declare const EN_ACTION_MAP: readonly {
    readonly test: RegExp;
    readonly actions: readonly string[];
}[];
/** English fallback verbs for unknown tools. */
export declare const EN_FALLBACK_ACTIONS: readonly string[];
/** English tool failure phrases. */
export declare const EN_FAIL_PHRASES: readonly string[];
/** English turn-completion phrases. */
export declare const EN_DONE_PHRASES: readonly string[];
/** English night-owl phrases. */
export declare const EN_NIGHT_PHRASES: readonly string[];
/** Rare easter-egg phrases (1/150 draw, pi `RARE_PHRASES`). */
export declare const RARE_PHRASES: readonly string[];
/** English rare easter-egg phrases. */
export declare const EN_RARE_PHRASES: readonly string[];
/** Chance of drawing a rare phrase per thinking rotation. */
export declare const RARE_CHANCE: number;
/** Weekend-greeting phrases (once per turn on Sat/Sun). */
export declare const WEEKEND_PHRASES: readonly string[];
/** English weekend greetings. */
export declare const EN_WEEKEND_PHRASES: readonly string[];
/** Whether `date` falls on a weekend. */
export declare function isWeekend(date: Date): boolean;
/** Holiday copy keyed by `MM-DD` (zh). */
export declare const HOLIDAY_PHRASES: Readonly<Record<string, readonly string[]>>;
/** English holiday copy keyed by `MM-DD`. */
export declare const EN_HOLIDAY_PHRASES: Readonly<Record<string, readonly string[]>>;
/** Lunar New Year copy (approximated by Gregorian dates, extended yearly). */
export declare const LUNAR_NEW_YEAR_PHRASES: readonly string[];
/** English Lunar New Year copy. */
export declare const EN_LUNAR_NEW_YEAR_PHRASES: readonly string[];
/**
 * Gregorian dates marked as Lunar New Year (2025–2030, extend yearly).
 *
 * Each year lists the seven-day holiday block starting at the new moon.
 * `tests/easter-eggs.spec.ts` fails when the table no longer covers the
 * current year + 1, so an expired table goes red in CI instead of silently
 * stopping the egg.
 */
export declare const LUNAR_NEW_YEAR_DAYS: Readonly<Record<string, true>>;
/** Phrases shown after the user interrupts and the model resumes. */
export declare const CONTINUE_PHRASES: readonly string[];
/** English post-interruption phrases. */
export declare const EN_CONTINUE_PHRASES: readonly string[];
/** Phrases after a successful context compaction. */
export declare const COMPACT_PHRASES: readonly string[];
/** English post-compaction phrases. */
export declare const EN_COMPACT_PHRASES: readonly string[];
/** Urgent phrases when compaction is forced by overflow. */
export declare const OVERFLOW_PHRASES: readonly string[];
/** English overflow phrases. */
export declare const EN_OVERFLOW_PHRASES: readonly string[];
/** Phrases when retrying after a forced compaction. */
export declare const COMPACT_RETRY_PHRASES: readonly string[];
/** English compact-retry phrases. */
export declare const EN_COMPACT_RETRY_PHRASES: readonly string[];
/**
 * Phrases while the provider asked for a retry (rate limit / transient error).
 * The waiting pool cannot say this: "still queuing" reads as the model's own
 * latency, while a retry is the provider pushing back.
 */
export declare const RETRY_PHRASES: readonly string[];
/** English retry phrases. */
export declare const EN_RETRY_PHRASES: readonly string[];
/** Phrases while a tool is parked on the user's approval. */
export declare const APPROVAL_PHRASES: readonly string[];
/** English approval phrases. */
export declare const EN_APPROVAL_PHRASES: readonly string[];
/** Phrases while the host is compacting the context. */
export declare const COMPACTION_START_PHRASES: readonly string[];
/** English compaction-in-progress phrases. */
export declare const EN_COMPACTION_START_PHRASES: readonly string[];
/**
 * Pick the copy for one waiting reason, in the active language.
 *
 * Deterministic per stall: the caller seeds the draw with the turn and the
 * stall's start, so repeated reads of one stall show one line (a per-read
 * re-roll is the flicker bug this module's slot scheme exists to prevent).
 * @param reason - Why the turn is stalled.
 * @param at - Slot (seed + window) making the pick reproducible.
 */
export declare function waitingReasonPhrase(reason: WaitingReason, at?: PhraseSlot): string;
/** Model-switch quips keyed by a lowercase substring of the model id. */
export declare const MODEL_QUIPS: Readonly<Record<string, readonly string[]>>;
/** English model-switch quips. */
export declare const EN_MODEL_QUIPS: Readonly<Record<string, readonly string[]>>;
/** Detect a holiday for `date`, Lunar New Year first. */
export declare function holidayPhrase(date: Date, at?: PhraseSlot): string | null;
/** Pick a rare easter-egg phrase in the active language. */
export declare function rarePhrase(previous?: string, at?: PhraseSlot): string;
/** Pick a weekend greeting in the active language. */
export declare function weekendPhrase(previous?: string, at?: PhraseSlot): string;
/** Pick a post-interruption phrase in the active language. */
export declare function continuePhrase(): string;
/** Pick a post-compaction phrase in the active language. */
export declare function compactPhrase(): string;
/** Pick an overflow phrase in the active language. */
export declare function overflowPhrase(): string;
/** Pick a compact-retry phrase in the active language. */
export declare function compactRetryPhrase(): string;
/**
 * Quip for a model id (substring match), or null when no pool matches.
 * @param modelId - Model id, e.g. `deepseek-chat` or `gpt-4o`.
 */
export declare function modelQuip(modelId: string): string | null;
/** Feature toggles for the lively phrase selector. */
export interface LivelyFeatures {
    /** Allow rare 1/150 easter eggs. */
    readonly rareEggs?: boolean;
    /** Allow weekend greetings on Sat/Sun. */
    readonly weekend?: boolean;
    /** Allow date-matched holiday / Lunar New Year copy. */
    readonly holidays?: boolean;
    /** Mix night-owl copy between 00:00 and 06:00. */
    readonly nightPhrases?: boolean;
}
/**
 * Pick a thinking phrase with the pi extension's egg order: holiday first,
 * then rare (1/150), then weekend, then the elapsed-time tiers with night
 * mixing. Every egg is gated by `features` (defaults all on).
 * @param elapsedMs - Milliseconds spent thinking in the current phase.
 * @param previous - Previously shown phrase, to avoid repeats.
 * @param night - Whether the night window is active (mixes night copy).
 * @param now - Current wall-clock time (injectable for tests).
 * @param features - Feature toggles; absent flags default to on.
 * @param extra - User custom phrases appended to the base thinking pool.
 */
export declare function livelyThinkingPhrase(elapsedMs: number, previous?: string, night?: boolean, now?: Date, features?: LivelyFeatures, extra?: readonly string[]): string;
/** Common git tool names / bash commands containing `git `. */
export declare const GIT_TOOL_RE: RegExp;
/** Detect the 00:00–06:00 night window (local time). */
export declare function isNight(hour: number): boolean;
/** The zh or en base waiting pool by the active language. */
export declare function waitingPool(): readonly string[];
/**
 * Pick a thinking phrase appropriate for the elapsed thinking time, in the
 * active language.
 * @param elapsedMs - Milliseconds spent thinking in the current phase.
 * @param previous - Previously shown phrase, to avoid repeats.
 * @param night - Mix night-owl copy into the pool.
 * @param extra - User custom phrases appended to the base (non-tier) pool.
 */
export declare function thinkingPhrase(elapsedMs: number, previous?: string, night?: boolean, extra?: readonly string[], at?: PhraseSlot): string;
/** Pick a waiting phrase in the active language. */
export declare function waitingPhrase(previous?: string, at?: PhraseSlot): string;
/**
 * The line shown when thinking turns into doing: the turn's first tool call.
 *
 * Deliberately its own pool rather than part of the thinking copy — it marks a
 * transition, so it must read as one ("thought it through, getting to work")
 * instead of as another "the model is busy" fragment.
 */
export declare const TOOL_OPENING_PHRASES: readonly string[];
/** English mirror of {@link TOOL_OPENING_PHRASES}. */
export declare const EN_TOOL_OPENING_PHRASES: readonly string[];
/** Pick the thinking→doing opening line in the active language. */
export declare function toolOpeningPhrase(at?: PhraseSlot): string;
/** Pick a tool-failure phrase in the active language. */
export declare function failPhrase(): string;
/** Pick a turn-completion phrase in the active language. */
export declare function donePhrase(): string;
/**
 * Map a tool name to a playful action verb, in the active language.
 * @param toolName - Registry tool name (unqualified).
 * @param custom - Exact-name custom action pools, matched case-insensitively
 *   (user-owned copy, used verbatim in any language).
 */
export declare function actionFor(toolName: string, custom?: Readonly<Record<string, readonly string[]>>): string;
/** Whether a tool is a git operation (name match, or a shell command containing `git `). */
export declare function isGitTool(toolName: string, args?: Readonly<Record<string, unknown>>): boolean;
/** Format milliseconds as a compact human duration (`1m23s`). */
export declare function fmtDuration(ms: number): string;
//# sourceMappingURL=phrases.d.ts.map