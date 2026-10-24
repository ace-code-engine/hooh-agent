/**
 * Durable `SessionEvent` → {@link ActivityEvent} normalization.
 *
 * Every host-shape guess for the durable log lives here (plus
 * `./tool-result.ts` for the tool-result payload), so a host-line change stays
 * a one-file fix and the state machine keeps consuming meaning only.
 *
 * Measured on the DSH `0.1.7-rc.2` line: `assistant/chunk` no longer exists in
 * `SessionEventMap` or in `KNOWN_SESSION_EVENT_TYPES` (live deltas arrive as
 * transient `agent/assistant-stream` frames instead), so the mapping below is
 * the legacy path kept for replaying older logs. It must stay: sessions
 * written by pre-0.1.5 hosts still carry those events, and replaying them is
 * the only way a resuming user sees the same line they would have seen live.
 * @module @deepseek-ai/dsh-working-activity/compat/session-events
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ActivityEvent } from '../activity-event.js';
/**
 * Normalize one durable session event.
 *
 * Returns zero events for anything the tracker does not model (including a
 * tool result whose call id cannot be resolved — an unpaired result is
 * dropped, never guessed at).
 * @param event - Raw durable session event.
 * @returns the domain events this host event carries, in order.
 */
export declare function toActivityEvents(event: SessionEvent): readonly ActivityEvent[];
/**
 * Feed one durable session event into any domain-event consumer.
 *
 * Kept as a free function so the tracker itself never learns a host type: the
 * published `onSessionEvent` method delegates here.
 * @param tracker - Consumer of normalized events.
 * @param event - Raw durable session event.
 */
export declare function feedSessionEvent(tracker: {
    onEvent(event: ActivityEvent): void;
}, event: SessionEvent): void;
//# sourceMappingURL=session-events.d.ts.map