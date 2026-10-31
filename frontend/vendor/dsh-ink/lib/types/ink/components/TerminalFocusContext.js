import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useMemo, useSyncExternalStore } from 'react';
import { getTerminalFocusState, subscribeTerminalFocus } from '../terminal-focus-state.js';
const TerminalFocusContext = createContext({ isTerminalFocused: true, terminalFocusState: 'unknown' });
TerminalFocusContext.displayName = 'TerminalFocusContext';
export function TerminalFocusProvider({ children }) {
    const terminalFocusState = useSyncExternalStore(subscribeTerminalFocus, getTerminalFocusState);
    const value = useMemo(() => ({ terminalFocusState, isTerminalFocused: terminalFocusState !== 'blurred' }), [terminalFocusState]);
    return _jsx(TerminalFocusContext.Provider, { value: value, children: children });
}
export default TerminalFocusContext;
