/**
 * The notes panel: the conversations the Host recorded, the materials of the
 * one it shows, and the detail of the material the reader opened.
 *
 * Two columns while the panel is wide enough for both, and one at a time below
 * that — the list, or the open material with a way back. The switch is a
 * container query over the panel's own width, so the panel follows its pane
 * rather than the window.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { NotesMaterialSummary } from '../types.ts'
import { failureLine } from './failure-line.ts'
import type { NotesInjected } from './face.ts'
import type { NotesKey } from './locales.ts'
import { MaterialDetail } from './MaterialDetail.tsx'
import type { NotesStore } from './store.ts'
import css from './NotesPanel.module.css'

/** The dictionary line for each collection view. */
const VIEW_LINES: Readonly<Record<NotesMaterialSummary['source']['view'], NotesKey>> = {
  chat: 'source.chat',
  trajectory: 'source.trajectory',
}

/** The panel's props: its tab, the shared store and commands, and copy. */
export type NotesPanelProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<NotesStore>
  & InjectFace<NotesInjected>
  & PropsLocale<'notes'>

/**
 * The notes tab's body, registered under `sidebar.right.pane.tab` as `notes`.
 * @param props - composed slot props.
 * @returns the panel, or the reason it has nothing to show.
 */
export function NotesPanel({
  useStore, load, refresh, createConversation, select, saveText, analyze, ask, archive, remove, t,
}: NotesPanelProps): ReactNode {
  const state = useStore(value => value)
  useEffect(() => {
    load()
  }, [load])
  const commands: NotesInjected = { load, refresh, createConversation, select, saveText, analyze, ask, archive, remove }
  const active = state.sessions.find(session => session.id === state.activeId)
  const selected = state.materials.find(row => row.id === state.selected)
  return (
    <div
      className={css.panel}
      data-notes-panel
      data-notes-selected={selected === undefined ? undefined : ''}
      data-notes-loading={state.loading ? '' : undefined}
    >
      <div className={css.bar}>
        {selected !== undefined && (
          <button
            type="button"
            className={css.back}
            aria-label={t('detail.back')}
            data-notes-back
            onClick={() => { select(null) }}
          >
            ←
          </button>
        )}
        <span className={css.title} data-notes-title>
          {selected === undefined ? active?.title ?? t('tab.title') : t('detail.title')}
        </span>
        {active !== undefined && selected === undefined && (
          <span className={css.count}>{t('panel.materials', { count: state.materials.length })}</span>
        )}
        <Tooltip label={t('panel.refresh')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('panel.refresh')}
            data-notes-refresh
            onClick={refresh}
          >
            <IconRefreshOutline16 size={14} />
          </button>
        </Tooltip>
      </div>
      <div className={css.body}>
        {state.failure !== undefined && (
          <p className={css.failure} data-notes-failure={state.failure.code}>
            {failureLine(t, state.failure)}
          </p>
        )}
        {state.failure === undefined && state.notice !== undefined && (
          <p className={css.notice} data-notes-notice={state.notice.code}>
            {failureLine(t, state.notice)}
          </p>
        )}
        {state.failure === undefined && active === undefined && (
          <div className={css.empty} data-notes-empty>
            <p className={css.emptyLine}>{t('panel.empty')}</p>
            <button type="button" className={css.create} data-notes-create onClick={createConversation}>
              {t('panel.create')}
            </button>
          </div>
        )}
        {state.failure === undefined && active !== undefined && (
          <div className={css.columns}>
            <ul className={css.list} data-notes-materials>
              {state.materials.map(row => (
                <MaterialRow key={row.id} material={row} open={row.id === state.selected} select={select} t={t} />
              ))}
              {state.materials.length === 0 && (
                <li className={css.emptyLine} data-notes-no-materials>{t('panel.noMaterials')}</li>
              )}
            </ul>
            {selected !== undefined && (
              <MaterialDetail
                material={selected}
                thread={state.thread}
                threadLoading={state.threadLoading}
                threadFailure={state.threadFailure}
                commands={commands}
                t={t}
              />
            )}
          </div>
        )}
        {state.loading && <p className={css.loading} data-notes-reading>{t('panel.loading')}</p>}
      </div>
    </div>
  )
}

/** One material as the list draws it: its state, its first line, and its source. */
function MaterialRow(
  { material, open, select, t }: {
    readonly material: NotesMaterialSummary
    readonly open: boolean
    readonly select: (id: NotesMaterialSummary['id'] | null) => void
    readonly t: NotesPanelProps['t']
  },
): ReactNode {
  return (
    <li
      className={css.row}
      data-notes-material={material.id}
      data-notes-status={material.status}
      data-notes-open={open ? '' : undefined}
    >
      <button
        type="button"
        className={css.rowButton}
        aria-current={open}
        data-notes-select={material.id}
        onClick={() => { select(material.id) }}
      >
        <span className={css.dot} data-notes-dot={material.status} />
        <span className={css.rowText}>
          <span className={css.rowTitle}>{material.source.label}</span>
          <span className={css.rowPreview}>{material.text ?? t('source.image')}</span>
        </span>
        <span className={css.rowSource}>
          {material.kind === 'image' ? t('source.image') : t(VIEW_LINES[material.source.view])}
        </span>
      </button>
    </li>
  )
}
