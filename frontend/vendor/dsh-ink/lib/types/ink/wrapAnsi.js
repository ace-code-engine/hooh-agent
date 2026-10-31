import wrapAnsiNpm from 'wrap-ansi';
const SLOT_MIN_LENGTH = 2048;
let slot = null;
function slotOptionsApply(options) {
    return options?.hard === true && (options?.trim ?? false) === false;
}
function wrapAnsiNpmIncremental(input, columns, options) {
    const slottable = input.length > SLOT_MIN_LENGTH && slotOptionsApply(options);
    if (slottable && slot !== null && slot.columns === columns && input.startsWith(slot.input)) {
        const suffix = input.slice(slot.input.length);
        if (!suffix.includes('\x1b') && !slot.remainder.includes('\x1b')) {
            const tail = wrapAnsiNpm(slot.remainder + suffix, columns, options).split('\n');
            const rows = [...slot.headRows, ...tail];
            slot = { columns, input, headRows: rows.slice(0, -1), remainder: rows[rows.length - 1] ?? '' };
            return rows.join('\n');
        }
    }
    const result = wrapAnsiNpm(input, columns, options);
    if (slottable && !input.includes('\x1b')) {
        const rows = result.split('\n');
        slot = { columns, input, headRows: rows.slice(0, -1), remainder: rows[rows.length - 1] ?? '' };
    }
    else {
        slot = null;
    }
    return result;
}
/**
 * Wrap a string to a maximum column width, preserving ANSI escape sequences.
 *
 * Uses wrap-ansi (with the incremental fast path for growing streaming inputs).
 * @param input - the string to wrap.
 * @param columns - the maximum width in columns.
 * @param options - wrap options: hard breaks long words, wordWrap splits on word boundaries, trim strips trailing whitespace.
 * @returns the wrapped string.
 */
const wrapAnsi = wrapAnsiNpmIncremental;
export { wrapAnsi };
