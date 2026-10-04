import { PointerEvent } from './pointer-event.js';
/**
 * Mouse wheel event dispatched to the ScrollBox under the pointer.
 *
 * `deltaY`/`deltaX` are in terminal rows/columns per wheel notch (positive =
 * content moves up / right, i.e. scroll down / scroll right), matching
 * ScrollBox.scrollBy's sign convention. Coordinates identify where the wheel
 * event occurred so routing can hit-test the deepest scroll container.
 */
export class WheelEvent extends PointerEvent {
    /** Rows to scroll (positive = scroll down). */
    deltaY;
    /** Columns to scroll (positive = scroll right; currently informational). */
    deltaX;
    constructor(col, row, deltaY, deltaX = 0, init) {
        super('wheel', col, row, { ...init, action: 'move' });
        this.deltaY = deltaY;
        this.deltaX = deltaX;
    }
}
