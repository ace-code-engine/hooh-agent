/**
 * Host-payload readers for `tool/result` events — the one place allowed to know
 * how the DSH host spells a tool-call id or a tool failure.
 *
 * The tracker pairs every `tool/result` with the `tool/call` that opened it by
 * exact call-id equality, so a payload shape drift does not throw: it silently
 * resolves no id, and the UI keeps a running tool card that never settles. That
 * is why every shape guess lives in `src/compat/*` — a drift stays a one-file
 * fix here — and why the state machine (`src/status.ts`) must never reach into
 * `event.data` itself. Both readers accept `unknown` and never throw, because
 * the caller hands over raw host events.
 *
 * Measured on the DSH 0.1.7-rc.2 host line over 1290 real `tool/result` events
 * (`data.message` carries `role`, `source: { kind: 'tool', callId }`,
 * `toolCallId`, `content`, `isError`, `id`):
 *
 * | id source               | present   |
 * | ----------------------- | --------- |
 * | `message.source.callId` | 1290/1290 |
 * | `message.toolCallId`    | 1290/1290 |
 * | `content[0].toolCallId` | 0/1290    |
 *
 * The two modern fields were equal in all 1290 events, yet both stay read: the
 * legacy logs this plugin must still replay carry neither and put the id on the
 * content block, which is why {@link resultCallId} keeps a third tier instead
 * of trusting the newest shape alone.
 *
 * Failure signalling on the same corpus is NOT one field: `data.error` was
 * present in 15 events and `message.isError === true` in 17, with neither set
 * containing the other — and legacy logs used a content-block `isError`. Do not
 * "simplify" {@link resultFailed} down to a single signal.
 *
 * @module @deepseek-ai/dsh-working-activity/compat/tool-result
 */
/**
 * The call id a `tool/result` reports, or `undefined` when the payload carries
 * no usable id. Strict precedence, never the other way round:
 *
 * 1. `message.source.callId` — only while `source.kind === 'tool'`, so a source
 *    written by another producer (or an unknown future kind) never donates its
 *    id;
 * 2. `message.toolCallId` — the echo the measured host line writes beside it;
 * 3. the first `content[]` block with a usable `toolCallId` — the legacy shape,
 *    kept last so a lower tier can never override a modern one.
 *
 * Ids that are empty, whitespace-only, or not strings are rejected at every
 * tier: a truthy-but-wrong id would mis-pair a result just as silently as no id
 * at all.
 *
 * @param event - Raw `tool/result` event data (or any host payload).
 * @returns the paired call id, or `undefined` when none is usable.
 */
export declare function resultCallId(event: unknown): string | undefined;
/**
 * Whether a `tool/result` reports a failed tool.
 *
 * Three independent signals, OR-ed on purpose (measured 15 vs 17 events on the
 * same corpus, and neither set contains the other — see the module header):
 *
 * - `data.error` present at all — presence, not truthiness, so an explicitly
 *   `undefined` field does not count as a failure;
 * - `message.isError === true`;
 * - any `content[]` block with `isError === true` (the legacy signal).
 *
 * A payload that cannot be read is reported as healthy: a missing failure flag
 * costs a wrong badge, while treating unreadable data as failure would flag
 * every successful tool on a shape the host has moved on from.
 *
 * @param event - Raw `tool/result` event data (or any host payload).
 * @returns true when any signal fired, false for a clean or unreadable payload.
 */
export declare function resultFailed(event: unknown): boolean;
//# sourceMappingURL=tool-result.d.ts.map