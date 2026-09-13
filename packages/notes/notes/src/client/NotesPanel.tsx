/**
 * The notes panel: the conversations the Host recorded, the materials of the
 * one it shows, and the detail of the material the reader opened.
 *
 * Two columns while the panel is wide enough for both, and one at a time below
 * that — the list, or the open material with a way back. The switch is a
 * container query over the panel's own width, so the panel follows its pane
 * rather than the window.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { IconPlusOutline16, IconRefreshOutline16, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { NotesSessionSummary, NoteSessionId } from '../types.ts'
import { failureLine } from './failure-line.ts'
import type { NotesInjected } from './face.ts'
import { MaterialDetail } from './MaterialDetail.tsx'
import { MaterialList } from './MaterialList.tsx'
import { NotesSettingsCard } from './NotesSettingsCard.tsx'
import type { NotesStore } from './store.ts'
import css from './NotesPanel.module.css'

/** Which command one entry of the conversation menu asks for. */
export interface SessionIntent {
  /** `open` shows a listed conversation; `restore` brings an archived one back. */
  readonly kind: 'open' | 'restore'
  /** The conversation the entry names. */
  readonly id: NoteSessionId
}

/**
 * What picking one conversation-menu entry means.
 *
 * The menu reports its entry ids as plain strings, so the mapping back to a
 * conversation is here rather than in the component: an id the Host no longer
 * lists asks for nothing.
 * @param id - the entry the reader picked.
 * @param listed - the conversations the Host lists.
 * @param archived - the archived conversations the Host lists.
 * @returns the command to run, or null when the entry names neither.
 */
export function sessionIntent(
  id: string,
  listed: readonly NotesSessionSummary[],
  archived: readonly NotesSessionSummary[],
): SessionIntent | null {
  const open = listed.find(session => session.id === id)
  if (open !== undefined) return { kind: 'open', id: open.id }
  const restore = archived.find(session => session.id === id)
  if (restore !== undefined) return { kind: 'restore', id: restore.id }
  return null
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
  useStore, useTabInfo, load, refresh, createConversation, openSession, archiveSession,
  restoreSession, select, saveText, analyze, ask, archive, restore, reorder, present,
  readSettings, saveSettings, remove, t,
}: NotesPanelProps): ReactNode {
  const state = useStore(value => value)
  const { tab, panel } = useTabInfo()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    load()
  }, [load])
  const commands: NotesInjected = {
    load, refresh, createConversation, openSession, archiveSession, restoreSession,
    select, saveText, analyze, ask, archive, restore, reorder, present,
    readSettings, saveSettings, remove,
  }
  const active = state.sessions.find(session => session.id === state.activeId)
  const selected = state.materials.find(row => row.id === state.selected)
  const sessions = [
    ...state.sessions.map(session => ({ session, archived: false })),
    ...state.archived.map(session => ({ session, archived: true })),
  ]
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
        {selected === undefined && active !== undefined && (
          <Menu
            open={historyOpen}
            anchor={(
              <button
                type="button"
                className={css.conversation}
                aria-haspopup="menu"
                data-notes-history
                onClick={() => { setHistoryOpen(open => !open) }}
              >
                {active.title}
                <span className={css.caret} aria-hidden>▾</span>
              </button>
            )}
            items={sessions.map(({ session, archived }) => ({
              id: session.id,
              label: archived ? t('panel.archivedItem', { title: session.title }) : session.title,
            }))}
            selectedId={active.id}
            onSelect={(id) => {
              setHistoryOpen(false)
              const intent = sessionIntent(id, state.sessions, state.archived)
              /* v8 ignore next -- the menu offers the ids this listing just built. */
              if (intent === null) return
              if (intent.kind === 'restore') restoreSession(intent.id)
              else openSession(intent.id)
            }}
            onClose={() => { setHistoryOpen(false) }}
            align="start"
            dense
          />
        )}
        {selected !== undefined && <span className={css.title} data-notes-title>{t('detail.title')}</span>}
        {selected === undefined && active === undefined && (
          <span className={css.title} data-notes-title>{t('tab.title')}</span>
        )}
        {active !== undefined && selected === undefined && (
          <span className={css.count}>{t('panel.materials', { count: state.materials.length })}</span>
        )}
        <span className={css.spacer} />
        {active !== undefined && selected === undefined && (
          <Tooltip label={t('panel.archiveSession')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.tool}
              aria-label={t('panel.archiveSession')}
              data-notes-archive-session
              onClick={() => { archiveSession(active.id) }}
            >
              {t('panel.archive')}
            </button>
          </Tooltip>
        )}
        {selected === undefined && (
          <Tooltip label={t('panel.create')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.tool}
              aria-label={t('panel.create')}
              data-notes-new
              onClick={createConversation}
            >
              <IconPlusOutline16 size={14} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={panel.floating ? t('panel.dock') : t('panel.float')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={panel.floating ? t('panel.dock') : t('panel.float')}
            data-notes-present={panel.floating ? 'dock' : 'float'}
            onClick={() => { present(tab.id, panel.id, panel.floating) }}
          >
            {panel.floating ? t('panel.dock') : t('panel.float')}
          </button>
        </Tooltip>
        <Tooltip label={t('panel.settings')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('panel.settings')}
            data-notes-settings-open
            onClick={() => {
              setSettingsOpen(true)
              readSettings()
            }}
          >
            {t('panel.settings')}
          </button>
        </Tooltip>
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
            <MaterialList
              materials={state.materials}
              archived={state.archivedMaterials}
              selected={state.selected}
              commands={commands}
              t={t}
            />
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
      {settingsOpen && (
        <NotesSettingsCard
          settings={state.settings}
          loading={state.settingsLoading}
          failure={state.settingsFailure}
          commands={commands}
          t={t}
          close={() => { setSettingsOpen(false) }}
        />
      )}
    </div>
  )
}
