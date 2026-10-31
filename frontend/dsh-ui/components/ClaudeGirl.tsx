import React from 'react'
import { Box, Text } from '../ui.js'
import { renderCellRows } from './Whale.js'
import { CLAUDE_GIRL_COLS, CLAUDE_GIRL_SPRITE, CLAUDE_GIRL_SPRITE_ROWS } from './claudeGirlSprite.js'

/**
 * The Claude girl portrait（Claude 娘）that stands in for the header's pixel
 * whale while the claude brand is active (`branding.ts` — the cc kernel):
 * a 30×30 true-color sprite in `claudeGirlSprite.ts`, rendered with the same
 * half-block technique as the whale and the whale girl — one `▀`/`▄` cell
 * packs two sprite rows, so the portrait shows at 30 columns × 15 rows.
 * A static portrait by design: the whale's idle planner and click-hearts
 * stay whale-only, exactly like the whale-girl mode.
 */

/** Pre-rendered ANSI rows, computed once at module load. */
export const CLAUDE_GIRL_ROWS: readonly string[] = renderCellRows(
  CLAUDE_GIRL_COLS,
  CLAUDE_GIRL_SPRITE_ROWS,
  (x, y) => CLAUDE_GIRL_SPRITE[y]?.[x] ?? undefined,
)

/**
 * The portrait's center column when it fills the whale's 40-column box
 * (indented (40−30)/2 = 5, so the art spans columns 5..34 → center 19.5 —
 * same metrics as the whale girl, both sprites are 30 columns).
 */
export const CLAUDE_GIRL_CENTER = 19.5

/**
 * The Claude girl as an Ink component: 15 rows × 30 columns. `width` pins
 * the box (the header passes the whale's 40-column box so the neighbouring
 * text column never shifts) and centers the portrait inside it.
 */
export function ClaudeGirlArt({ width }: { width?: number }): React.ReactNode {
  const pad = width === undefined ? 0 : Math.max(0, Math.floor((width - CLAUDE_GIRL_COLS) / 2))
  return (
    <Box flexDirection="column" flexShrink={0} width={width}>
      {CLAUDE_GIRL_ROWS.map((row, index) => (
        <Text key={index} wrap="truncate-end">
          {pad > 0 ? ' '.repeat(pad) : ''}{row}
        </Text>
      ))}
    </Box>
  )
}
