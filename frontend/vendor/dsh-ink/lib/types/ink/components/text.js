import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
const wrapStyles = new Map();
/** A text leaf. Empty children produce no layout node. */
function Text({ children, ref, wrap = 'wrap', color, backgroundColor, bold, dim, italic, underline, strikethrough, inverse, }) {
    const textStyles = React.useMemo(() => {
        const values = { color, backgroundColor, bold, dim, italic, underline, strikethrough, inverse };
        return Object.fromEntries(Object.entries(values).filter(([, value]) => Boolean(value)));
    }, [color, backgroundColor, bold, dim, italic, underline, strikethrough, inverse]);
    if (children == null)
        return null;
    let style = wrapStyles.get(wrap);
    if (!style) {
        style = { flexDirection: 'row', flexGrow: 0, flexShrink: 1, textWrap: wrap };
        wrapStyles.set(wrap, style);
    }
    return _jsx("ink-text", { ref: ref, style: style, textStyles: textStyles, children: children });
}
export default React.memo(Text);
