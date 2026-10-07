/** Handset transcript inset contract with ui-layout's floating brand button. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/chat/ChatView.module.css', import.meta.url)), 'utf8')

describe('ChatView.module.css handset band', () => {
  it('aligns the transcript with the input card through the frame attribute', () => {
    // Below ui-layout's overlay breakpoint the message column and the input
    // card share one symmetric clearance-wide centered column; the attribute
    // selector is not CSS-module localized, so it reaches the frame marker.
    const rule = String.raw`\[data-sidebar-fab] \.scroll\s*\{\s*padding-left: var\(--dsh-composer-side-clearance\);\s*`
      + String.raw`padding-right: var\(--dsh-composer-side-clearance\);\s*}`
    expect(css).toMatch(new RegExp(rule))
  })
})
