/**
 * Pure activity state machine for the working-activity status line. Consumes
 * session events (turn/step/tool/stream) plus agent running/idle transitions
 * and renders a human-readable status line at any wall-clock instant. No I/O,
 * no timers, no cordis — deterministic given the event stream and a clock.
 * @module @deepseek-ai/dsh-working-activity/status
 */
import type { ActivityEvent } from './activity-event.js';
import { feedSessionEvent } from './compat/session-events.js';
/** Public status phases a UI can render. */
export type ActivityPhase = 'idle' | 'waiting' | 'thinking' | 'tool' | 'done';
/**
 * Compatibility handle for {@link ActivityTracker.snapshot} output.
 *
 * The snapshot shape is private to this module; this number is the only part a
 * consumer may rely on. Bump it whenever the emitted shape changes, so a
 * persisted projection checkpoint from an older build is discarded (the host
 * refolds the log) instead of being misread as the new shape.
 */
export declare const TRACKER_SNAPSHOT_VERSION = 6;
/** One snapshot of the model's activity, renderable by any UI. */
export interface ActivityState {
    /** Which activity phase the model is in right now. */
    readonly phase: ActivityPhase;
    /** Full human-readable status line (plain text, no ANSI). */
    readonly line: string;
    /** Short label of the current work (tool action or stage), when any. */
    readonly label?: string;
    /** Detail fragment (path / command / search pattern), when any. */
    readonly detail?: string;
    /** The playful phrase currently shown. */
    readonly phrase?: string;
    /** Tools completed in the current turn. */
    readonly toolCount: number;
    /** Wall-clock milliseconds since the current turn started (0 when idle). */
    readonly turnElapsedMs: number;
    /** Wall-clock time the current phase started, for animations. */
    readonly phaseStartedAt: number;
}
/** Per-turn thinking/tooling split, exposed for done summaries and stats. */
export interface TurnStats {
    /** Milliseconds the model was thinking (between turn start and first tool / turn end). */
    readonly thinkingMs: number;
    /** Milliseconds spent inside tool executions. */
    readonly toolMs: number;
    /** Tools completed in the turn. */
    readonly toolCount: number;
}
/** Easter-egg toggles for the thinking phrase (pi extension parity). */
export interface TrackerFeatures {
    /** Rare 1/150 easter eggs. */
    readonly rareEggs?: boolean;
    /** Weekend greetings on Sat/Sun. */
    readonly weekend?: boolean;
    /** Date-matched holiday / Lunar New Year copy. */
    readonly holidays?: boolean;
    /** Night-owl copy between 00:00 and 06:00. */
    readonly nightPhrases?: boolean;
    /** Consecutive-tool streak badge. */
    readonly combo?: boolean;
    /** Playful failure copy when the turn's last tool failed. */
    readonly failPhrases?: boolean;
    /** Quips on a model route change. */
    readonly modelQuips?: boolean;
    /** Comeback quip after the user interrupts. */
    readonly continuePhrases?: boolean;
}
/** Configuration knobs for the state machine (subset of plugin Config). */
export interface TrackerConfig {
    /** Playful copy pool on/off; false renders plain functional labels. */
    readonly phrases: boolean;
    /** Maximum characters of a detail fragment (paths/commands). */
    readonly detailLimit: number;
    /** Hide the status line while idle. */
    readonly showIdle: boolean;
    /** Easter-egg toggles; absent flags default to on. */
    readonly features?: TrackerFeatures;
    /** User custom phrases appended to the base thinking pool. */
    readonly customPhrases?: readonly string[];
    /** Show an estimated tokens/s prefix while streaming (pi parity). */
    readonly showTokPerSec?: boolean;
    /** Work reminder after this many turn-hours (0 = off). */
    readonly workRemindAt?: number;
}
/**
 * Extract a displayable detail fragment from a tool call's parsed arguments.
 * @param toolName - Registry tool name.
 * @param args - Parsed tool arguments (lossless JSON by registry contract).
 */
export declare function detailFor(toolName: string, args: Readonly<Record<string, unknown>> | undefined, limit: number): string;
/**
 * Track one agent's activity from its durable session events. Events from
 * other sessions are ignored (the owning plugin feeds only the agent it
 * displays). The tracker is deliberately single-agent: multi-session UIs
 * instantiate one tracker per agent.
 */
export declare class ActivityTracker {
    private readonly config;
    private readonly now;
    private readonly customActions?;
    private phase;
    private phaseStartedAt;
    private turnStartedAt;
    private thinkingStartedAt;
    private thinkingMs;
    private toolMs;
    private toolCount;
    /** When the turn's first tool started; 0 until it does (see {@link toolOpening}). */
    private firstToolStartedAt;
    private activeTools;
    private doneQueue;
    private thinkingPhases;
    private waitingFirstToken;
    /**
     * When the first streamed token arrived (0 = none yet).
     *
     * Live-only knowledge on the current host line (deltas are frames, not
     * durable events), so the projection learns it through the live overlay —
     * without it the projected line stays in the waiting pool all generation.
     */
    private firstTokenAt;
    /** Latest `⏵` self-narration line extracted from the stream, or null. */
    private narratedText;
    /** Wall-clock time of the most recent stream delta (narration freshness). */
    private lastChunkAt;
    /** Rolling window of VISIBLE text deltas, for `⏵` extraction (see onEvent). */
    private recentStream;
    /** Total tokens reported across the turn's assistant messages. */
    private turnTokens;
    /** Completion prefix drawn ONCE at turn end so the done line stays stable. */
    private donePrefix;
    /** One-off copy pinned by an external event (interrupt / model switch /
     *  compaction / work reminder), shown until it expires. */
    private pendingPhrase;
    private pendingUntil;
    /** Git branch of the session cwd (fed by the host, best-effort). */
    private gitBranch;
    /** Last model route announced, so a repeated selection stays quiet. */
    private model;
    /** Consecutive fast tool streak (combo). */
    private streak;
    private lastToolEndAt;
    private maxStreak;
    /** Subagent (agent/task) calls in the current turn. */
    private subagentCount;
    /**
     * Why the turn is stalled, when it is (retry / approval / compaction).
     *
     * A stall is state, not decoration: "waiting on the model" and "the model is
     * waiting on YOU" need different copy, so it outranks the phrase pools and
     * survives `phrases: false`.
     */
    private waitingReason;
    /** When the current stall began (seeds its copy; 0 with no stall). */
    private waitingReasonAt;
    /** Streaming token estimate for the tps prefix. */
    private tokBuf;
    private tokWindowStart;
    /**
     * @param config - Behavioral knobs.
     * @param now - Wall-clock supplier (injectable for tests).
     * @param customActions - Exact-name custom action pools for {@link actionFor}.
     */
    constructor(config: TrackerConfig, now?: () => number, customActions?: Readonly<Record<string, readonly string[]>> | undefined);
    /** Agent transitioned to running/idle. */
    onAgentStatus(status: 'idle' | 'running'): void;
    /** The user interrupted the running turn: show a comeback quip next. */
    onInterrupted(): void;
    /**
     * The model was switched: quip for the new model id.
     *
     * Repeats are ignored. A `model/selection` event is logged whenever the host
     * validates a selection — including a re-selection of the current model and
     * every replay of the log — and re-announcing the same model would replace
     * whatever the line is saying with a stale quip.
     */
    onModelSwitch(modelId: string): void;
    /** A context compaction finished (or overflowed): quip about it. */
    onCompact(kind: 'done' | 'overflow'): void;
    /** Feed the session cwd's git branch (best-effort, host-resolved). */
    onGitBranch(branch: string | undefined): void;
    /**
     * Consume one normalized activity event. This is the state machine's only
     * input: host payload shapes are normalized in `src/compat/*` first, so a
     * host-line drift never reaches this switch.
     */
    onEvent(event: ActivityEvent): void;
    /**
     * Feed one raw durable session event.
     * @deprecated Host-shape input kept for one release so an already-published
     * consumer that drives this tracker itself (dsh-TUI ≤ 0.11.x calls this
     * method) keeps working across the upgrade. New code normalizes through
     * `src/compat/*` and calls {@link onEvent}. The parameter type is inferred
     * from the compat function on purpose — this module must not import a DSH
     * type.
     * @param event - Raw durable session event.
     */
    onSessionEvent(event: Parameters<typeof feedSessionEvent>[1]): void;
    /** Render the current status snapshot at a wall-clock instant. */
    render(nowMs?: number): ActivityState;
    /** Per-turn thinking/tooling split for stats consumers. */
    stats(): TurnStats;
    /**
     * Opaque, JSON-safe snapshot of this tracker's complete state.
     *
     * A persisted projection checkpoint has to resume folding **without**
     * replaying a session's whole log, so the state machine must be able to hand
     * its state out and take it back. The shape is not public API: pass the value
     * straight back to {@link ActivityTracker.restore}. {@link TRACKER_SNAPSHOT_VERSION}
     * is the compatibility handle between the two.
     * @returns every field the fold depends on, as JSON-safe values.
     */
    snapshot(): unknown;
    /**
     * Rebuild a tracker from {@link snapshot} output.
     *
     * The behavioral knobs are not part of the snapshot, so they are passed in
     * again; everything the fold accumulates is restored. Mutable entries are
     * cloned, so the restored tracker can never write back into the value the
     * caller still holds as a checkpoint.
     * @param config - Behavioral knobs.
     * @param now - Wall-clock supplier.
     * @param customActions - Custom action pools.
     * @param payload - A value previously returned by `snapshot()`.
     * @returns an equivalent tracker that can keep folding.
     * @throws when the payload is not a snapshot of {@link TRACKER_SNAPSHOT_VERSION}
     * — a caller holding a stale checkpoint must refold the log rather than render
     * a state it cannot interpret.
     */
    static restore(config: TrackerConfig, now?: () => number, customActions?: Readonly<Record<string, readonly string[]>>, payload?: unknown): ActivityTracker;
    /**
     * The next instant at which {@link render} can produce a different line, or
     * `undefined` when the line stays exactly as it is until another event
     * arrives.
     *
     * A status line does not need a heartbeat: it needs to be redrawn when
     * something it displays moves. Those movements are all known here — the
     * elapsed second, the phrase rotation, a narration or tok/s window closing,
     * and the done card swapping its tool fragment for the summary — so a caller
     * can sleep exactly that long instead of polling. Idle and settled lines
     * return `undefined`: nothing about them changes on its own, so they need no
     * timer at all. Transitions on a longer horizon than the displayed second
     * (the work reminder, for one) need no candidate of their own: the elapsed
     * counter redraws long before them.
     *
     * The value is a lower bound on the next visible change, so waking at it can
     * only be early, never late.
     * @param nowMs - Wall-clock instant to measure from.
     * @returns the next wake instant in epoch milliseconds, or `undefined`.
     */
    nextWakeAt(nowMs?: number): number | undefined;
    /**
     * Wake instant for a live phase that displays the turn's elapsed second: the
     * next whole second, whichever of the other displayed windows closes first,
     * and the phrase rotation — or the expiry of a one-off quip, which the render
     * after it replaces.
     * @param nowMs - Wall-clock instant to measure from.
     * @param elapsedFrom - Instant the displayed second counter counts from.
     */
    private liveWakeAt;
    /** When the displayed phrase is replaced: a rotation, or a quip expiring. */
    private rotationWakeAt;
    /** When the currently displayed narration expires, if one is displayed. */
    private narrationWakeAt;
    /** When the displayed tok/s estimate ages out, if one is displayed. */
    private tpsWakeAt;
    private renderThinking;
    /**
     * The live facts a projection cannot fold, when any.
     *
     * A projection folds DURABLE events only, but two things the line displays
     * are born on live stream frames: the `⏵` narration, and — the one this
     * exists for — **that the first token already arrived**. Without the latter
     * a projected line sits in the waiting pool for the entire generation (the
     * frames never fold on the current host line), telling the user "still
     * queuing" while the model has been writing for a minute. A live host hands
     * both over per read (see `ActivityProjectionOptions.live`).
     */
    liveState(): {
        readonly narration?: string;
        readonly lastChunkAt?: number;
        readonly firstTokenAt?: number;
    };
    /**
     * The live narration this tracker is currently showing, if any.
     *
     * Narrow view of {@link liveState} for callers that only narrate.
     */
    liveNarration(): {
        readonly narration: string;
        readonly lastChunkAt: number;
    } | undefined;
    /**
     * Apply the live host's facts to a (restored) projected copy.
     *
     * The state itself never changes — the overlay paints a throwaway render:
     * the narration when the host has one, and the first-token promotion when
     * the host has seen output the fold could not see.
     * @param live - What the live host knows (any subset).
     */
    applyLiveState(live: {
        narration?: string;
        lastChunkAt?: number;
        firstTokenAt?: number;
    }): void;
    /**
     * Show `narration` as if it had just streamed in.
     *
     * Used by the live overlay: the projected state carries no frames, so the
     * host paints the freshest narration it has over the folded value.
     */
    applyLiveNarration(narration: string, at: number): void;
    /**
     * The first streamed token arrived at `at` — leave the waiting pool.
     *
     * Idempotent (a second call does nothing), and a delta that arrives while a
     * tool runs must not steal the phase: models may stream text after a tool
     * call inside the same attempt, and the tool is what the user is actually
     * waiting on — the tool result hands the phase back to thinking on its own.
     */
    private promoteFirstToken;
    /**
     * The "thought it through, getting to work" line for the turn's first tool.
     *
     * Shown as a prefix for a short window after that tool starts, then gone: it
     * marks the thinking→doing boundary once per turn, and being derived (like
     * every other phrase) it neither rotates nor repeats within the window.
     * @param nowMs - Wall-clock instant to test.
     * @returns the opening copy, or '' when the window is closed.
     */
    private toolOpening;
    /**
     * The just-finished tool, while its copy is still worth reading.
     *
     * Derived from the last settled tool's end time, so it neither lingers past
     * its window nor depends on how often the line is read. `✓` marks it as
     * settled, so it cannot be mistaken for the running-tool line.
     * @param nowMs - Wall-clock instant to test.
     * @returns the settled-tool state, or null when the window is closed.
     */
    private settledToolLine;
    /**
     * The pending one-off quip (interrupt / model / compact), while fresh.
     *
     * A pure read: an expired quip is simply not returned (the field is
     * overwritten by the next one), and the work reminder has its own derived
     * window — the old version wrote here (`pendingPhrase = null`,
     * `reminded = true`), which a projection's throwaway restore discarded, so
     * the reminder re-fired on EVERY read and pinned the line for the rest of
     * the turn.
     */
    private pendingPhraseAt;
    /**
     * The work reminder, purely derived from elapsed time.
     *
     * Shown for {@link PENDING_MS} of wall time each time another `workRemindAt`
     * hours of continuous work accumulate (`hours % workRemindAt` is the distance
     * into the current bucket). No state: repeated reads agree, a resumed
     * checkpoint renders the same answer, and the reminder returns every bucket
     * instead of once per process.
     */
    private workReminderAt;
    /** Estimated tokens/s while the stream is fresh (pi parity, opt-in). */
    private tpsPrefix;
    private doneSummary;
    /** The fresh self-narration line, or null once the stream has been quiet. */
    private freshNarration;
    private primaryTool;
    private turnElapsedMs;
    /** Drop the current stall, whatever it was. */
    private clearWaitingReason;
    /**
     * Copy for the current stall, or null when the turn is not stalled.
     *
     * Deterministic per stall — seeded by the turn and the stall's start, so
     * every read of one stall shows the same line (a per-read re-roll is the
     * flicker bug the slot scheme exists to prevent).
     */
    private stallPhrase;
    /**
     * How the current line is derived — the debug trace behind the optional
     * `debugLog`, so "why did it say THAT" is answerable from a file instead of
     * from memory.
     * @param nowMs - Wall-clock instant to describe.
     * @returns the derivation inputs of the current render.
     */
    describe(nowMs?: number): Record<string, unknown>;
    private setPhase;
    /**
     * The instant the current phrase's rotation window starts from.
     *
     * The phase's own start, so entering a phase immediately shows that phase's
     * copy; a phase still needs a turn to belong to, hence the fallback.
     */
    private phraseAnchorAt;
    /** The rotation window index of the current phase at `nowMs`. */
    private phraseSlot;
    /**
     * Whether this phase draws from the rare pool.
     *
     * Once per turn, in the turn's FIRST thinking phase, decided by the seed — a
     * per-read dice roll would pop an egg in and out of the line (the egg's own
     * display window then lasts for the whole phase).
     */
    private rarePool;
    /**
     * The phrase for one rotation window — a PURE function of the state and `nowMs`.
     *
     * This used to be stateful (`previousPhrase` + `phraseChangedAt` mutated on
     * render). That works for a long-lived in-process tracker, but a projected
     * value is read far more often than it is written: the read renders a
     * throwaway copy, so every read rolled a new phrase (measured: three different
     * phrases in three consecutive 500 ms reads) and a phase change could carry the
     * previous phase's pool in. Deriving from (phase, phase start, seed, slot)
     * makes a read idempotent and keeps the pools apart by construction.
     */
    private phraseForSlot;
}
/**
 * Extract the latest `⏵` self-narration line from a stream buffer.
 *
 * The marker has to START a line. The injected contract asks for one standalone
 * line, so a `⏵` inside a sentence is the model *mentioning* the format rather
 * than narrating with it — measured on a live session, where the line quoted a
 * fragment out of the middle of the model's own prose.
 *
 * The text is model output destined for a terminal, so it is flattened here:
 * an ESC or a newline carried by a delta must not reach the screen (see
 * {@link sanitizeFragment}).
 * @param buffer - Rolling window of the visible streamed text.
 * @returns the narration, or null when the buffer carries none.
 */
export declare function extractNarration(buffer: string): string | null;
//# sourceMappingURL=status.d.ts.map