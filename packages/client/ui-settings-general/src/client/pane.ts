/**
 * Pane geometry for the settings panel. Below the handset breakpoint the panel
 * shows one pane at a time — the section list, then the chosen section — so a
 * phone-width column keeps a readable width instead of splitting into a
 * squeezed two-column layout. The breakpoint matches ui-layout's
 * SIDEBAR_OVERLAY; client feature packages share no runtime values, so each
 * keeps its own copy.
 */

/** Viewport width below which the settings panel shows one pane at a time. */
export const SETTINGS_PANE_BREAKPOINT = 768

/**
 * Whether the viewport is narrow enough for the single-pane settings layout.
 * @param width - viewport width in px; defaults to the live window width.
 * @returns true when the panel shows one pane at a time.
 */
export function isSinglePaneViewport(width: number = window.innerWidth): boolean {
  return width < SETTINGS_PANE_BREAKPOINT
}
