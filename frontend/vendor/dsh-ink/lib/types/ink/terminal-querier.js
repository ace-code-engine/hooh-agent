/**
 * Query the terminal and await responses without timeouts.
 *
 * Terminal queries (DECRQM, DA1, OSC 11, etc.) share the stdin stream
 * with keyboard input. Response sequences are syntactically
 * distinguishable from key events, so the input parser recognizes them
 * and dispatches them here.
 *
 * To avoid timeouts, each query batch is terminated by a DA1 sentinel
 * (CSI c) — every terminal since VT100 responds to DA1, and terminals
 * answer queries in order. So: if your query's response arrives before
 * DA1's, the terminal supports it; if DA1 arrives first, it doesn't.
 *
 * Usage:
 *   const [sync, grapheme] = await Promise.all([
 *     querier.send(decrqm(2026)),
 *     querier.send(decrqm(2027)),
 *     querier.flush(),
 *   ])
 *   // sync and grapheme are DECRPM responses or undefined if unsupported
 */
import { csi } from './termio/csi.js';
import { osc } from './termio/osc.js';
// -- Query builders --
/**
 * DECRQM: request DEC private mode status (CSI ? mode $ p).
 * Terminal replies with DECRPM (CSI ? mode ; status $ y) or ignores.
 * @param mode - the DEC private mode number to query.
 * @returns a query whose response is the DECRPM reply for mode.
 */
export function decrqm(mode) {
    return {
        request: csi(`?${mode}$p`),
        match: (r) => r.type === 'decrpm' && r.mode === mode,
        responseType: 'decrpm',
    };
}
/**
 * Primary Device Attributes query (CSI c). Every terminal answers this —
 * used internally by flush() as a universal sentinel. Call directly if
 * you want the DA1 params.
 * @returns a query whose response is the DA1 reply.
 */
export function da1() {
    return {
        request: csi('c'),
        match: (r) => r.type === 'da1',
        responseType: 'da1',
    };
}
/**
 * Secondary Device Attributes query (CSI > c). Returns terminal version.
 * @returns a query whose response is the DA2 reply.
 */
export function da2() {
    return {
        request: csi('>c'),
        match: (r) => r.type === 'da2',
        responseType: 'da2',
    };
}
/**
 * Query current Kitty keyboard protocol flags (CSI ? u).
 * Terminal replies with CSI ? flags u or ignores.
 * @returns a query whose response is the Kitty keyboard reply.
 */
export function kittyKeyboard() {
    return {
        request: csi('?u'),
        match: (r) => r.type === 'kittyKeyboard',
        responseType: 'kittyKeyboard',
    };
}
/**
 * Query direct-data and zlib support for the Kitty graphics protocol with one
 * transparent 1×1 RGBA pixel. The terminal echoes the image id in its reply.
 */
export function kittyGraphics(imageId) {
    const id = Number.isSafeInteger(imageId) && imageId > 0 ? imageId : 31;
    return {
        // One transparent RGBA pixel compressed with RFC 1950 zlib. Probe the
        // same direct-data + compression path used by real renderer uploads.
        request: `\u001b_Gi=${id},s=1,v=1,a=q,t=d,f=32,o=z;eAFjYGBgAAAABAAB\u001b\\`,
        match: (r) => r.type === 'kittyGraphics' && r.imageId === id,
        responseType: 'kittyGraphics',
    };
}
/** XTWINOPS: query the physical pixel dimensions of one terminal cell. */
export function terminalCellSizePixels() {
    return {
        request: csi('16t'),
        match: (r) => r.type === 'terminalPixelSize' && r.scope === 'cell',
        responseType: 'terminalPixelSize',
    };
}
/** XTWINOPS: query the terminal text area's physical pixel dimensions. */
export function terminalWindowSizePixels() {
    return {
        request: csi('14t'),
        match: (r) => r.type === 'terminalPixelSize' && r.scope === 'window',
        responseType: 'terminalPixelSize',
    };
}
/**
 * DECXCPR: request cursor position with DEC-private marker (CSI ? 6 n).
 * Terminal replies with CSI ? row ; col R. The `?` marker is critical —
 * the plain DSR form (CSI 6 n → CSI row;col R) is ambiguous with
 * modified F3 keys (Shift+F3 = CSI 1;2 R, etc.).
 * @returns a query whose response is the cursor-position reply.
 */
export function cursorPosition() {
    return {
        request: csi('?6n'),
        match: (r) => r.type === 'cursorPosition',
        responseType: 'cursorPosition',
    };
}
/**
 * OSC dynamic color query (e.g. OSC 11 for bg color, OSC 10 for fg).
 * The `?` data slot asks the terminal to reply with the current value.
 * @param code - the OSC color code to query (10 = fg, 11 = bg, etc.).
 * @returns a query whose response is the OSC color reply.
 */
export function oscColor(code) {
    return {
        request: osc(code, '?'),
        match: (r) => r.type === 'osc' && r.code === code,
        responseType: 'osc',
    };
}
/**
 * XTVERSION: request terminal name/version (CSI > 0 q).
 * Terminal replies with DCS > | name ST (e.g. "xterm.js(5.5.0)") or ignores.
 * This survives SSH — the query goes through the pty, not the environment,
 * so it identifies the *client* terminal even when TERM_PROGRAM isn't
 * forwarded. Used to detect xterm.js for wheel-scroll compensation.
 * @returns a query whose response is the XTVERSION reply.
 */
export function xtversion() {
    return {
        request: csi('>0q'),
        match: (r) => r.type === 'xtversion',
        responseType: 'xtversion',
    };
}
// -- Querier --
/** Sentinel request sequence (DA1). Kept internal; flush() writes it. */
const SENTINEL = csi('c');
/**
 * Sends terminal queries to stdout and resolves their responses, using a
 * flush() sentinel barrier so queries never time out.
 */
export class TerminalQuerier {
    stdout;
    setRawMode;
    /**
     * Interleaved queue of queries and sentinels in send order. Terminals
     * respond in order, so each flush() barrier only drains queries queued
     * before it — concurrent batches from independent callers stay isolated.
     */
    queue = [];
    /**
     * Set by dispose(). Post-dispose send()/flush() must not touch the
     * terminal: they would re-enable raw mode (holdRawMode) and emit query
     * bytes after the exit funnel's cleanup has already restored cooked
     * mode — the replies then leak into the shell (#507). Resolving as
     * "no answer" keeps callers' .then() chains inert instead of pending.
     */
    disposed = false;
    suspended = false;
    constructor(stdout, setRawMode) {
        this.stdout = stdout;
        this.setRawMode = setRawMode;
    }
    /** Whether terminal query I/O is paused for an external process handoff. */
    get isSuspended() {
        return this.suspended;
    }
    /**
     * In-flight evidence for the input parser (read-only observation): true
     * while at least one query or flush sentinel is still waiting for its
     * reply. Purely observational — queue semantics are untouched.
     */
    get hasPending() {
        return this.queue.length > 0;
    }
    /**
     * In-flight evidence for the input parser (read-only observation): the
     * response types of the queries still awaiting a reply, plus `da1` when a
     * flush() sentinel is still open (DA1 is the reply that resolves it).
     *
     * This is bound to the query lifecycle on purpose. A boolean "something
     * was sent recently" lets any recent query authorize a claim for bytes
     * that may belong to no query at all, so the parser receives the expected
     * types instead: a reply tail is only claimed when its shape can complete
     * into one of them, and a query resolved by a sentinel stops counting the
     * moment its promise settles. Purely observational — queue semantics are
     * untouched.
     */
    get pendingResponseTypes() {
        const types = new Set();
        for (const pending of this.queue) {
            if (pending.kind === 'query')
                types.add(pending.responseType);
            else
                types.add('da1');
        }
        return types;
    }
    holdRawMode() {
        this.setRawMode?.(true);
        return () => this.setRawMode?.(false);
    }
    /**
     * Send a query and wait for its response.
     *
     * Resolves with the response when `query.match` matches an incoming
     * TerminalResponse, or with `undefined` when a flush() sentinel arrives
     * before any matching response (meaning the terminal ignored the query).
     *
     * Never rejects; never times out on its own. If you never call flush()
     * and the terminal doesn't respond, the promise remains pending.
     * @param query - the query to send and await a response for.
     * @returns the matched response, or undefined when the terminal did not
     *   answer before the next flush() sentinel.
     */
    send(query) {
        if (this.disposed || this.suspended)
            return Promise.resolve(undefined);
        return new Promise(resolve => {
            this.queue.push({
                kind: 'query',
                match: query.match,
                responseType: query.responseType,
                resolve: r => resolve(r),
                releaseRawMode: this.holdRawMode(),
            });
            this.stdout.write(query.request);
        });
    }
    flush(options) {
        if (this.disposed || this.suspended)
            return Promise.resolve();
        return new Promise(resolve => {
            this.queue.push({
                kind: 'sentinel',
                resolve: attributes => resolve(options?.attributes ? attributes : undefined),
                releaseRawMode: this.holdRawMode(),
            });
            this.stdout.write(SENTINEL);
        });
    }
    /** Resolve and release all pending queries when their owning app unmounts. */
    dispose() {
        this.disposed = true;
        this.suspended = true;
        this.drainPending();
    }
    /**
     * Receives responses that answer no pending query — e.g. a Kitty graphics
     * error for a placement command sent without suppressing failures.
     */
    onUnsolicited = undefined;
    /**
     * Dispatch a response parsed from stdin. Called by App.tsx's
     * processKeysInBatch for every `kind: 'response'` item.
     *
     * Matching strategy:
     * - First, try to match a pending query (FIFO, first match wins).
     *   This lets callers send(da1()) explicitly if they want the DA1
     *   params — a separate DA1 write means the terminal sends TWO DA1
     *   responses. The first matches the explicit query; the second
     *   (unmatched) fires the sentinel.
     * - Otherwise, if this is a DA1, fire the FIRST pending sentinel:
     *   resolve any queries queued before that sentinel with undefined
     *   (the terminal answered DA1 without answering them → unsupported)
     *   and signal its flush() completion. Only draining up to the first
     *   sentinel keeps later batches intact when multiple callers have
     *   concurrent queries in flight.
     * - Unsolicited responses (no match, no sentinel) go to
     *   {@link onUnsolicited} when set, and are dropped otherwise.
     * @param r - the response parsed from stdin.
     */
    onResponse(r) {
        if (this.suspended)
            return;
        const idx = this.queue.findIndex(p => p.kind === 'query' && p.match(r));
        if (idx !== -1) {
            const [q] = this.queue.splice(idx, 1);
            if (q?.kind === 'query') {
                q.resolve(r);
                q.releaseRawMode();
            }
            return;
        }
        if (r.type === 'da1') {
            const s = this.queue.findIndex(p => p.kind === 'sentinel');
            if (s === -1) {
                this.onUnsolicited?.(r);
                return;
            }
            for (const p of this.queue.splice(0, s + 1)) {
                if (p.kind === 'query')
                    p.resolve(undefined);
                else
                    p.resolve(r);
                p.releaseRawMode();
            }
            return;
        }
        this.onUnsolicited?.(r);
    }
    /**
     * Resolve outstanding queries before stdin is handed to another process.
     * Their replies can no longer be routed reliably once the child owns the
     * terminal; later queries remain available after the handoff.
     */
    suspend() {
        if (this.disposed)
            return;
        this.suspended = true;
        this.drainPending();
    }
    /** Resume queries after the caller's terminal-reply quarantine has ended. */
    resume() {
        if (!this.disposed)
            this.suspended = false;
    }
    drainPending() {
        for (const pending of this.queue.splice(0)) {
            if (pending.kind === 'query')
                pending.resolve(undefined);
            else
                pending.resolve();
            pending.releaseRawMode();
        }
    }
}
