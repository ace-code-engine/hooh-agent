/**
 * Minimal terminal-environment shim for terminal capability checks. The
 * renderer reads `env.terminal` to choose the OSC terminator for Kitty.
 */
export const env = {
    terminal: (process.env.TERM_PROGRAM ?? process.env.TERM ?? 'unknown').toLowerCase(),
};
