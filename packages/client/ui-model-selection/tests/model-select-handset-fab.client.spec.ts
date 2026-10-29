/** Handset model-trigger contract with ui-layout's floating brand button. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/ModelSelect.module.css', import.meta.url)), 'utf8')

describe('ModelSelect.module.css handset band', () => {
  const docked = String.raw`\[data-sidebar-fab] \[data-composer-variant='composer']`

  it('collapses the trigger to a bare Models glyph in the docked composer', () => {
    // User-directed override of the coarse-pointer text rule for this one
    // band; the model name stays on the trigger's aria-label and menu rows.
    // No selector-fill circle: at handset widths the circle chrome reads as
    // clutter next to the attach controls and steals row width.
    expect(css).toMatch(
      new RegExp(String.raw`${docked} \.trigger \{[^}]*width: 28px;[^}]*background: transparent;`),
    )
    const hidden = String.raw`${docked} \.triggerLabel,\s*`
      + String.raw`${docked} \.triggerEffort,\s*`
      + String.raw`${docked} \.chevron\s*\{\s*display: none;\s*}`
    expect(css).toMatch(new RegExp(hidden))
    expect(css).toMatch(
      new RegExp(String.raw`${docked} \.triggerIcon\s*\{\s*display: block;\s*width: 16px;\s*height: 16px;`),
    )
  })
})
