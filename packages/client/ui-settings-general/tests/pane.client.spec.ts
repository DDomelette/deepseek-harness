// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SETTINGS_PANE_BREAKPOINT, isSinglePaneViewport } from '../src/client/pane.ts'

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')

/** The shell stylesheet that carries the matching handset layout. */
const stylesheet = (): string =>
  readFileSync(resolve(import.meta.dirname, '../src/client/SettingsRoot.module.css'), 'utf8')

/** The same stylesheet with comments dropped and every rule on one line. */
const flattened = (): string => stylesheet()
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\s+/g, ' ')

afterEach(() => {
  if (originalInnerWidth !== undefined) Object.defineProperty(window, 'innerWidth', originalInnerWidth)
})

describe('settings pane geometry', () => {
  it('splits at the handset breakpoint and shows one pane below it', () => {
    // Pinned to the same handset breakpoint ui-layout uses for its sidebar
    // overlay; the two packages keep their own copy on purpose.
    expect(SETTINGS_PANE_BREAKPOINT).toBe(768)
    expect(isSinglePaneViewport(SETTINGS_PANE_BREAKPOINT)).toBe(false)
    expect(isSinglePaneViewport(SETTINGS_PANE_BREAKPOINT - 1)).toBe(true)
  })

  it('reads the live viewport width when no width is given', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true })
    expect(isSinglePaneViewport()).toBe(true)
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true })
    expect(isSinglePaneViewport()).toBe(false)
  })
})

describe('settings pane stylesheet', () => {
  it('crosses to the handset layout at the breakpoint the helper reads', () => {
    // A stylesheet cannot read the TypeScript constant, so its media query is
    // the one mirror of it; this pins the pair together.
    expect(stylesheet()).toContain(`@media (max-width: ${SETTINGS_PANE_BREAKPOINT - 1}px)`)
  })

  it('shows one pane at a time through the panel data-pane fact', () => {
    // Below the breakpoint the two columns are mutually exclusive: the chosen
    // section hides the title and the nav cells, and the list hides the back
    // control, the section name, the header actions, and the section body.
    const css = flattened()
    const hiddenWithList = [
      ".panel[data-pane='list'] .back",
      ".panel[data-pane='list'] .detailTitle",
      ".panel[data-pane='list'] .actions",
      ".panel[data-pane='list'] .options",
    ]
    const hiddenWithSection = [
      ".panel[data-pane='detail'] .navTitle",
      ".panel[data-pane='detail'] .navList",
    ]
    for (const selector of [...hiddenWithList, ...hiddenWithSection.slice(0, -1)]) {
      expect(css).toContain(`${selector},`)
    }
    // The rule's last selector carries the declaration that closes the block.
    expect(css).toContain(`${hiddenWithSection.at(-1)} { display: none; }`)
    expect(css).toContain(".panel[data-pane='detail'] .back { display: inline-flex; }")
    expect(css).toContain(".panel[data-pane='detail'] .detailTitle { display: block; margin-right: auto; }")
  })

  it('fills the handset viewport as a single-column sheet', () => {
    const css = flattened()
    expect(css).toContain('width: 100vw;')
    expect(css).toContain('height: 100dvh;')
    // The safe-area insets keep the sheet's content inside the visible area.
    expect(css).toContain('env(safe-area-inset-top)')
  })

  it('caps the panel height in dynamic viewport units where the browser supports them', () => {
    // 100vh tucks the panel's air under handset browser chrome.
    expect(flattened()).toContain(
      '@supports (height: 100dvh) { .panel { '
      + 'height: min(800px, calc(100dvh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px)))); } }',
    )
  })
})
