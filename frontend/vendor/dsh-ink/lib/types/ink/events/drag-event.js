import { PointerEvent } from './pointer-event.js';
/**
 * Component-level drag event (DOM HTML5 drag semantics subset).
 *
 * A drag session opens on an unmodified LEFT-button press over a node
 * whose ancestor chain carries an `onDragStart` handler, but stays
 * dormant until the first drag motion — `dragstart` fires then, followed
 * by `dragmove` on every further motion and `dragend` on release. A
 * press+release without any movement never fires drag events and still
 * resolves to a normal click (`onClick`). Modifier presses (shift/alt/
 * ctrl) never open a drag session — they keep the baseline text-selection
 * gesture. Only works inside `<AlternateScreen>` where mouse tracking is
 * enabled.
 *
 * Bubbles from the captured drag target up through parentNode (the target
 * is captured at press, so motion events keep going to it even when the
 * pointer leaves its rect — like DOM element capture). Call
 * `stopImmediatePropagation()` to prevent ancestors' handlers from
 * firing.
 *
 * `col`/`row` are the current absolute pointer position (0-indexed);
 * `startCol`/`startRow` is the press origin; `localCol`/`localRow` are
 * recomputed per handler from the nodeCache rect so containers see
 * coordinates relative to themselves.
 */
export class DragEvent extends PointerEvent {
    /** 0-indexed screen column of the press that started this drag. */
    startCol;
    /** 0-indexed screen row of the press that started this drag. */
    startRow;
    constructor(type, col, row, startCol, startRow, init) {
        super(type, col, row, {
            ...init,
            action: type === 'dragend' ? 'release' : 'move',
        });
        this.startCol = startCol;
        this.startRow = startRow;
    }
}
