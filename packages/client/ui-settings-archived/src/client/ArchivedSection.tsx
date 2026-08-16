/**
 * Archived conversations settings section: workspace groups, one row per
 * archived session, restore-first and delete-second actions, and the
 * delete confirmation modal.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconCloseFill14, IconRefreshOutline16, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { countDescendants, deriveArchivedGroups, UNGROUPED_KEY } from './derive.ts'
import css from './ArchivedSection.module.css'

export interface ArchivedSectionInjected {
  restore(sessionId: SessionId): Promise<boolean>
  deleteSession(sessionId: SessionId): Promise<void>
  refresh(): Promise<void>
}

export type ArchivedSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.archived'>
  & InjectFace<ArchivedSectionInjected>

interface DeleteTarget {
  sessionId: SessionId
  title: string
  descendantCount: number
}

export function ArchivedSection(props: ArchivedSectionProps): ReactNode {
  const { useSessions, useWorkspaces, close, t } = props
  const restore = (sessionId: SessionId): Promise<boolean> => props.restore(sessionId)
  const deleteSession = (sessionId: SessionId): Promise<void> => props.deleteSession(sessionId)
  const refresh = (): Promise<void> => props.refresh()
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const [busy, setBusy] = useState<ReadonlySet<SessionId>>(new Set())
  const [target, setTarget] = useState<DeleteTarget | undefined>(undefined)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [restoreErrors, setRestoreErrors] = useState<Readonly<Record<string, string>>>({})

  const groups = useMemo(
    () => deriveArchivedGroups(sessions, workspaces),
    [sessions, workspaces],
  )
  const loading = sessions.phase !== 'ready' || !workspaces.baselinesReady

  const descendantCounts = useMemo(
    () => (id: SessionId): number => countDescendants(sessions, id),
    [sessions],
  )

  const markBusy = (id: SessionId, busyNow: boolean): void => {
    setBusy((current) => {
      const next = new Set(current)
      if (busyNow) next.add(id); else next.delete(id)
      return next
    })
  }

  const onRestore = async (id: SessionId): Promise<void> => {
    markBusy(id, true)
    try {
      const opened = await restore(id)
      setRestoreErrors((current) => {
        if (!(id in current)) return current
        return Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== id),
        )
      })
      if (opened) close()
    } catch (error) {
      setRestoreErrors(current => ({
        ...current,
        [id]: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      markBusy(id, false)
    }
  }

  const openDelete = (row: { id: SessionId; title: string }): void => {
    setDeleteError(null)
    setTarget({ sessionId: row.id, title: row.title, descendantCount: descendantCounts(row.id) })
  }

  const onDelete = async (): Promise<void> => {
    if (target === undefined || busy.has(target.sessionId)) return
    setDeleteError(null)
    markBusy(target.sessionId, true)
    try {
      await deleteSession(target.sessionId)
      setTarget(undefined)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      markBusy(target.sessionId, false)
    }
  }

  const confirmBusy = target !== undefined && busy.has(target.sessionId)
  const confirmTitle = t('confirm.title')
  const confirmDescription = target === undefined
    ? ''
    : target.descendantCount > 0
      ? t('confirm.bodyWithDescendants')
        .replace('{title}', target.title)
        .replace('{count}', String(target.descendantCount))
      : t('confirm.bodyNoDescendants').replace('{title}', target.title)

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {loading
        ? <p className={css.status}>{t('loading')}</p>
        : workspaces.state === 'error'
          ? (
            <div role="alert">
              <p>{t('loadFailed')}: {workspaces.error?.message ?? ''}</p>
              <Button variant="outline" onClick={() => { void refresh() }}>{t('retry')}</Button>
            </div>
          )
          : groups.length === 0
            ? <p className={css.empty}>{t('empty')}</p>
            : (
              <div aria-live="polite">
                {groups.map(group => (
                  <section key={group.key} aria-labelledby={`archived-group-${group.key}`}>
                    <h3 id={`archived-group-${group.key}`} className={css.groupTitle}>
                      {group.key === UNGROUPED_KEY ? t('group.ungrouped') : group.title}
                      <span className={css.count}>{String(group.rows.length)}</span>
                    </h3>
                    <ul className={css.list}>
                      {group.rows.map(row => (
                        <li key={row.id} className={css.row}>
                          <span className={css.rowTitle} title={row.title}>{row.title}</span>
                          {row.running ? <span className={css.running}>{t('row.running')}</span> : null}
                          <span className={css.actions}>
                            <Tooltip label={t('row.restore').replace('{name}', row.title)}>
                              <span className={css.actionAnchor}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  aria-label={t('row.restore').replace('{name}', row.title)}
                                  disabled={busy.has(row.id)}
                                  onClick={() => { void onRestore(row.id) }}
                                >
                                  <IconRefreshOutline16 />
                                </Button>
                              </span>
                            </Tooltip>
                            <Tooltip label={row.running ? t('row.runningDeleteDisabled') : t('row.delete').replace('{name}', row.title)}>
                              <span className={css.actionAnchor}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className={css.deleteButton}
                                  aria-label={t('row.delete').replace('{name}', row.title)}
                                  aria-disabled={row.running || busy.has(row.id)}
                                  disabled={row.running || busy.has(row.id)}
                                  onClick={() => { openDelete(row) }}
                                >
                                  <IconCloseFill14 />
                                </Button>
                              </span>
                            </Tooltip>
                          </span>
                          {restoreErrors[row.id] === undefined
                            ? null
                            : <p className={css.error} role="alert">{restoreErrors[row.id]}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
      <Modal
        open={target !== undefined}
        title={confirmTitle}
        closeLabel={t('confirm.cancel')}
        description={confirmDescription}
        onClose={() => { if (!confirmBusy) setTarget(undefined) }}
        footer={(
          <>
            <Button variant="outline" disabled={confirmBusy} onClick={() => { setTarget(undefined) }}>
              {t('confirm.cancel')}
            </Button>
            <Button variant="primary" className={css.dangerButton} disabled={confirmBusy} onClick={() => { void onDelete() }}>
              {t('confirm.delete')}
            </Button>
          </>
        )}
      >
        {deleteError === null ? null : <p className={css.error} role="alert">{deleteError}</p>}
      </Modal>
    </div>
  )
}
