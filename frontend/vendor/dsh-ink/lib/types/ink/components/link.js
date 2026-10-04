import { jsx as _jsx } from "react/jsx-runtime";
import { supportsHyperlinks } from '../supports-hyperlinks.js';
import Text from './Text.js';
export default function Link({ children, url, fallback }) {
    const label = children ?? url;
    return _jsx(Text, { children: supportsHyperlinks() ? _jsx("ink-link", { href: url, children: label }) : (fallback ?? label) });
}
