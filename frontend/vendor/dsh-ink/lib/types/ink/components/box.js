import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import * as warn from '../warn.js';
/** Flex layout container with renderer event forwarding. */
function Box({ children, ref, tabIndex, autoFocus, onClick, onContextMenu, onDragStart, onDragMove, onDragEnd, onWheel, onFocus, onFocusCapture, onBlur, onBlurCapture, onKeyDown, onKeyDownCapture, onMouseEnter, onMouseLeave, flexDirection = 'row', flexWrap = 'nowrap', flexGrow = 0, flexShrink = 1, ...layout }) {
    for (const key of SPACING_KEYS)
        warn.ifNotInteger(layout[key], key);
    const style = {
        ...layout, flexDirection, flexWrap, flexGrow, flexShrink,
        overflowX: layout.overflowX ?? layout.overflow ?? 'visible',
        overflowY: layout.overflowY ?? layout.overflow ?? 'visible',
    };
    return _jsx("ink-box", { ref, tabIndex, autoFocus, style, onClick, onContextMenu,
        onDragStart, onDragMove, onDragEnd, onWheel, onFocus, onFocusCapture,
        onBlur, onBlurCapture, onKeyDown, onKeyDownCapture, onMouseEnter, onMouseLeave, children: children });
}
const SPACING_KEYS = [
    'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
    'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
    'gap', 'columnGap', 'rowGap',
];
export default React.memo(Box);
