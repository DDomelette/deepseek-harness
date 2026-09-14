/**
 * One material's detail: where it came from, what its action will submit, its
 * own text, what the model answered, and the actions a reader takes on it.
 *
 * The text is editable until the material entered its conversation and
 * read-only afterwards, because the session log carries the submitted body and
 * the Host refuses to rewrite the record. The draft lives here rather than in
 * the store: leaving the detail discards an unsaved edit, which is what a
 * reader expects from a pane they navigated away from.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesActionView, NotesMaterialSummary, NotesThreadRow } from '../types.ts'
import { configuredAction } from './actions.ts'
import { failureLine } from './failure-line.ts'
import type { NotesPanelFailure } from './failure-line.ts'
import type { NotesInjected } from './face.ts'
import type { NotesKey } from './locales.ts'
import css from './MaterialDetail.module.css'

/** How long the copy control reports success, in ms. */
const COPIED_MS = 1000

/** The dictionary line for each collection view. */
const VIEW_LINES: Readonly<Record<NotesMaterialSummary['source']['view'], NotesKey>> = {
  chat: 'source.chat',
  trajectory: 'source.trajectory',
}

/** The dictionary line for each lifecycle state. */
const STATUS_LINES: Readonly<Record<NotesMaterialSummary['status'], NotesKey>> = {
  draft: 'status.draft',
  analyzing: 'status.analyzing',
  analyzed: 'status.analyzed',
  failed: 'status.failed',
}

/** The detail pane's props: the material, its thread, and the panel's commands. */
export interface MaterialDetailProps {
  /** The material being shown. */
  readonly material: NotesMaterialSummary
  /** Its thread, in sequence order. */
  readonly thread: readonly NotesThreadRow[]
  /** The thread read is in flight. */
  readonly threadLoading: boolean
  /** Why the thread read produced nothing. */
  readonly threadFailure: NotesPanelFailure | undefined
  /** Collection actions the settings section lists, for the action it names. */
  readonly actions: readonly NotesActionView[]
  /** The panel's commands. */
  readonly commands: NotesInjected
  /** Namespace-bound translate. */
  readonly t: PropsLocale<'notes'>['t']
}

/**
 * The detail pane for one material.
 * @param props - the material, its thread, and the panel's commands.
 * @returns the pane.
 */
export function MaterialDetail({
  material, thread, threadLoading, threadFailure, actions, commands, t,
}: MaterialDetailProps): ReactNode {
  const [draft, setDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const text = material.text ?? ''
  const shown = draft ?? text
  const action = configuredAction(material.action, actions)
  const copy = (): void => {
    if (copied) return
    void writeClipboard(shown).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPIED_MS)
    })
  }
  return (
    <section className={css.detail} data-notes-detail={material.id}>
      <div className={css.source} data-notes-source>
        <span className={css.sourceLabel}>{material.source.label}</span>
        <span className={css.sourceView}>
          {material.kind === 'image' ? t('source.image') : t(VIEW_LINES[material.source.view])}
        </span>
      </div>
      {action !== undefined && (
        <div className={css.template} data-notes-action-template={action.id}>
          <span className={css.templateLabel}>{t('detail.actionTemplate')}</span>
          <p className={css.templateText}>{action.prompt}</p>
        </div>
      )}
      {material.submitted
        ? <p className={css.body} data-notes-body>{text}</p>
        : (
          <textarea
            className={css.editor}
            aria-label={t('detail.body')}
            data-notes-editor
            value={shown}
            onChange={(event) => { setDraft(event.target.value) }}
          />
        )}
      <div className={css.actions}>
        <span className={css.status} data-notes-status={material.status}>
          {t(STATUS_LINES[material.status])}
        </span>
        {draft !== null && draft !== text && (
          <button
            type="button"
            className={css.action}
            data-notes-save
            onClick={() => { commands.saveText(material.id, draft) }}
          >
            {t('detail.save')}
          </button>
        )}
        {/* Nothing to copy would replace the clipboard with an empty string. */}
        {shown !== '' && (
          <button
            type="button"
            className={css.action}
            data-notes-copy
            onClick={copy}
          >
            {copied ? t('detail.copied') : t('detail.copy')}
          </button>
        )}
        <button
          type="button"
          className={css.action}
          data-notes-analyze
          onClick={() => { commands.analyze(material.id) }}
        >
          {t('detail.analyze')}
        </button>
        <button
          type="button"
          className={css.action}
          data-notes-archive
          onClick={() => { commands.archive(material.id) }}
        >
          {t('detail.archive')}
        </button>
        <button
          type="button"
          className={css.action}
          data-notes-remove
          onClick={() => { commands.remove(material.id) }}
        >
          {t('detail.remove')}
        </button>
      </div>
      {material.error !== null && <p className={css.failure} data-notes-material-error>{material.error}</p>}
      <Thread
        id={material.id}
        thread={thread}
        loading={threadLoading}
        failure={threadFailure}
        askable={material.submitted}
        commands={commands}
        t={t}
      />
    </section>
  )
}

/** The material's own questions and the model's answers, and the next question. */
function Thread({ id, thread, loading, failure, askable, commands, t }: {
  readonly id: NotesMaterialSummary['id']
  readonly thread: readonly NotesThreadRow[]
  readonly loading: boolean
  readonly failure: NotesPanelFailure | undefined
  /** Whether the material already entered its conversation, so it has a thread to add to. */
  readonly askable: boolean
  readonly commands: NotesInjected
  readonly t: PropsLocale<'notes'>['t']
}): ReactNode {
  const [question, setQuestion] = useState('')
  const asked = question.trim() !== ''
  return (
    <div className={css.thread} data-notes-thread>
      {loading && <p className={css.pending}>{t('detail.threadLoading')}</p>}
      {failure !== undefined && (
        <p className={css.failure} data-notes-thread-failure={failure.code}>{failureLine(t, failure)}</p>
      )}
      {thread.map(row => (
        <p key={row.seq} className={css[row.role]} data-notes-row={row.role}>{row.text}</p>
      ))}
      {!loading && failure === undefined && thread.length === 0 && (
        <p className={css.pending} data-notes-thread-empty>{t('detail.threadEmpty')}</p>
      )}
      {askable && (
        <form
          className={css.ask}
          onSubmit={(event) => {
            event.preventDefault()
            if (!asked) return
            commands.ask(id, question)
            setQuestion('')
          }}
        >
          <input
            className={css.question}
            aria-label={t('detail.ask')}
            placeholder={t('detail.ask')}
            data-notes-question
            value={question}
            onChange={(event) => { setQuestion(event.target.value) }}
          />
          <button type="submit" className={css.send} data-notes-send disabled={!asked}>
            {t('detail.ask')}
          </button>
        </form>
      )}
    </div>
  )
}
