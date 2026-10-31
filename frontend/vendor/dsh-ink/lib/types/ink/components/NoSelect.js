import { jsx as _jsx } from "react/jsx-runtime";
import Box from './Box.js';
/** Exclude rendered cells from fullscreen copy selection, optionally including their left gutter. */
export function NoSelect({ fromLeftEdge, ...props }) {
    return _jsx(Box, { ...props, noSelect: fromLeftEdge ? 'from-left-edge' : true });
}
