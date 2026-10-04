import { nodeCache } from '../node-cache.js';
import { TerminalEvent } from './terminal-event.js';
/**
 * Base class for pointer-derived terminal events (click, wheel, hover).
 *
 * Carries the raw SGR/X10 button byte so handlers can read modifier flags
 * (`shift`/`alt`/`ctrl`) without re-parsing the escape sequence, plus
 * per-handler local coordinates: `_prepareForTarget` recomputes
 * `localCol`/`localRow` from the nodeCache rect before each handler fires,
 * so an onClick on a container sees coordinates relative to that container,
 * not to the child the pointer actually landed on.
 *
 * `meta` is deliberately always false: xterm.js drops metaKey before SGR
 * encoding (the SGR bit we call "meta" is wired to alt), so no pointer
 * protocol can distinguish it reliably.
 */
export class PointerEvent extends TerminalEvent {
    /** 0-indexed screen column of the pointer. */
    col;
    /** 0-indexed screen row of the pointer. */
    row;
    /** Raw protocol button byte (SGR encoding). */
    button;
    /** Which pointer action produced this event. */
    action;
    /** Shift held (SGR button bit 0x04). */
    shift;
    /** Alt/Option held (SGR button bit 0x08). */
    alt;
    /** Ctrl held (SGR button bit 0x10). */
    ctrl;
    /** Always false — see class doc. */
    meta = false;
    /** Column relative to the current handler's node (set during dispatch). */
    localCol = 0;
    /** Row relative to the current handler's node (set during dispatch). */
    localRow = 0;
    constructor(type, col, row, init) {
        super(type, {
            bubbles: init?.bubbles ?? true,
            cancelable: init?.cancelable ?? true,
        });
        this.col = col;
        this.row = row;
        this.button = init?.button ?? 0;
        this.action = init?.action ?? 'move';
        this.shift = (this.button & 0x04) !== 0;
        this.alt = (this.button & 0x08) !== 0;
        this.ctrl = (this.button & 0x10) !== 0;
    }
    /**
     * Refresh localCol/localRow for the node whose handler is about to run.
     * Nodes without a cached rect (not rendered this frame) get 0,0 — handlers
     * should prefer absolute col/row when that distinction matters.
     */
    _prepareForTarget(target) {
        const rect = nodeCache.get(target);
        this.localCol = rect ? this.col - rect.x : 0;
        this.localRow = rect ? this.row - rect.y : 0;
    }
}
