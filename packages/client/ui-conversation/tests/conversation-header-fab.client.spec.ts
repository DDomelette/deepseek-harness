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

  it('keeps the transcript bar with a symmetric gutter so the centered column stays centered', () => {
    // Classic scrollbars take layout width; reserving both edges keeps the
    // content box symmetric instead of shifting the column left by half the
    // bar. Overlay scrollbars reserve nothing.
    expect(css).toMatch(/\[data-sidebar-fab] \.scrollBody\s*\{\s*margin-right: 0;\s*scrollbar-gutter: stable both-edges;\s*}/)
    expect(css).not.toMatch(/\[data-sidebar-fab] \.scrollBody::-webkit-scrollbar/)
  })
})

describe('ConversationRoot.module.css handset two-row header', () => {
  it('wraps the title row into two lines with an 8px column rhythm', () => {
    expect(css).toMatch(/\[data-sidebar-fab] \.titleRow\s*\{\s*flex-wrap: wrap;\s*column-gap: 8px;\s*row-gap: 2px;\s*}/)
  })

  it('flattens the cluster and actions boxes so their children become title-row flex items', () => {
    expect(css).toMatch(/\[data-sidebar-fab] \.titleCluster,\s*\[data-sidebar-fab] \.headerActions\s*\{\s*display: contents;\s*}/)
  })

  it('gives line one to the crumbs alone, at full width', () => {
    expect(css).toMatch(/\[data-sidebar-fab] \.crumbs\s*\{\s*order: 1;\s*flex: 1;\s*}/)
  })

  it('forces the break with a full-width pseudo directly after the crumbs', () => {
    expect(css).toMatch(/\[data-sidebar-fab] \.titleRow::after\s*\{\s*content: '';\s*order: 2;\s*flex-basis: 100%;\s*height: 0;\s*}/)
  })

  it('sends every action and the utility/corner groups to line two', () => {
    // Order ties resolve in DOM order, so the preset label — first in the
    // actions slot — heads line two without needing its own rule.
    expect(css).toMatch(new RegExp(
      String.raw`\[data-sidebar-fab] \.headerActions \[data-slot='conversation\.session\.header\.actions'] > \*,\s*`
        + String.raw`\[data-sidebar-fab] \.headerUtilities,\s*\[data-sidebar-fab] \.headerCorner\s*\{\s*order: 3;\s*}`,
    ))
  })

  it('pins the utility group to line two’s right edge', () => {
    expect(css).toMatch(/\[data-sidebar-fab] \.headerUtilities\s*\{\s*margin-left: auto;\s*}/)
  })
})
