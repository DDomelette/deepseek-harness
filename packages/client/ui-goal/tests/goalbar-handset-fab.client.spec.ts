/** Handset goal-dock contract with ui-layout's floating brand button. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/GoalBar.module.css', import.meta.url)), 'utf8')

describe('GoalBar.module.css handset band', () => {
  it('spans the shared clearance-wide centered column', () => {
    // Below ui-layout's overlay breakpoint the dock drops the four insets so
    // the bar's left edge matches the input card and the transcript.
    const rule = String.raw`\[data-sidebar-fab] \.dock \{[^}]*`
      + String.raw`100% -[\s\S]*?var\(--dsh-composer-side-clearance\)[^}]*\}`
    expect(css).toMatch(new RegExp(rule, 'm'))
  })
})
