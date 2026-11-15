/** Fixed-position menu placement for browsers without CSS Anchor Positioning. */
import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

interface MenuAnchorRect {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
  readonly width: number
}

/** Geometry and preferences for one fixed-position menu. */
export interface MenuPlacementInput {
  readonly anchor: MenuAnchorRect
  readonly width: number
  readonly height: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly topClearance: number
  readonly side: 'bottom' | 'top' | 'right'
  readonly align: 'start' | 'end'
  readonly minWidthFromAnchor: boolean
}

/** Inline values that reproduce the menu's native placement priorities. */
export interface MenuPlacement {
  readonly left: number
  readonly top: number
  readonly maxHeight: number
  readonly minWidth: number | undefined
}

const VIEWPORT_MARGIN = 12
const ANCHOR_GAP = 4

/** Clamp a coordinate while keeping oversized content at the leading margin. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)))
}

/**
 * Place a menu beside its anchor, flipping vertically before using the window-bounded fallback.
 * @param input - anchor and menu border boxes, layout viewport, and requested placement.
 * @returns pixel coordinates and viewport limits for the fixed-position card.
 */
export function placeMenu(input: MenuPlacementInput): MenuPlacement {
  const width = Math.min(input.width, Math.max(0, input.viewportWidth - VIEWPORT_MARGIN * 2))
  const fullHeight = Math.max(0, input.viewportHeight - input.topClearance - VIEWPORT_MARGIN)
  const height = Math.min(input.height, fullHeight)
  const bottomEdge = input.viewportHeight - VIEWPORT_MARGIN
  const below = input.anchor.bottom + ANCHOR_GAP
  const above = input.anchor.top - ANCHOR_GAP - height
  const fitsBelow = below + height <= bottomEdge
  const fitsAbove = above >= input.topClearance
  const opensAbove = input.side === 'top' ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove
  let top = input.topClearance
  let maxHeight = fullHeight
  let left = input.align === 'end' ? input.anchor.right - width : input.anchor.left
  if (input.side === 'right') {
    left = input.anchor.right + ANCHOR_GAP
    if (left + width > input.viewportWidth - VIEWPORT_MARGIN
      && input.anchor.left - ANCHOR_GAP - width >= VIEWPORT_MARGIN) {
      left = input.anchor.left - ANCHOR_GAP - width
    }
    top = clamp(input.anchor.top, input.topClearance, bottomEdge - height)
  } else if (opensAbove && fitsAbove) {
    top = above
    maxHeight = Math.max(0, input.anchor.top - ANCHOR_GAP - input.topClearance)
  } else if (!opensAbove && fitsBelow) {
    top = below
    maxHeight = Math.max(0, bottomEdge - below)
  }
  left = clamp(left, VIEWPORT_MARGIN, input.viewportWidth - VIEWPORT_MARGIN - width)
  return {
    left,
    top,
    maxHeight,
    minWidth: input.minWidthFromAnchor
      ? Math.min(input.anchor.width, Math.max(0, input.viewportWidth - VIEWPORT_MARGIN * 2))
      : undefined,
  }
}

/**
 * Whether this browser can own portal placement through CSS Anchor Positioning.
 * @returns true when the native CSS declarations can position the menu.
 */
export function supportsMenuAnchorPositioning(): boolean {
  // jsdom has no CSS parser; its component suites exercise the native path.
  if (typeof window.CSS === 'undefined' || typeof window.CSS.supports !== 'function'
    || !window.CSS.supports('display', 'block')) return true
  return window.CSS.supports('position-anchor', '--dsh-menu-trigger')
    && window.CSS.supports('top', 'anchor(top)')
}

/**
 * Measure and track a portal menu only when native anchor positioning is unavailable.
 * Coordinates use the layout viewport, matching the native behavior under browser zoom.
 * @param options - menu and anchor refs plus the requested placement.
 */
export function useMenuFallbackPlacement(options: {
  readonly active: boolean
  readonly menuRef: RefObject<HTMLDivElement | null>
  readonly anchorRef: RefObject<HTMLElement | null> | undefined
  readonly rootRef: RefObject<HTMLSpanElement | null>
  readonly returnFocus: (() => HTMLElement | null) | undefined
  readonly side: 'bottom' | 'top' | 'right'
  readonly align: 'start' | 'end'
  readonly minWidthFromAnchor: boolean
}): void {
  const { active, menuRef, anchorRef, rootRef, returnFocus, side, align, minWidthFromAnchor } = options
  const native = supportsMenuAnchorPositioning()
  useLayoutEffect(() => {
    if (!active || native) return
    const menu = menuRef.current
    const anchor = returnFocus?.() ?? anchorRef?.current ?? rootRef.current
    if (menu === null || anchor === null) return
    let frame: number | undefined
    const apply = () => {
      // Clear the previous cap so movement into a larger space can grow the card.
      menu.style.maxHeight = ''
      const bounds = menu.getBoundingClientRect()
      const overlay = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-overlay-top'))
      const placement = placeMenu({
        anchor: anchor.getBoundingClientRect(),
        width: bounds.width,
        height: bounds.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        topClearance: Number.isFinite(overlay) ? Math.max(VIEWPORT_MARGIN, overlay) : VIEWPORT_MARGIN,
        side,
        align,
        minWidthFromAnchor,
      })
      menu.style.positionTryFallbacks = 'none'
      menu.style.left = `${placement.left}px`
      menu.style.top = `${placement.top}px`
      menu.style.right = 'auto'
      menu.style.bottom = 'auto'
      menu.style.justifySelf = 'start'
      menu.style.alignSelf = 'start'
      menu.style.maxHeight = `${placement.maxHeight}px`
      menu.style.minWidth = placement.minWidth === undefined ? '' : `${placement.minWidth}px`
    }
    const schedule = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => { frame = undefined; apply() })
    }
    apply()
    const observer = new ResizeObserver(schedule)
    observer.observe(menu)
    observer.observe(anchor)
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      if (frame !== undefined) cancelAnimationFrame(frame)
      menu.style.positionTryFallbacks = ''
      menu.style.left = ''
      menu.style.top = ''
      menu.style.right = ''
      menu.style.bottom = ''
      menu.style.justifySelf = ''
      menu.style.alignSelf = ''
      menu.style.maxHeight = ''
      menu.style.minWidth = ''
    }
  }, [active, native, menuRef, anchorRef, rootRef, returnFocus, side, align, minWidthFromAnchor])
}
