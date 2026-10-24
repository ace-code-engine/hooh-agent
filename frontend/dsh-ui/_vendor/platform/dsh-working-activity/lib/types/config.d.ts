/**
 * Working-activity user configuration, mirroring the pi extension's
 * `~/.pi/agent/working-activity.json` shape: the UI owns the file (dsh-tui
 * persists `frames` at `~/.dsh-tui/working-activity.json`) and consumers use
 * the pure parser here to honor `mode` / `features` / `customPhrases` /
 * `customActions` without duplicating validation. No I/O — filesystem
 * ownership stays with the host.
 * @module @deepseek-ai/dsh-working-activity/config
 */
/**
 * Feature flags that can be switched independently (pi extension parity).
 *
 * Every name here is HONOURED by the DSH line (the tracker reads it). The pi
 * extension's list also carries `shimmer` and `cost` — DSH has no shimmer of
 * its own (the host renders the line) and no cost accounting, so accepting
 * those keys here would mean silently ignoring them.
 */
export declare const FEATURE_FLAGS: readonly ["phrases", "rareEggs", "nightPhrases", "weekend", "holidays", "combo", "failPhrases", "modelQuips", "continuePhrases"];
/** Feature-flag name type. */
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
/** Chinese labels for the settings panel / docs. */
export declare const FEATURE_LABELS: Record<FeatureFlag, string>;
/** The file-based config, same keys as the pi extension. */
export type WorkingActivityConfig = {
    /** Frame preset name (`random` picks one per process). */
    frames?: string;
    /** Extra thinking phrases appended to the base pool. */
    customPhrases?: readonly string[];
    /** Exact tool-name → action-copy pools (case-insensitive match). */
    customActions?: Readonly<Record<string, readonly string[]>>;
    /** Inject the `⏵` self-narration contract into the system prompt. */
    narrate?: boolean;
    /** Debug logging to `working-activity-debug.log`. */
    debugLog?: boolean;
    /** Context usage warning threshold in percent. */
    contextWarnAt?: number;
    /** Context usage danger threshold in percent. */
    contextDangerAt?: number;
    /** Show estimated output tokens per second. */
    showTokPerSec?: boolean;
    /** Hourly work-reminder threshold (0–24, 0 = off). */
    workRemindAt?: number;
    /** lively: full flourish (default) / minimal: functional labels only. */
    mode?: 'lively' | 'minimal';
    /** Per-feature switches; explicit values override `mode` defaults. */
    features?: Readonly<Record<string, boolean>>;
};
/** The defaults when nothing is configured. */
export declare const DEFAULT_ACTIVITY_CONFIG: WorkingActivityConfig;
/** Result of parsing a config file. */
export type ConfigReadResult = {
    readonly config: WorkingActivityConfig;
    /** Raw parsed object, preserving unknown keys for lossless write-back. */
    readonly raw: Record<string, unknown>;
    /** Parse error message, when the text was not a valid config object. */
    readonly error?: string;
};
/** Clamp `dangerAt` to be at least `warnAt` (percent thresholds). */
export declare function normalizeThresholds(cfg: WorkingActivityConfig): WorkingActivityConfig;
/**
 * Parse a `working-activity.json` text into a validated config. Unknown keys
 * are preserved in `raw` (for lossless write-back); invalid values are
 * dropped. A non-object root yields the defaults plus an `error`.
 * @param text - Raw file contents.
 * @returns Validated config + raw object (+ optional error).
 */
export declare function parseWorkingActivityConfig(text: string): ConfigReadResult;
/**
 * Whether a feature is on. Explicit `features` entries win; otherwise
 * `minimal` mode turns everything off.
 * @param config - Parsed config.
 * @param name - Feature flag name.
 */
export declare function featureOn(config: WorkingActivityConfig, name: FeatureFlag): boolean;
//# sourceMappingURL=config.d.ts.map