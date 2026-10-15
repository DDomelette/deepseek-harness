/**
 * Agent-presets settings section: the roster as cards, the default, and a
 * read-only viewer over the shipped compositions.
 *
 * A deployment declares its presets in its own composition files, outside this
 * page, so the browser creates none and edits no composition text. Deleting a
 * preset is likewise a file change elsewhere; sessions already composed from
 * one keep running, because a composition is mounted once at session creation
 * and nothing re-reads the file.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconBrowseOutlineMedium, IconPlusOutlineMedium, Modal, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentPresetSectionState } from './section-store.ts'
import { isBuiltInPreset, presetDisplayText } from './locales.ts'
import css from './AgentPresetSection.module.css'

/** Registration-side business face for the management section. */
export interface AgentPresetSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useAgentPresetSection. */
    agentPresetSection: SnapshotStore<AgentPresetSectionState>
  }
  /** Read the roster; called once when the section first renders. */
  load: () => Promise<void>
  /** Open one shipped preset's composition in the read-only viewer. */
  view: (id: string) => Promise<void>
  /** Close the read-only viewer. */
  closeView: () => void
  /**
   * Stage the self-referential preset and start a new session on it — the
   * conversational way to author a preset. Absent when the surface is
   * composed without the conversation flow to land the session in.
   */
  startCreatorDraft?: () => void
  /** Make one preset the default for sessions created later. */
  makeDefault: (id: string) => Promise<void>
}

/** Full component props. */
export type AgentPresetSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSectionInjected>

/**
 * Render one card's description, clamped by CSS and offered in full on hover.
 * The tooltip is attached only while the text is actually cut off, so a short
 * description does not answer a hover with a bubble repeating the card.
 * @param props.text - the description as rendered, already localized.
 * @returns the description element, tooltip-anchored while it overflows.
 */
function CardDescription({ text }: { text: string }): ReactNode {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    /* v8 ignore next -- the ref is attached before layout effects run. */
    if (el === null) return
    const measure = () => { setTruncated(el.scrollHeight > el.clientHeight) }
    measure()
    // Card width follows the settings pane, which resizes with the window.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [text])
  return (
    // Capped near the card's own width: the default half-viewport bubble would
    // spill a description out of the settings dialog and across the app behind it.
    <Tooltip label={text} side="bottom" delayMs={400} disabled={!truncated} maxWidth={360}>
      {/* The empty title stops the card body's native tooltip from climbing to
        this span: a cut-off description answers with one bubble, not two. */}
      <span ref={ref} className={css.cardDesc} title="">{text}</span>
    </Tooltip>
  )
}

/**
 * Render the Agent presets section content column.
 * @param props - composed slot props.
 * @returns the section, or null when the deployment composes no presets.
 */
export function AgentPresetSection(props: AgentPresetSectionProps): ReactNode {
  const { useAgentPresetSection, t, load } = props
  const state = useAgentPresetSection(snapshot => snapshot)
  const viewedId = state.view?.id
  const viewedRow = viewedId === undefined ? undefined : state.rows.find(row => row.id === viewedId)
  const viewedTitle = state.view === null
    ? ''
    : viewedRow === undefined ? state.view.title : presetDisplayText(viewedRow, t).name

  useEffect(() => {
    void load()
  }, [load])

  // A deployment that composes no presets has nothing to manage: every
  // session shares the host composition and the page would be an empty list.
  if (state.status === 'unavailable') return null
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const detail = state.error ?? ''
    return (
      <div className={css.section}>
        <p className={css.error} role="alert">{`${t('error')} ${detail}`}</p>
        <button type="button" className={css.secondaryButton} onClick={() => { void load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  /* The self-referential preset can read this very composition and author a
     new one in conversation. Offered only where that preset is actually on
     the roster and a session can be landed. */
  const creatorButton = props.startCreatorDraft !== undefined && state.rows.some(row => row.id === 'cordis')
    ? (
      <button
        type="button"
        className={css.creatorButton}
        onClick={() => {
          props.startCreatorDraft?.()
          props.close()
        }}
      >
        <IconPlusOutlineMedium size={14} />
        {t('creatorDraft')}
      </button>
    )
    : null

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('nav')}</h2>
      <p className={css.intro}>{t('sectionIntro')}</p>
      {state.error === null ? null : <p className={css.error} role="alert">{state.error}</p>}
      {([true, false] as const).map((builtIn) => {
        const heading = builtIn ? t('builtInGroup') : t('customGroup')
        const group = state.rows
          .filter(row => isBuiltInPreset(row) === builtIn)
          .map(row => ({ row, text: presetDisplayText(row, t) }))
        // The custom group is where a preset of one's own will appear, so it
        // stays on screen even while empty: heading plus the creator entry.
        const tail = builtIn ? null : creatorButton
        if (group.length === 0 && tail === null) return null
        return (
          <section key={String(builtIn)} className={css.group}>
            <h3 className={css.groupHead}>{heading}</h3>
            {group.length === 0 ? null : (
              <ul className={css.cards}>
                {group.map(({ row, text }) => (
                  <li
                    key={row.id}
                    className={row.broken !== undefined
                      ? `${css.card} ${css.cardBroken}`
                      : row.isDefault ? `${css.card} ${css.cardActive}` : css.card}
                  >
                    {/* The card body IS the control: picking a preset is the
                      common act, so it should not hide behind a small button.
                      The action row sits outside it — nesting buttons is
                      invalid, and these act on the card rather than select it.
                      A broken preset cannot compose a session, so its body
                      refuses the pick; the reason rides the badge rather than
                      the card face, which stays the preset's own
                      description. */}
                    <button
                      type="button"
                      className={css.cardMain}
                      aria-pressed={row.isDefault}
                      // Broken says so through `aria-disabled` rather than
                      // `disabled`, which would take the card out of the tab
                      // order. With the reason moved onto the badge, that is
                      // the only way anyone without a pointer reaches it.
                      disabled={row.isDefault}
                      aria-disabled={row.broken !== undefined}
                      // Without this the name is the whole card read aloud —
                      // title, badge, description, id.
                      aria-label={`${row.broken !== undefined ? t('brokenBadge') : row.isDefault ? t('inUse') : t('setDefault')}: ${text.name}`}
                      // The reason rides the badge, not the whole card: two
                      // tooltips over one target would race, and the card's
                      // own label answers what clicking it would do.
                      title={row.broken !== undefined ? t('brokenBadge') : row.isDefault ? t('inUse') : t('setDefault')}
                      onClick={() => {
                        if (row.broken !== undefined) return
                        void props.makeDefault(row.id)
                      }}
                    >
                      <span className={css.cardHead}>
                        <span className={css.cardName}>{text.name}</span>
                        {row.broken !== undefined
                          ? (
                            <span className={css.brokenBadge}>
                              {t('brokenBadge')}
                              {/* Pointer-only, hence `aria-hidden`: the same
                                reason reaches assistive technology through the
                                alert below, and a second copy inside the card's
                                own text would be read out twice. */}
                              <span className={css.brokenTip} aria-hidden="true">{row.broken}</span>
                            </span>
                          )
                          : null}
                        <Tag>
                          {builtIn ? t('builtIn') : t('userTrust')}
                        </Tag>
                        {row.isDefault ? <Tag tone="solid" className={css.inUse}>{t('inUse')}</Tag> : null}
                      </span>
                      <CardDescription text={text.description ?? t('noDescription')} />
                      {/* Visually hidden, deliberately: the pointer path is the
                        badge's tooltip, and a disabled card body is out of the
                        tab order, so this is the only reading a screen reader
                        or a keyboard-only user gets. */}
                      {row.broken === undefined
                        ? null
                        : <span className={css.cardBrokenReason} role="alert">{row.broken}</span>}
                      <code className={css.cardId}>{row.id}</code>
                    </button>
                    <div className={css.cardFoot}>
                      {/* A deployment's own preset is the composition this
                        page can show; a preset that names itself is declared
                        outside it, and the viewer is withheld for a broken
                        row, which has no readable composition to offer. */}
                      {builtIn && row.broken === undefined
                        ? (
                          <button
                            type="button"
                            className={css.iconButton}
                            data-tip={t('view')}
                            aria-label={`${t('view')}: ${text.name}`}
                            onClick={() => { void props.view(row.id) }}
                          >
                            <IconBrowseOutlineMedium />
                          </button>
                        )
                        : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {tail}
          </section>
        )
      })}
      <Modal
        open={state.view !== null}
        onClose={() => { props.closeView() }}
        title={state.view === null ? '' : `${t('view')} · ${viewedTitle}`}
        closeLabel={t('close')}
        description={t('composition')}
        className={css.dialog as string}
        footer={(
          <Button variant="outline" autoFocus onClick={() => { props.closeView() }}>
            {t('close')}
          </Button>
        )}
      >
        {state.view === null
          ? null
          : <pre className={css.viewerCode}>{state.view.content}</pre>}
      </Modal>
    </div>
  )
}
