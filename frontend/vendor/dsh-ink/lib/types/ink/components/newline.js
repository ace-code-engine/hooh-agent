import { jsx as _jsx } from "react/jsx-runtime";
/** Insert line separators inside a text container. */
export default function Newline({ count = 1 }) {
    return _jsx("ink-text", { children: '\n'.repeat(count) });
}
