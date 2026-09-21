/**
 * One material's detail: its title and state, what its action will submit, its
 * own text, what the model answered, and the actions a reader takes on it.
 *
 * The pane's head names the material and holds its chrome: the status tag, the
 * source disclosure, and the menu of row-level actions (copy, archive,
 * delete). The body section keeps only the body — editable until the material
 * entered its conversation, because the session log carries the submitted body
 * and the Host refuses to rewrite the record; the draft's save and submit
 * controls sit with the editor they act on. The draft lives here rather than
 * in the store: leaving the detail discards an unsaved edit, which is what a
 * reader expects from a pane they navigated away from.
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconChevronDownOutline14, IconEllipsisOutline16, MarkdownText, Menu, RiskConfirmation, Tag,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesActionView, NotesMaterialSummary, NotesThreadRow } from '../types.ts'
import { configuredAction } from './actions.ts'
import { failureLine } from './failure-line.ts'
import { materialTitle } from './title.ts'
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

/**
 * The localized chrome the shared Markdown renderer needs; it owns no copy of
 * its own, so each surface names the words in its own language.
 * @param t - namespace-bound translate.
 * @returns the labels for one rendered answer.
 */
function markdownLabels(t: PropsLocale<'notes'>['t']): MarkdownLabels {
  return {
    code: { copyLabel: t('detail.codeCopy'), copiedLabel: t('detail.codeCopied') },
    footnotes: t('detail.footnotes'),
  }
}

/**
 * Whether a material's source records any position to open.
 * @param source - the material's collection source.
 * @returns true when it carries a sequence, a message, or a call.
 */
function locatable(source: NotesMaterialSummary['source']): boolean {
  return [source.seq, source.messageId, source.callId].some(value => value !== null)
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
  const [locating, setLocating] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeAcknowledged, setRemoveAcknowledged] = useState(false)
  // Stable per locale revision: a fresh labels object per render would rebuild
  // MarkdownText's component table on every keystroke of the editor below.
  const labels = useMemo(() => markdownLabels(t), [t])
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
  const menuItems = [
    // Nothing to copy would replace the clipboard with an empty string.
    ...shown === '' ? [] : [{ id: 'copy', label: t('detail.copy') }],
    ...material.archivedAt === null
      ? [{ id: 'archive', label: t('detail.archive') }]
      : [{ id: 'restore', label: t('panel.restore') }],
    { id: 'remove', label: t('detail.remove'), danger: true as const },
  ]
  const menuSelect = (id: string): void => {
    setMenuOpen(false)
    /* v8 ignore next 3 -- Menu can emit only the ids menuItems supplies. */
    if (id !== 'copy' && id !== 'archive' && id !== 'restore' && id !== 'remove') return
    if (id === 'copy') copy()
    else if (id === 'archive') commands.archive(material.id)
    else if (id === 'restore') commands.restore(material.id)
    else setRemoving(true)
  }
  return (
    <section className={css.detail} data-notes-detail={material.id}>
      <div className={css.head}>
        {/* The pane's head names the material the way its list row does. */}
        <h2 className={css.detailTitle} data-notes-material-title>{materialTitle(material)}</h2>
        <span className={css.headStatus} data-notes-status={material.status}>
          <Tag tone="quiet">{t(STATUS_LINES[material.status])}</Tag>
        </span>
        <span className={css.headActions}>
          {copied && <span className={css.copiedNote} data-notes-copied>{t('detail.copied')}</span>}
          <Button
            size="sm"
            variant="outline"
            aria-expanded={sourceOpen}
            data-notes-source-toggle
            onClick={() => { setSourceOpen(open => !open) }}
          >
            {t('detail.sourceToggle')}
            <IconChevronDownOutline14 />
          </Button>
          <Menu
            open={menuOpen}
            anchor={(
              <Button
                size="sm"
                variant="outline"
                aria-label={t('list.rowMenu')}
                data-notes-detail-menu
                onClick={() => { setMenuOpen(open => !open) }}
              >
                <IconEllipsisOutline16 />
              </Button>
            )}
            items={menuItems}
            onSelect={menuSelect}
            onClose={() => { setMenuOpen(false) }}
            align="end"
            portal
            dense
          />
        </span>
      </div>
      {sourceOpen && (
        <div className={css.sourceCard} data-notes-source>
          <span className={css.sourceLabel}>{material.source.label}</span>
          <span className={css.sourceView}>
            {material.kind === 'image' ? t('source.image') : t(VIEW_LINES[material.source.view])}
          </span>
          {/* A material collected from the panel records no row, so it offers no
              entry that could never point anywhere. */}
          {locatable(material.source) && (
            <Button
              size="sm"
              variant="outline"
              data-notes-locate
              onClick={() => { setLocating(true) }}
            >
              {t('detail.locate')}
            </Button>
          )}
          {locating && <p className={css.locateHint} data-notes-locate-hint>{t('detail.locateHint')}</p>}
        </div>
      )}
      {action !== undefined && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('detail.actionTemplate')}</h3>
          {/* The template is a fixed deployment string, so the card shows its
              first line until the reader asks for the whole prompt. */}
          <button
            type="button"
            className={css.template}
            aria-expanded={templateOpen}
            data-notes-action-template={action.id}
            onClick={() => { setTemplateOpen(open => !open) }}
          >
            <span className={css.templateText}>{action.prompt}</span>
            <span className={css.templateToggle}>
              {templateOpen ? t('detail.templateCollapse') : t('detail.templateExpand')}
            </span>
          </button>
        </section>
      )}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('detail.body')}</h3>
        {material.kind === 'image'
          // A screenshot's body is the reference it was stored as, so the pane
          // names it rather than offering an editor the Host would refuse.
          ? <p className={css.body} data-notes-body>{t('source.image')}</p>
          : material.submitted
            // A submitted body is what entered the conversation, and a collected
            // passage is as likely to be Markdown as the answer it produced, so
            // the read-only body renders like the thread row it appears in.
            ? (
              <div className={css.bodyCard} data-notes-body>
                <MarkdownText text={text} labels={labels} />
              </div>
            )
            : (
              <textarea
                className={css.editor}
                aria-label={t('detail.body')}
                data-notes-editor
                value={shown}
                onChange={(event) => { setDraft(event.target.value) }}
              />
            )}
        {/* A draft's own lifecycle controls sit with the body they act on;
            row-level actions live in the head's menu. */}
        {!material.submitted && (
          <div className={css.bodyFoot}>
            {draft !== null && draft !== text && (
              <Button
                size="sm"
                variant="outline"
                data-notes-save
                onClick={() => { commands.saveText(material.id, draft) }}
              >
                {t('detail.save')}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              data-notes-analyze
              onClick={() => { commands.analyze(material.id) }}
            >
              {t('detail.analyze')}
            </Button>
          </div>
        )}
      </section>
      {material.error !== null && <p className={css.failure} data-notes-material-error>{material.error}</p>}
      <section className={css.threadSection}>
        <h3 className={css.sectionTitle}>{t('detail.section.thread')}</h3>
        <Thread
          id={material.id}
          thread={thread}
          loading={threadLoading}
          failure={threadFailure}
          askable={material.submitted}
          commands={commands}
          labels={labels}
          t={t}
        />
      </section>
      <RiskConfirmation
        open={removing}
        title={t('detail.removeTitle')}
        description={t('detail.removeDescription')}
        acknowledgeLabel={t('detail.removeAcknowledge')}
        cancelLabel={t('list.cancel')}
        closeLabel={t('list.cancel')}
        confirmLabel={t('detail.remove')}
        acknowledged={removeAcknowledged}
        onAcknowledgedChange={setRemoveAcknowledged}
        onCancel={() => {
          setRemoving(false)
          setRemoveAcknowledged(false)
        }}
        onConfirm={() => { commands.remove(material.id) }}
      />
    </section>
  )
}

/** The material's own questions and the model's answers, and the next question. */
function Thread({ id, thread, loading, failure, askable, commands, labels, t }: {
  readonly id: NotesMaterialSummary['id']
  readonly thread: readonly NotesThreadRow[]
  readonly loading: boolean
  readonly failure: NotesPanelFailure | undefined
  /** Whether the material already entered its conversation, so it has a thread to add to. */
  readonly askable: boolean
  readonly commands: NotesInjected
  readonly labels: MarkdownLabels
  readonly t: PropsLocale<'notes'>['t']
}): ReactNode {
  const [question, setQuestion] = useState('')
  const asked = question.trim() !== ''
  return (
    <div className={css.thread} data-notes-thread>
      <div className={css.threadRows}>
        {loading && <p className={css.pending}>{t('detail.threadLoading')}</p>}
        {failure !== undefined && (
          <p className={css.failure} data-notes-thread-failure={failure.code}>{failureLine(t, failure)}</p>
        )}
        {thread.map(row => (
          <div key={row.seq} className={css[row.role]} data-notes-row={row.role}>
            {/* The model's rows carry a role label: an answer quoting the body
                must not read as part of it. */}
            {row.role === 'assistant' && <span className={css.rowRole}>{t('detail.threadAnswer')}</span>}
            {/* Both sides render as Markdown: a collected passage is as likely to
                be Markdown as the answer it produced, and the thread reads as one
                document rather than two vocabularies. */}
            <MarkdownText text={row.text} labels={labels} />
            {row.hasImage && <span className={css.rowImage} data-notes-row-image>{t('source.image')}</span>}
          </div>
        ))}
        {!loading && failure === undefined && thread.length === 0 && (
          <p className={css.pending} data-notes-thread-empty>{t('detail.threadEmpty')}</p>
        )}
      </div>
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
          <Button type="submit" size="sm" variant="primary" data-notes-send disabled={!asked}>
            {t('detail.ask')}
          </Button>
        </form>
      )}
    </div>
  )
}
