import { jsx as _jsx } from "react/jsx-runtime";
import { isTerminalImageSource, TERMINAL_IMAGE_MAX_CELLS, } from '../terminal-image.js';
import Text from './Text.js';
/**
 * A renderer-owned terminal image with a deterministic cell fallback.
 *
 * The component never emits protocol bytes itself. It contributes a normal
 * Yoga leaf; the Ink host decides after layout whether to paint its fallback
 * children or attach a terminal-graphics placement over the same cells.
 */
export default function Image({ source, width, height, alt, copyText, presentation, transparent, children, }) {
    const [columns, rows] = normalizeSize(width, height);
    const image = isTerminalImageSource(source, presentation) ? source : undefined;
    const alternative = cleanAlternative(alt);
    return (_jsx("ink-image", { imageData: image?.data, imageWidth: image?.width, imageHeight: image?.height, imageAlt: alternative, imagePresentation: presentation, imageCopyText: copyText, imageTransparent: transparent === true ? 'transparent' : undefined, style: {
            width: columns,
            height: rows,
            flexGrow: 0,
            flexShrink: 0,
            overflow: 'hidden',
        }, children: children ??
            (alternative === '' ? null : (_jsx(Text, { dim: true, wrap: "truncate", children: alternative }))) }));
}
function normalizeSize(width, height) {
    let columns = normalizeEdge(width);
    let rows = normalizeEdge(height);
    const cells = columns * rows;
    if (cells > TERMINAL_IMAGE_MAX_CELLS) {
        const scale = Math.sqrt(TERMINAL_IMAGE_MAX_CELLS / cells);
        columns = Math.max(1, Math.floor(columns * scale));
        rows = Math.max(1, Math.floor(rows * scale));
    }
    return [columns, rows];
}
function normalizeEdge(value) {
    if (!Number.isFinite(value))
        return 1;
    return Math.max(1, Math.min(TERMINAL_IMAGE_MAX_CELLS, Math.floor(value)));
}
function cleanAlternative(value) {
    if (typeof value !== 'string')
        return '';
    return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').slice(0, 200);
}
