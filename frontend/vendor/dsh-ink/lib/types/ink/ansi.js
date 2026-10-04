import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import Link from './components/Link.js';
import Text from './components/Text.js';
import { Parser } from './termio.js';
function rendererColor(color) {
    if (color.type === 'default')
        return undefined;
    if (color.type === 'rgb')
        return `rgb(${color.r},${color.g},${color.b})`;
    if (color.type === 'indexed')
        return `ansi256(${color.index})`;
    const name = color.name.startsWith('bright')
        ? `${color.name.slice(6).toLowerCase()}Bright`
        : color.name;
    return `ansi:${name}`;
}
function styledRun(text, style, forceDim) {
    const weight = forceDim || style.dim ? { dim: true }
        : style.bold ? { bold: true } : {};
    return _jsx(Text, { ...weight, color: rendererColor(style.fg), backgroundColor: rendererColor(style.bg), italic: style.italic, underline: style.underline !== 'none', strikethrough: style.strikethrough, inverse: style.inverse, children: text });
}
/** Project parser actions onto text leaves; control-only input has no layout. */
export const Ansi = React.memo(function Ansi({ children, dimColor = false }) {
    if (typeof children !== 'string')
        return _jsx(Text, { dim: dimColor, children: String(children) });
    if (!children)
        return null;
    if (!children.includes('\x1b'))
        return _jsx(Text, { dim: dimColor, children: children });
    const content = [];
    let url;
    for (const action of new Parser().feed(children)) {
        if (action.type === 'link') {
            url = action.action.type === 'start' ? action.action.url : undefined;
        }
        else if (action.type === 'text' && action.graphemes.length) {
            const text = action.graphemes.map(part => part.value).join('');
            const node = styledRun(text, action.style, dimColor);
            content.push(url ? _jsx(Link, { url: url, children: node }, content.length)
                : _jsx(React.Fragment, { children: node }, content.length));
        }
    }
    return content.length ? _jsx(Text, { dim: dimColor, children: content }) : null;
});
