/** Overrides only choose a protocol; TTY/accessibility/handoff guards still apply. */
export function selectTerminalImageProtocol(kittyStatus, attributes, override) {
    if (override === 'none' || override === 'kitty' || override === 'sixel')
        return override;
    if (kittyStatus?.startsWith('OK'))
        return 'kitty';
    return attributes?.slice(1).includes(4) ? 'sixel' : 'none';
}
