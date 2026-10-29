// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { SETTINGS_PANE_BREAKPOINT, isSinglePaneViewport } from '../src/client/pane.ts'

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')

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
