import { jsx as _jsx } from "react/jsx-runtime";
import { useContext, useInsertionEffect } from 'react';
import instances from '../instances.js';
import { logMouseDebug } from '../../utils/debug.js';
import { DISABLE_MOUSE_TRACKING, ENABLE_MOUSE_TRACKING, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN } from '../termio/dec.js';
import { TerminalWriteContext } from '../useTerminalNotification.js';
import Box from './Box.js';
import { TerminalSizeContext } from './TerminalSizeContext.js';
/** Own the alternate buffer and its input modes for the lifetime of this subtree. */
export function AlternateScreen({ children, mouseTracking = true }) {
    const size = useContext(TerminalSizeContext);
    const write = useContext(TerminalWriteContext);
    useInsertionEffect(() => {
        if (!write)
            return;
        // Custom streams are supported only when a single renderer can be identified.
        const renderer = instances.get(process.stdout) ?? (instances.size === 1 ? instances.values().next().value : undefined);
        logMouseDebug('alt-screen enter', { mouseTracking, inkFound: !!renderer });
        write(ENTER_ALT_SCREEN + '\x1b[2J\x1b[H' + (mouseTracking ? ENABLE_MOUSE_TRACKING : ''));
        renderer?.setAltScreenActive(true, mouseTracking);
        return () => {
            renderer?.setAltScreenActive(false);
            renderer?.clearTextSelection();
            write((mouseTracking ? DISABLE_MOUSE_TRACKING : '') + EXIT_ALT_SCREEN);
            logMouseDebug('alt-screen exit', {});
        };
    }, [write, mouseTracking]);
    return _jsx(Box, { flexDirection: "column", height: size?.rows ?? 24, width: "100%", flexShrink: 0, children: children });
}
