/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * rightbar), the drag handles (pointer capture + rAF throttle), the column
 * solve (columns.ts), and the child-slot render decisions: the sidebar slot
 * receives live parameters from that solve. The root-scoped main slot selects
 * the Conversation or a global panel. Each column occupant owns its Session
 * binding and reports the geometry it needs.
 *
 * Below the overlay breakpoint (columns.ts SIDEBAR_OVERLAY) an expanded sidebar
 * leaves the grid: the closed sidebar owns no track — the floating brand button
 * (the sidebar slot's fab flag) replaces the rail — and the column floats over
 * the center as a drawer behind a scrim. A scrim tap, Escape, or a tracked edge
 * swipe closes it; a right swipe from the frame's left edge opens it. Enter
 * rides a mount-scoped keyframe (data-entering, cleared on the keyframe's own
 * duration — re-arming it mid-life would flash the column back to its hidden
 * start) and exit a delayed unmount (DRAWER_SLIDE_MS), both on the track
 * transition's duration and curve; a swipe-driven mount never sets the flag
 * because the gesture's inline tracking already owns the position.
 *
 * The right column is a track, not a box: its occupant draws its panel anchored
 * to the frame's right edge at the resolved normal width, and the
 * track only decides whether the centre makes room for it. The occupant reports
 * shown/track/fullscreen through `ctx.layout`; fullscreen keeps the reported
 * track but hides the outer resize handle. Everything arrives through the framework
 * shares — zero cordis or framework imports, zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, RIGHTBAR_DEFAULT_RATIO, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT, SIDEBAR_OVERLAY } from './columns.ts'
import type { Columns } from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Left-edge strip width in px that arms the drawer open gesture (overlay band). */
const EDGE_SWIPE_PX = 40
/** Pointer travel in px below which a touch stays a tap or a scroll, never a drawer gesture. */
const GESTURE_SLOP_PX = 8
/** Drawer-width fraction of the full travel past which a release snaps to the gesture's target. */
const GESTURE_SNAP_RATIO = 0.35
/** Slide-out window in ms the closing drawer stays mounted under data-closing
 * for; matches the drawer transitions' --ds-transition-duration-slow
 * (AppFrame.module.css). */
const DRAWER_SLIDE_MS = 300

/** One in-flight drawer swipe: a candidate until the slop check engages it. */
interface SidebarGesture {
  /** Pointer that owns the gesture; later pointers are ignored. */
  pointerId: number
  /** Gesture origin for dx/dy deltas. */
  startX: number
  /** Gesture origin for the vertical-dominance check. */
  startY: number
  /** Open gestures start closed at the left edge; close gestures start open anywhere. */
  direction: 'open' | 'close'
  /** True once travel passed the slop horizontally and the pointer was captured. */
  active: boolean
  /** Pending rAF applying the tracked position, or null. */
  frame: number | null
  /** Resolved drawer width at engagement; thresholds and tracking ride it. */
  width: number
}

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'main' | 'rightbar' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Subscribe to the main key without subscribing the column frame to each panel id. */
function MainPanel({ usePanelInfo, renderSlot }: Pick<PropsRuntime<'root'>, 'usePanelInfo'> & PropsRenderSlots<'main'>) {
  const panelId = usePanelInfo(info => info.activePanelId)
  return renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })
}

/**
 * Right column grid item. Zero-width unless the occupant asked for a track; the
 * occupant's panel is positioned against the column's right edge, which never
 * moves, so it can hang over the centre when there is no track.
 */
function RightbarColumn(props: { children?: ReactNode }) {
  return <div className={css.rightbarCol} data-rightbar-col>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'rightbar'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const endDrag = useCallback(() => {
    const active = capture.current
    if (active === null) return
    capture.current = null
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || capture.current !== null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    capture.current = { element: e.currentTarget, id: e.pointerId }
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    callbacks.current.onDrag(e.clientX - origin.current)
    endDrag()
  }, [endDrag])
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id === e.pointerId) endDrag()
  }, [endDrag])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  usePanelInfo,
  actions,
  renderSlot,
  t,
}: AppFrameProps) {
  const layoutInfo = useStore(state => state.layoutInfo)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const viewport = layoutInfo.viewportWidth

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useLayoutEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    let disposed = false
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) actions.setViewportWidth(width)
    }
    measure()
    const observer = new ResizeObserver(() => {
      if (disposed) return
      raf ??= requestAnimationFrame(() => {
        raf = null
        measure()
      })
    })
    observer.observe(el)
    return () => {
      disposed = true
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [actions])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  const overlay = viewport < SIDEBAR_OVERLAY
  const sidebarCollapsed = narrow ? !layoutInfo.narrowExpanded : layoutInfo.sidebar === 0
  // Below the overlay breakpoint an expanded sidebar leaves the grid and floats
  // over the center as a drawer.
  const drawerOpen = overlay && !sidebarCollapsed
  const sidebarPreference = sidebarCollapsed
    ? 0
    : layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar
  const rightbarPreference = layoutInfo.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  // Opening on a narrow frame collapses the left sidebar. Eligibility must
  // include that space before the occupant's first shown report arrives.
  const normal = computeColumns(viewport, !layoutInfo.rightbarShown && narrow ? 0 : drawerOpen ? 0 : sidebarPreference, rightbarPreference)
  const solved = computeColumns(viewport, drawerOpen ? 0 : sidebarPreference, layoutInfo.rightbarTrack ? rightbarPreference : 0)
  // Below the overlay breakpoint the closed sidebar owns no track: the floating
  // brand button (the sidebar slot's fab flag) replaces the rail, so the
  // solve's rail width is dropped here. computeColumns keeps its 0→rail
  // semantics for the squeeze band and its own tests.
  const cols: Columns = overlay
    ? { sidebar: 0, center: Math.max(0, viewport - solved.rightbar), rightbar: solved.rightbar }
    : solved
  const colsRef = useRef(cols)
  colsRef.current = cols
  const rightbarWidth = useRef(normal.rightbar)
  rightbarWidth.current = normal.rightbar

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onRightbarStart = useCallback(() => { rightbarBase.current = rightbarWidth.current; setDragging(true) }, [])
  const onRightbarDrag = useCallback((dx: number) => {
    actions.setRightbar(rightbarBase.current - dx)
  }, [actions])
  // The drawer is the lowest-priority Escape owner: every surface above it
  // consumes the key when it closes itself, so this toggles only on an
  // unconsumed Escape.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      actions.toggleSidebar()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [drawerOpen, actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')
  // A desktop-dragged preference can exceed a handset viewport; the floating
  // drawer caps at the frame so the scrim and the brand button stay reachable.
  const drawerWidth = Math.min(layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar, viewport)

  // Drawer slide-out: after the store closes, the column and scrim stay
  // mounted under data-closing until the transition ends, so every close path
  // (scrim tap, Escape, the sidebar's collapse control, an edge swipe) slides
  // out instead of vanishing. The closing flag is derived DURING RENDER (the
  // sanctioned adjust-state-on-prop-change pattern): an effect would commit
  // one fully-unmounted frame first — a visible flash, and a barrier waiting
  // for the scrim to detach would release into the slide-out window. A reopen
  // inside the window cancels it in the same commit; leaving the overlay band
  // ends the window at once.
  const [drawerClosing, setDrawerClosing] = useState(false)
  const [drawerWasOpen, setDrawerWasOpen] = useState(drawerOpen)
  // An edge-swipe-opened mount skips the enter keyframe (data-gesture-driven):
  // the gesture's own inline tracking owns the column's position from the
  // first frame. The flag resets when the drawer presentation unmounts.
  const [gestureDriven, setGestureDriven] = useState(false)
  // The enter keyframe is mount-scoped (data-entering): it arms only on a
  // fresh, non-gesture mount — a reopen inside the slide-out window
  // transitions back from its mid-slide position instead — and clears on the
  // keyframe's duration (below) or when a swipe engages, so no later attribute
  // change can restart it and flash the column back to its hidden start.
  const [drawerEntering, setDrawerEntering] = useState(false)
  if (drawerWasOpen !== drawerOpen) {
    setDrawerWasOpen(drawerOpen)
    setDrawerClosing(!drawerOpen && drawerWasOpen && overlay)
    setDrawerEntering(drawerOpen && !gestureDriven && !drawerClosing)
  }
  if (!overlay && (drawerClosing || gestureDriven)) {
    setDrawerClosing(false)
    setGestureDriven(false)
  }
  useEffect(() => {
    if (!drawerClosing) return
    const timer = window.setTimeout(() => {
      setDrawerClosing(false)
      setGestureDriven(false)
    }, DRAWER_SLIDE_MS)
    return () => { clearTimeout(timer) }
  }, [drawerClosing])
  // The entering flag's backstop: animationend is unreliable (reduced motion
  // drops the animation entirely), so the flag clears on the keyframe's own
  // duration whether or not the animation ran.
  useEffect(() => {
    if (!drawerEntering) return
    const timer = window.setTimeout(() => { setDrawerEntering(false) }, DRAWER_SLIDE_MS)
    return () => { clearTimeout(timer) }
  }, [drawerEntering])
  const drawerShown = drawerOpen || (overlay && drawerClosing)
  const sidebarWidth = drawerShown ? drawerWidth : cols.sidebar

  // Drawer edge swipe (overlay band, touch pointers only): a right swipe from
  // the frame's left edge opens the drawer under the pointer, and a left swipe
  // while it is open closes it. A mouse drag keeps its text-selection meaning
  // and never arms the gesture, so overlay-band mice open and close through
  // the fab, the drag handle, and the scrim click instead. The tracked
  // position drives the column and scrim through inline styles while the
  // store flips only at engagement and release, so a re-render never fights
  // the gesture's own writes.
  const sidebarColRef = useRef<HTMLDivElement | null>(null)
  const scrimRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<SidebarGesture | null>(null)
  const gestureX = useRef(0)
  // The pointer handlers read the latest committed render through this mirror:
  // moves between renders must see the post-toggle drawer state and width.
  const gestureEnv = useRef({ overlay, drawerOpen, drawerWidth })
  gestureEnv.current = { overlay, drawerOpen, drawerWidth }
  const applyGesture = useCallback(() => {
    const g = gestureRef.current
    /* v8 ignore next -- a queued frame is canceled when the gesture ends, so the callback only runs while a gesture is active. */
    if (g === null || !g.active) return
    const col = sidebarColRef.current
    /* v8 ignore next -- the sidebar column renders unconditionally. */
    if (col === null) return
    // The scrim guard fires when the drawer closed mid-gesture (an unconsumed
    // Escape): its element is gone and there is nothing left to track.
    const scrim = scrimRef.current
    if (scrim === null) return
    const dx = gestureX.current - g.startX
    if (g.direction === 'open') {
      // The drawer follows from its hidden offset; the scrim fades in with travel.
      col.style.transform = `translateX(${Math.min(0, dx - g.width)}px)`
      scrim.style.opacity = String(Math.min(1, Math.max(0, dx / g.width)))
    } else {
      col.style.transform = `translateX(${Math.min(0, dx)}px)`
      scrim.style.opacity = String(Math.min(1, Math.max(0, 1 + dx / g.width)))
    }
  }, [])
  const clearGestureWrites = useCallback(() => {
    const col = sidebarColRef.current
    /* v8 ignore next -- the sidebar column renders unconditionally. */
    if (col !== null) col.style.transform = ''
    const scrim = scrimRef.current
    if (scrim !== null) scrim.style.opacity = ''
  }, [])
  const endGesture = useCallback((pointerId: number, clientX: number, commit: boolean) => {
    const g = gestureRef.current
    if (g === null || g.pointerId !== pointerId) return
    gestureRef.current = null
    if (g.frame !== null) cancelAnimationFrame(g.frame)
    const frame = frameRef.current
    /* v8 ignore next -- the handlers only fire while the frame div is mounted. */
    if (frame === null) return
    if (frame.hasPointerCapture(pointerId)) frame.releasePointerCapture(pointerId)
    frame.removeAttribute('data-sidebar-gesture')
    if (!g.active) return
    // Settle on the side the travel vote chose, comparing against live state so
    // an external close mid-gesture (Escape) is not toggled back open.
    const travel = Math.min(1, Math.max(0, (g.direction === 'open' ? clientX - g.startX : g.startX - clientX) / g.width))
    const wantOpen = g.direction === 'open' ? commit && travel > GESTURE_SNAP_RATIO : !(commit && travel > GESTURE_SNAP_RATIO)
    if (wantOpen === gestureEnv.current.drawerOpen) {
      // Staying on the gesture's own side: the base transition animates the
      // snap back to the natural position from wherever the finger left it.
      clearGestureWrites()
      return
    }
    actions.toggleSidebar()
    // The closing/opening styles land with the toggle's commit; only then may
    // the tracked inline position go, so the slide starts where the finger
    // left it.
    requestAnimationFrame(() => { clearGestureWrites() })
  }, [actions, clearGestureWrites])
  const onGestureDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const env = gestureEnv.current
    if (!env.overlay || e.button !== 0 || e.pointerType !== 'touch' || gestureRef.current !== null) return
    const frame = frameRef.current
    /* v8 ignore next -- the handlers only fire while the frame div is mounted. */
    if (frame === null) return
    // Closed: only the left-edge strip arms a swipe. Open: anywhere — the
    // drawer's content and the scrim both close on a left swipe.
    if (!env.drawerOpen && e.clientX - frame.getBoundingClientRect().left > EDGE_SWIPE_PX) return
    gestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      direction: env.drawerOpen ? 'close' : 'open',
      active: false,
      frame: null,
      width: env.drawerWidth,
    }
    gestureX.current = e.clientX
  }, [])
  const onGestureMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    if (g === null || g.pointerId !== e.pointerId) return
    gestureX.current = e.clientX
    if (!g.active) {
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      // Vertical-dominant travel belongs to nested scrollers: release the
      // candidate so the touch keeps scrolling.
      if (Math.abs(dy) > GESTURE_SLOP_PX && Math.abs(dy) > Math.abs(dx)) {
        gestureRef.current = null
        return
      }
      const engaged = g.direction === 'open' ? dx > GESTURE_SLOP_PX : dx < -GESTURE_SLOP_PX
      if (!engaged) return
      g.active = true
      e.currentTarget.setPointerCapture(e.pointerId)
      e.currentTarget.setAttribute('data-sidebar-gesture', '')
      // A swipe engaging mid-enter ends the keyframe at once so the gesture's
      // inline tracking owns the position from the first frame.
      setDrawerEntering(false)
      // An open gesture mounts the drawer now so the next animation frame can
      // track it from its hidden offset; a close gesture settles at release.
      // The mount skips its enter keyframe (data-gesture-driven): the gesture
      // owns the position from the first frame.
      if (g.direction === 'open') {
        setGestureDriven(true)
        actions.toggleSidebar()
      }
    }
    g.frame ??= requestAnimationFrame(() => {
      g.frame = null
      applyGesture()
    })
  }, [actions, applyGesture])
  const onGestureUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    endGesture(e.pointerId, e.clientX, true)
  }, [endGesture])
  const onGestureCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    endGesture(e.pointerId, e.clientX, false)
  }, [endGesture])
  // Drop a queued gesture frame on unmount; the inline styles die with the DOM.
  useEffect(() => () => {
    const g = gestureRef.current
    if (g !== null && g.frame !== null) cancelAnimationFrame(g.frame)
  }, [])

  const sidebar = useMemo(() => renderSlot('sidebar', {
    // The slide-out keeps the wide parameters: the column must not swap to
    // the floating brand button mid-slide.
    collapsed: drawerShown ? false : sidebarCollapsed,
    width: sidebarWidth,
    fab: overlay,
  }), [renderSlot, drawerShown, sidebarCollapsed, sidebarWidth, overlay])
  const main = useMemo(() => (
    <MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} />
  ), [usePanelInfo, renderSlot])
  const overlays = useMemo(() => renderSlot('shell.overlay', {}), [renderSlot])

  // data-sidebar-fab is a cross-package contract (attribute selectors are not
  // CSS-module localized): ui-conversation pads its session header clear of
  // the floating brand button through it and scopes the docked composer's
  // handset rules with it; ui-chat aligns the transcript inset with the input
  // card through it.
  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns:
          `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px`,
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-drawer={drawerOpen || undefined}
      data-rightbar-collapsed={cols.rightbar === 0 || undefined}
      data-rightbar-fullscreen={layoutInfo.rightbarFullscreen || undefined}
      data-rightbar-instant={layoutInfo.rightbarInstant || undefined}
      data-dragging={dragging || undefined}
      data-sidebar-fab={overlay || undefined}
      onPointerDown={onGestureDown}
      onPointerMove={onGestureMove}
      onPointerUp={onGestureUp}
      onPointerCancel={onGestureCancel}
      onLostPointerCapture={onGestureCancel}
    >
      <DocumentTitle
        productTitle={productTitle}
        useSessions={useSessions}
        usePanelInfo={usePanelInfo}
      />
      <div
        ref={sidebarColRef}
        className={css.sidebarCol}
        data-drawer={drawerShown || undefined}
        data-closing={drawerClosing || undefined}
        data-entering={drawerEntering || undefined}
        data-gesture-driven={gestureDriven || undefined}
      >
        {sidebar}
      </div>
      <>
        <CenterColumn>{main}</CenterColumn>
        <RightbarColumn>
          {renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
        </RightbarColumn>
      </>
      {drawerShown && (
        <div
          ref={scrimRef}
          className={css.scrim}
          aria-hidden="true"
          data-drawer-scrim
          data-closing={drawerClosing || undefined}
          data-entering={drawerEntering || undefined}
          data-gesture-driven={gestureDriven || undefined}
          onClick={() => { actions.toggleSidebar() }}
        />
      )}
      <div className={css.overlayLayer} data-shell-overlay>
        {overlays}
      </div>
      {/* No resize handle on the fixed-width rail or beneath the overlay drawer. */}
      {!overlay && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && normal.rightbar > 0 && (
        <DragHandle side="rightbar" left={viewport - normal.rightbar} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
