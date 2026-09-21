/**
 * The selection bubble: what a reader has selected in the conversation, and the
 * way to keep it.
 *
 * It sits in the conversation's covering layer rather than in the panel, because
 * the passage it collects is the one under the pointer. The Host receives the
 * passage, the View it came from, and a localized label; the identities of the
 * row the passage started in are read from the row's own DOM attributes and
 * recorded with it.
 *
 * The bubble appears only over the Views whose collection the notes vocabulary
 * can name, and only while the selection is inside this conversation.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MaterialSource, NotesActionView } from '../types.ts'
import { anchorAt } from './anchor.ts'
import type { CollectedAnchor } from './anchor.ts'
import { failureLine } from './failure-line.ts'
import type { NotesPanelFailure } from './failure-line.ts'
import type { NotesInjected } from './face.ts'
import type { NotesStore } from './store.ts'
import css from './SelectionBubble.module.css'

/** The Views whose selections the notes vocabulary can name. */
const COLLECTABLE_VIEWS = new Set(['chat', 'trajectory'])

/** The bubble's props: the conversation it covers, the shared store and commands, and copy. */
export type SelectionBubbleProps =
  & PropsRuntime<'conversation.session.overlay'>
  & PropsStore<NotesStore>
  & InjectFace<NotesInjected>
  & PropsLocale<'notes'>

/** One selection as the bubble shows it. */
interface Bubble {
  /** The selected text, verbatim. */
  readonly text: string
  /** The selection's horizontal midpoint, in viewport coordinates. */
  readonly midX: number
  /** The selection's top and bottom, in viewport coordinates. */
  readonly top: number
  readonly bottom: number
  /** What the row the passage started in says about itself. */
  readonly anchor: CollectedAnchor
}

/** Where the bubble lands once its own size is known. */
interface Placement {
  /** The bubble's left and top edge, in viewport coordinates. */
  readonly left: number
  readonly top: number
  /** Which side of the selection the bubble sits on. */
  readonly side: 'above' | 'below'
}

/** The bubble keeps this distance from the selection and from the viewport's edges. */
const BUBBLE_GAP = 8

/**
 * Where the bubble goes: centered on the selection but never clipped by the
 * viewport, and flipped below the selection when the space above it is too
 * short for the bubble.
 * @param viewport - the browser viewport's size in CSS pixels.
 * @param anchor - the selection's midpoint and vertical span, in viewport coordinates.
 * @param size - the bubble's own measured size.
 * @returns the placement the bubble renders at.
 */
export function placeBubble(
  viewport: { readonly width: number; readonly height: number },
  anchor: { readonly midX: number; readonly top: number; readonly bottom: number },
  size: { readonly width: number; readonly height: number },
): Placement {
  const half = size.width / 2
  const low = BUBBLE_GAP + half
  const high = viewport.width - BUBBLE_GAP - half
  // A bubble wider than the viewport centers itself rather than clamping to
  // an edge that cannot show it whole either way.
  const left = high < low ? viewport.width / 2 : Math.min(Math.max(anchor.midX, low), high)
  const fitsAbove = anchor.top - BUBBLE_GAP - size.height >= BUBBLE_GAP
  return {
    left,
    top: fitsAbove ? anchor.top : anchor.bottom + BUBBLE_GAP,
    side: fitsAbove ? 'above' : 'below',
  }
}

/**
 * The layer that collects a selection into the notes.
 * @param props - composed slot props.
 * @returns the bubble while a collectable selection stands, and nothing otherwise.
 */
export function SelectionBubble({
  sessionId, view, content, useStore, readSettings, collect, t,
}: SelectionBubbleProps): ReactNode {
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [failure, setFailure] = useState<NotesPanelFailure | undefined>(undefined)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)

  const measure = useCallback((): void => {
    if (content === null || !COLLECTABLE_VIEWS.has(view)) {
      setBubble(null)
      return
    }
    const selection = window.getSelection()
    const text = selection?.toString() ?? ''
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0 || text.trim() === '') {
      setBubble(null)
      return
    }
    const range = selection.getRangeAt(0)
    if (!content.contains(range.commonAncestorContainer)) {
      setBubble(null)
      return
    }
    const box = range.getBoundingClientRect()
    // The row is read here rather than at the click: a press on this layer can
    // take the selection away before the command runs, and the passage's row is
    // part of what the reader selected.
    setBubble({
      text,
      midX: box.left + box.width / 2,
      top: box.top,
      bottom: box.bottom,
      anchor: anchorAt(range.startContainer),
    })
    // The actions are read only once a selection offers them: this layer covers
    // every conversation, and most of them never collect anything.
    readSettings()
  }, [content, view, readSettings])

  useEffect(() => {
    document.addEventListener('selectionchange', measure)
    return () => { document.removeEventListener('selectionchange', measure) }
  }, [measure])

  // Clamping needs the bubble's own size, which exists only once it renders;
  // the layout effect resolves it before the browser paints.
  useLayoutEffect(() => {
    const element = bubbleRef.current
    if (bubble === null || element === null) {
      setPlacement(null)
      return
    }
    const box = element.getBoundingClientRect()
    setPlacement(placeBubble(
      { width: window.innerWidth, height: window.innerHeight },
      { midX: bubble.midX, top: bubble.top, bottom: bubble.bottom },
      { width: box.width, height: box.height },
    ))
  }, [bubble])

  // The bubble tracks a selection, not a scroll offset: a scroll moves the
  // text out from under the fixed bubble, so it closes. Scroll does not
  // bubble — the capture phase is what reaches the conversation's inner
  // scroller. A resize keeps the selection, so the bubble re-measures.
  const open = bubble !== null
  useEffect(() => {
    if (!open) return
    const hide = (): void => { setBubble(null) }
    window.addEventListener('scroll', hide, { capture: true, passive: true })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', hide, { capture: true })
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  // Escape ownership: the bubble consumes the key while it shows, and an
  // already-consumed Escape belongs to a surface above it.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setBubble(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  const actions = useStore(state => state.settings?.actions ?? [])
  const source = (anchor: CollectedAnchor): MaterialSource => ({
    sessionId,
    view: view === 'trajectory' ? 'trajectory' : 'chat',
    seq: anchor.seq,
    messageId: anchor.messageId,
    callId: anchor.callId,
    label: t('collect.source'),
  })
  const submit = (action: string | null): void => {
    const passage = bubble
    /* v8 ignore next -- the button only exists while a bubble does. */
    if (passage === null) return
    void (async () => {
      const refused = await collect(passage.text, action, source(passage.anchor))
      setFailure(refused ?? undefined)
      if (refused === null) setBubble(null)
    })()
  }
  if (bubble === null) return null
  const side = placement?.side ?? 'above'
  return (
    <div
      ref={bubbleRef}
      className={css.bubble}
      role="toolbar"
      aria-label={t('collect.toolbar')}
      data-notes-bubble
      data-notes-bubble-side={side}
      style={{
        left: `${String(placement?.left ?? bubble.midX)}px`,
        top: `${String(placement?.top ?? bubble.top)}px`,
      }}
    >
      <button type="button" className={css.action} data-notes-collect onClick={() => { submit(null) }}>
        {t('collect.add')}
      </button>
      {actions.map((action: NotesActionView) => (
        <button
          key={action.id}
          type="button"
          className={css.action}
          data-notes-collect-action={action.id}
          onClick={() => { submit(action.id) }}
        >
          {action.label}
        </button>
      ))}
      {failure !== undefined && (
        <span className={css.failure} data-notes-collect-failure={failure.code}>
          {failureLine(t, failure)}
        </span>
      )}
    </div>
  )
}
