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

  it('collapses the permission trigger to the attach-style icon circle in the docked composer', () => {
    const css = read('PermissionSelect.module.css')
    expect(css).toMatch(
      new RegExp(String.raw`${docked} \.trigger:has\(\.triggerIcon\) \{[^}]*width: 28px;[^}]*background: var\(--dsw-specific-selector\);`),
    )
    const hidden = String.raw`${docked} \.trigger:has\(\.triggerIcon\) \.triggerLabel,\s*`
      + String.raw`${docked} \.trigger:has\(\.triggerIcon\) \.chevron\s*\{\s*display: none;\s*}`
    expect(css).toMatch(new RegExp(hidden))
  })
})
