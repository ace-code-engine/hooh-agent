import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
/** Already wrapped terminal rows, measured without creating a tree per style span. */
export const RawAnsi = React.memo(function RawAnsi({ lines, width }) {
    const rawText = React.useMemo(() => lines.join('\n'), [lines]);
    return lines.length ? _jsx("ink-raw-ansi", { rawText: rawText, rawWidth: width, rawHeight: lines.length }) : null;
});
