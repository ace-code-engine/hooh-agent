import { jsx as _jsx } from "react/jsx-runtime";
import Box from './Box.js';
/** Consume unused space on the parent's flex axis. */
export default function Spacer() {
    return _jsx(Box, { flexGrow: 1 });
}
