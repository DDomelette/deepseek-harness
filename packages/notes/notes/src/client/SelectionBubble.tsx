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
import { useCallback, useEffect, useState } from 'react'
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
  /** Where the bubble sits, in viewport coordinates. */
  readonly left: number
  readonly top: number
  /** What the row the passage started in says about itself. */
  readonly anchor: CollectedAnchor
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
    setBubble({ text, left: box.left + box.width / 2, top: box.top, anchor: anchorAt(range.startContainer) })
    // The actions are read only once a selection offers them: this layer covers
    // every conversation, and most of them never collect anything.
    readSettings()
  }, [content, view, readSettings])

  useEffect(() => {
    document.addEventListener('selectionchange', measure)
    return () => { document.removeEventListener('selectionchange', measure) }
  }, [measure])

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
  return (
    <div
      className={css.bubble}
      role="toolbar"
      aria-label={t('collect.toolbar')}
      data-notes-bubble
      style={{ left: `${String(bubble.left)}px`, top: `${String(bubble.top)}px` }}
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
