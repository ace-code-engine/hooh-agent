/**
 * Live `agent/assistant-stream` frame → {@link ActivityEvent} normalization.
 *
 * This is the realtime half of the plugin's input. On the current host line the
 * durable `assistant/chunk` event no longer exists (it is absent from
 * `SessionEventMap` and from `KNOWN_SESSION_EVENT_TYPES`) and streamed output
 * arrives as transient frames published on the agent scope instead, so without
 * this module the line has no first-token promotion, no `⏵` narration and no
 * tok/s estimate — it only moves when durable tool events arrive.
 *
 * Measured frame shape (`@deepseek-ai/dsh-agent@0.1.7-rc.2`,
 * `lib/types/runtime-types.d.ts`):
 *
 * ```text
 * start { attemptId, revision, turn, step }
 * chunk { attemptId, revision, index, time, chunk }   chunk: StreamChunk
 * end   { attemptId, revision, index, outcome }       outcome: committed{eventType,seq} | abandoned
 * ```
 *
 * The fields stay read tolerantly rather than through a host type import: the
 * package still compiles against `@deepseek-ai/dsh-agent@0.1.0-rc.6`, which has
 * no `AssistantStreamFrame` declaration at all. Reading structurally is also
 * what keeps the next reshape a one-file fix here.
 *
 * ## Why the cursor is keyed by the agent, not by the session
 * `revision` is documented as "monotone within one attached Agent lifecycle;
 * replacement restarts at 1". A single counter would therefore drop every frame
 * of a replacement agent (`1 <= 100`) and silence the line forever, so the
 * cursor lives in a `WeakMap` keyed by the emitting agent — a new agent is a new
 * key and starts at its own revision 1 with no explicit reset anywhere.
 * @module @deepseek-ai/dsh-working-activity/compat/assistant-stream
 */
import type { ActivityEvent } from '../activity-event.js';
/** Identity of one agent lifecycle. Frames of different owners never share a cursor. */
export type StreamOwner = object;
/**
 * Normalize one live frame for the agent that published it.
 *
 * Returns zero events for anything the tracker does not model: unknown frame
 * types, non-delta chunks (block boundaries, tool-call deltas, usage, finish),
 * empty delta text, and any frame the owner's revision cursor has already seen.
 *
 * @param owner - The agent lifecycle that published the frame (cursor key).
 * @param frame - Raw `agent/assistant-stream` frame, or any host payload.
 * @returns the domain events this frame carries, in order.
 */
export declare function frameToActivityEvents(owner: StreamOwner, frame: unknown): readonly ActivityEvent[];
/**
 * Feed one live frame into any domain-event consumer.
 *
 * Kept as a free function so the tracker never learns a host type: the plugin
 * subscribes to `agent/assistant-stream` and calls this.
 * @param tracker - Consumer of normalized events.
 * @param owner - The agent lifecycle that published the frame.
 * @param frame - Raw frame payload.
 */
export declare function feedStreamFrame(tracker: {
    onEvent(event: ActivityEvent): void;
}, owner: StreamOwner, frame: unknown): void;
//# sourceMappingURL=assistant-stream.d.ts.map