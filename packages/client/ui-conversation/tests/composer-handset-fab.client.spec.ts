/** Handset composer-row contracts with ui-layout's floating brand button. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/skeleton/${name}`, import.meta.url)), 'utf8')

describe('composer handset band', () => {
  const docked = String.raw`\[data-sidebar-fab] \[data-composer-variant='composer']`

  it('keeps the docked button row on one line through the frame attribute', () => {
    // Scoped to data-composer-variant='composer': the hero card keeps the wrap.
    expect(read('InputBar.module.css')).toMatch(
      new RegExp(String.raw`\[data-sidebar-fab] \.root\[data-composer-variant='composer'] \.row\s*\{\s*flex-wrap: nowrap;\s*}`),
    )
  })

  it('collapses the permission trigger to a bare icon in the docked composer', () => {
    // No selector-fill circle: at handset widths the circle chrome reads as
    // clutter next to the attach controls and steals row width.
    const css = read('PermissionSelect.module.css')
    expect(css).toMatch(
      new RegExp(String.raw`${docked} \.trigger:has\(\.triggerIcon\) \{[^}]*width: 28px;[^}]*background: transparent;`),
    )
    const hidden = String.raw`${docked} \.trigger:has\(\.triggerIcon\) \.triggerLabel,\s*`
      + String.raw`${docked} \.trigger:has\(\.triggerIcon\) \.chevron\s*\{\s*display: none;\s*}`
    expect(css).toMatch(new RegExp(hidden))
  })

  it('keeps the docked row controls at their drawn sizes against the coarse-pointer floor', () => {
    // The 44px coarse floor would inflate six controls past the narrow card's
    // width and push the send action out of it.
    expect(read('InputBar.module.css')).toMatch(
      new RegExp(String.raw`\[data-sidebar-fab] \.root\[data-composer-variant='composer'] \.row button\s*\{\s*min-height: 28px;\s*min-width: 28px;\s*}`),
    )
  })

  it('pins the tools and modes groups against shrinking so triggers cannot overlap the next group', () => {
    // The coarse pointer's 44px minimums already consume the width budget; a
    // shrunken group let its unshrunk content overflow into the model chip.
    expect(read('InputBar.module.css')).toMatch(
      new RegExp(String.raw`\[data-sidebar-fab] \.root\[data-composer-variant='composer'] \.tools,\s*`
        + String.raw`\[data-sidebar-fab] \.root\[data-composer-variant='composer'] \.modes\s*\{\s*flex: none;\s*}`),
    )
  })

  it('spans the shared centered column for the todo and queue docks', () => {
    for (const name of ['skeleton/TodoPanel.module.css', 'queue/QueueDock.module.css']) {
      const css = readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8')
      expect(css).toMatch(
        new RegExp(String.raw`\[data-sidebar-fab] \.(root|dock) \{[^}]*`
          + String.raw`100% -[\s\S]*?var\(--dsh-composer-side-clearance\)[^}]*\}`, 'm'),
      )
    }
  })
})
