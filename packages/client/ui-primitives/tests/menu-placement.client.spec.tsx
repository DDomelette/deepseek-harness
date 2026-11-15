// @vitest-environment jsdom
/** Geometry fallback used only by browsers without CSS Anchor Positioning. */
import { createRef } from 'react'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Menu } from '../src/Menu.tsx'
import { placeMenu, supportsMenuAnchorPositioning, useMenuFallbackPlacement, type MenuPlacementInput } from '../src/menu-placement.ts'

const BASE: MenuPlacementInput = {
  anchor: { top: 200, right: 344, bottom: 228, left: 200, width: 144 },
  width: 144,
  height: 80,
  viewportWidth: 390,
  viewportHeight: 844,
  topClearance: 12,
  side: 'bottom',
  align: 'end',
  minWidthFromAnchor: false,
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('placeMenu', () => {
  it('aligns below the anchor and applies the optional anchor width', () => {
    expect(placeMenu({ ...BASE, minWidthFromAnchor: true })).toEqual({ left: 200, top: 232, maxHeight: 600, minWidth: 144 })
  })

  it('flips a bottom menu above when the lower edge is full', () => {
    expect(placeMenu({ ...BASE, anchor: { ...BASE.anchor, top: 760, bottom: 788 } }))
      .toEqual({ left: 200, top: 676, maxHeight: 744, minWidth: undefined })
  })

  it('keeps a requested top menu above, or moves it below when necessary', () => {
    expect(placeMenu({ ...BASE, side: 'top' })).toEqual({ left: 200, top: 116, maxHeight: 184, minWidth: undefined })
    expect(placeMenu({ ...BASE, side: 'top', anchor: { ...BASE.anchor, top: 40, bottom: 68 } }))
      .toEqual({ left: 200, top: 72, maxHeight: 760, minWidth: undefined })
  })

  it('uses the full window when neither vertical side fits', () => {
    expect(placeMenu({ ...BASE, height: 500, anchor: { ...BASE.anchor, top: 400, bottom: 428 } }))
      .toEqual({ left: 200, top: 12, maxHeight: 820, minWidth: undefined })
  })

  it('places a right menu beside the anchor and clamps its vertical position', () => {
    expect(placeMenu({ ...BASE, side: 'right', align: 'start', anchor: { ...BASE.anchor, left: 20, right: 164 } }))
      .toEqual({ left: 168, top: 200, maxHeight: 820, minWidth: undefined })
    expect(placeMenu({ ...BASE, side: 'right', align: 'start', anchor: { ...BASE.anchor, left: 20, right: 164, top: 800, bottom: 828 } }))
      .toEqual({ left: 168, top: 752, maxHeight: 820, minWidth: undefined })
  })

  it('flips a right menu left only when that side fits', () => {
    expect(placeMenu({ ...BASE, side: 'right' }))
      .toEqual({ left: 52, top: 200, maxHeight: 820, minWidth: undefined })
    expect(placeMenu({ ...BASE, side: 'right', anchor: { ...BASE.anchor, left: 20, right: 164 } }))
      .toEqual({ left: 168, top: 200, maxHeight: 820, minWidth: undefined })
  })

  it('keeps oversized and negatively bounded geometry inside the leading margin', () => {
    expect(placeMenu({ ...BASE, width: 500, minWidthFromAnchor: true })).toEqual({ left: 12, top: 232, maxHeight: 600, minWidth: 144 })
    expect(placeMenu({ ...BASE, viewportWidth: 20, width: 30, minWidthFromAnchor: true }))
      .toEqual({ left: 12, top: 232, maxHeight: 600, minWidth: 0 })
  })
})

describe('CSS anchor capability', () => {
  it('retains the CSS path where the test DOM has no CSS parser', () => {
    vi.stubGlobal('CSS', undefined)
    expect(supportsMenuAnchorPositioning()).toBe(true)
  })

  it('requires both the anchor name and anchor function', () => {
    const supports = vi.fn((property: string) => property === 'display' || property === 'position-anchor')
    vi.stubGlobal('CSS', { supports })
    expect(supportsMenuAnchorPositioning()).toBe(false)
    supports.mockReturnValue(true)
    expect(supportsMenuAnchorPositioning()).toBe(true)
  })
})

describe('useMenuFallbackPlacement', () => {
  it('does nothing without mounted elements', () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property === 'display' })
    const menuRef = createRef<HTMLDivElement>()
    const rootRef = createRef<HTMLSpanElement>()
    renderHook(() => { useMenuFallbackPlacement({
      active: true, menuRef, rootRef, anchorRef: undefined, returnFocus: undefined,
      side: 'bottom', align: 'end', minWidthFromAnchor: false,
    }) })
    expect(menuRef.current).toBeNull()
  })

  it('tracks the anchor after scrolling and removes observers and pending frames', async () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property === 'display' })
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 844)
    const callbacks: FrameRequestCallback[] = []
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length }))
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
    })
    let anchorBox = rect(200, 200, 144, 28)
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'menu' ? rect(12, 700, 144, 80) : anchorBox
    })
    const view = render(<Menu open portal align="end" minWidthFromAnchor anchor={<button>Open</button>}
      items={[{ id: 'one', label: 'One' }]} onClose={vi.fn()} />)
    const menu = view.getByRole('menu')
    expect(menu.style.left).toBe('200px')
    expect(menu.style.top).toBe('232px')
    expect(menu.style.minWidth).toBe('144px')
    expect(observe).toHaveBeenCalledTimes(2)

    anchorBox = rect(180, 300, 144, 28)
    act(() => {
      document.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('resize'))
    })
    expect(callbacks).toHaveLength(1)
    act(() => { callbacks.shift()?.(0) })
    expect(menu.style.left).toBe('180px')
    expect(menu.style.top).toBe('332px')

    act(() => { document.dispatchEvent(new Event('scroll')) })
    view.rerender(<Menu open={false} portal align="end" minWidthFromAnchor anchor={<button>Open</button>}
      items={[{ id: 'one', label: 'One' }]} onClose={vi.fn()} />)
    expect(disconnect).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
    expect(geometry).toHaveBeenCalled()
  })

  it('honors an explicit focus anchor and the frame top clearance', () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property === 'display' })
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 844)
    document.documentElement.style.setProperty('--dsh-frame-overlay-top', '60px')
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    const menu = document.body.appendChild(document.createElement('div'))
    const anchor = document.body.appendChild(document.createElement('button'))
    const focusAnchor = document.body.appendChild(document.createElement('button'))
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect(12, 700, 144, 80))
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(20, 20, 100, 28))
    vi.spyOn(focusAnchor, 'getBoundingClientRect').mockReturnValue(rect(200, 200, 144, 28))
    const { unmount } = renderHook(() => { useMenuFallbackPlacement({
      active: true, menuRef: { current: menu }, anchorRef: { current: anchor }, rootRef: { current: null },
      returnFocus: () => focusAnchor, side: 'top', align: 'start', minWidthFromAnchor: false,
    }) })
    expect(menu.style.top).toBe('116px')
    expect(menu.style.maxHeight).toBe('136px')
    unmount()
    expect(menu.style.top).toBe('')
    document.documentElement.style.removeProperty('--dsh-frame-overlay-top')
  })
})
