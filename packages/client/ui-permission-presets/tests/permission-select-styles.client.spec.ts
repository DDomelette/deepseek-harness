/** Docked-composer geometry for the permission trigger, owned beside the stylesheet. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/PermissionSelect.module.css', import.meta.url)),
  'utf8',
)

/** Docked composer: the frame's data-sidebar-fab plus the InputBar root variant. */
const docked = String.raw`\[data-sidebar-fab] \[data-composer-variant='composer']`

describe('permission trigger in the docked composer', () => {
  it('collapses to a bare icon without the selector-fill circle', () => {
    expect(css).toMatch(
      new RegExp(String.raw`${docked} \.trigger:has\(\.triggerIcon\) \{[^}]*width: 28px;[^}]*background: transparent;`),
    )
    const hidden = String.raw`${docked} \.trigger:has\(\.triggerIcon\) \.triggerLabel,\s*`
      + String.raw`${docked} \.trigger:has\(\.triggerIcon\) \.chevron\s*\{\s*display: none;\s*}`
    expect(css).toMatch(new RegExp(hidden))
  })

  it('keeps the label for coarse pointers outside that band', () => {
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{\s*\.trigger:has\(\.triggerIcon\) \.triggerLabel \{\s*display: block;\s*}/,
    )
  })
})
