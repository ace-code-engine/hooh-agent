import { jsx as _jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import Box from './Box.js';
function Button({ onAction, children, tabIndex = 0, ref, autoFocus, ...style }) {
    const [state, setState] = useState({ focused: false, hovered: false, active: false });
    const timer = useRef(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const handleKey = useCallback((event) => {
        if (event.key !== 'return' && event.key !== ' ')
            return;
        event.preventDefault();
        clearTimeout(timer.current);
        setState(current => ({ ...current, active: true }));
        timer.current = setTimeout(() => setState(current => ({ ...current, active: false })), 100);
        onAction();
    }, [onAction]);
    const onFocus = useCallback(() => setState(current => ({ ...current, focused: true })), []);
    const onBlur = useCallback(() => setState(current => ({ ...current, focused: false })), []);
    const onMouseEnter = useCallback(() => setState(current => ({ ...current, hovered: true })), []);
    const onMouseLeave = useCallback(() => setState(current => ({ ...current, hovered: false })), []);
    return _jsx(Box, { ...style, ref: ref, autoFocus: autoFocus, tabIndex: tabIndex, onClick: onAction, onKeyDown: handleKey, onFocus, onBlur, onMouseEnter, onMouseLeave, children: typeof children === 'function' ? children(state) : children });
}
export default Button;
