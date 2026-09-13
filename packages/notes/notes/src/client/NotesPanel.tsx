/**
 * The notes panel: the conversations the Host recorded, and the materials of
 * the one it shows.
 *
 * A skeleton in the literal sense — it reads, reports, and starts a
 * conversation, and the material list it draws is one line per row. The
 * two-column layout, the per-row state, and the detail pane are the next
 * pieces; nothing here has to move for them.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { MaterialView, NotesMaterialSummary } from '../types.ts'
import { failureLine } from './failure-line.ts'
import type { NotesInjected } from './face.ts'
import type { NotesKey } from './locales.ts'
import type { NotesStore } from './store.ts'
import css from './NotesPanel.module.css'

/** The dictionary line for each collection view. */
const VIEW_LINES: Readonly<Record<MaterialView, NotesKey>> = {
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
export function NotesPanel({ useStore, load, refresh, createConversation, t }: NotesPanelProps): ReactNode {
  const state = useStore(value => value)
  useEffect(() => {
    load()
  }, [load])
  const active = state.sessions.find(session => session.id === state.activeId)
  return (
    <div className={css.panel} data-notes-panel data-notes-loading={state.loading ? '' : undefined}>
      <div className={css.bar}>
        <span className={css.title} data-notes-title>{active?.title ?? t('tab.title')}</span>
        {active !== undefined && (
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
        {state.failure === undefined && active === undefined && (
          <div className={css.empty} data-notes-empty>
            <p className={css.emptyLine}>{t('panel.empty')}</p>
            <button type="button" className={css.create} data-notes-create onClick={createConversation}>
              {t('panel.create')}
            </button>
          </div>
        )}
        {state.failure === undefined && active !== undefined && (
          state.materials.length === 0
            ? <p className={css.emptyLine} data-notes-no-materials>{t('panel.noMaterials')}</p>
            : (
              <ul className={css.materials} data-notes-materials>
                {state.materials.map(row => <MaterialRow key={row.id} material={row} t={t} />)}
              </ul>
            )
        )}
        {state.loading && <p className={css.loading} data-notes-reading>{t('panel.loading')}</p>}
      </div>
    </div>
  )
}

/** One material as the list draws it before the detail pane exists. */
function MaterialRow(
  { material, t }: { readonly material: NotesMaterialSummary; readonly t: NotesPanelProps['t'] },
): ReactNode {
  return (
    <li className={css.material} data-notes-material={material.id} data-notes-status={material.status}>
      <span className={css.materialText}>{material.text ?? t('source.image')}</span>
      <span className={css.materialSource}>
        {material.kind === 'image' ? t('source.image') : t(VIEW_LINES[material.source.view])}
      </span>
    </li>
  )
}
