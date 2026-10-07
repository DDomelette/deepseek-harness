/** Session-header padding contract with ui-layout's floating brand button. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)), 'utf8')

describe('ConversationRoot.module.css handset band', () => {
  it('pads the Session header clear of the floating brand button through the frame attribute', () => {
    // 10px edge offset + 36px button + 14px clearance; attribute selectors are
    // not CSS-module localized, so the rule reaches ui-layout's frame marker.
    expect(css).toMatch(/\[data-sidebar-fab] \.header\s*\{\s*padding-left: 60px;\s*}/)
  })
})
