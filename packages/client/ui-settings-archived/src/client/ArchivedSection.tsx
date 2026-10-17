/**
 * Archived conversations settings section: workspace groups, one row per
 * archived session with its archive date, details and restore actions, the
 * details modal, and the delete confirmation.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconInfoOutlineMedium, IconRefreshOutlineMedium, IconTrashOutlineMedium, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { countDescendants, deriveArchivedGroups, UNGROUPED_KEY } from './derive.ts'
import type { ArchivedRow } from './derive.ts'
import css from './ArchivedSection.module.css'

export interface ArchivedSectionInjected {
  restore(sessionId: SessionId): Promise<boolean>
  remove(sessionId: SessionId): Promise<void>
  refresh(): Promise<void>
}

export type ArchivedSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.archived'>
  & InjectFace<ArchivedSectionInjected>

interface DetailTarget {
  row: ArchivedRow
  groupTitle: string
}

type Translate = TranslateNS<'settings.archived'>

/**
 * Absolute archive/activity date through the dictionary's date template (the
 * message clock pattern): `toLocaleString` would follow the browser language,
 * not the app locale, and produce mixed-language text after a switch. An
 * unparseable instant renders a language-neutral dash rather than NaN text.
 */
function formatDate(value: string | number, t: Translate): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return t('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
}

/** {@link formatDate} plus the local HH:MM clock for the details dialog. */
function formatInstant(value: string | number, t: Translate): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  return `${formatDate(value, t)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Confirmation copy naming the subagent conversations a recursive delete removes. */
function confirmBody(row: ArchivedRow, descendants: number, t: Translate): string {
  return descendants === 0
    ? t('confirm.bodyNoDescendants', { title: row.title })
    : t('confirm.bodyWithDescendants', { title: row.title, count: String(descendants) })
}

export function ArchivedSection(props: ArchivedSectionProps): ReactNode {
  const { useSessions, useWorkspaces, close, t } = props
  const restore = (sessionId: SessionId): Promise<boolean> => props.restore(sessionId)
  const remove = (sessionId: SessionId): Promise<void> => props.remove(sessionId)
  const refresh = (): Promise<void> => props.refresh()
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const [busy, setBusy] = useState<ReadonlySet<SessionId>>(new Set())
  const [detail, setDetail] = useState<DetailTarget | undefined>(undefined)
  const [pendingDelete, setPendingDelete] = useState<DetailTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined)
  const [restoreErrors, setRestoreErrors] = useState<Readonly<Record<string, string>>>({})

  const groups = useMemo(
    () => deriveArchivedGroups(sessions, workspaces),
    [sessions, workspaces],
  )
  const loading = sessions.phase !== 'ready' || workspaces.phase !== 'ready'

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

  const onDelete = async (id: SessionId): Promise<void> => {
    setDeleting(true)
    setDeleteError(undefined)
    markBusy(id, true)
    try {
      await remove(id)
      setPendingDelete(undefined)
    } catch (error) {
      // A refused deletion keeps the confirmation open with its reason, so the
      // user can retry or cancel without reopening the dialog.
      setDeleteError(error instanceof Error ? error.message : String(error))
    } finally {
      setDeleting(false)
      markBusy(id, false)
    }
  }

  const closeConfirm = (): void => {
    if (deleting) return
    setPendingDelete(undefined)
    setDeleteError(undefined)
  }

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
                {groups.map((group) => {
                  const groupTitle = group.key === UNGROUPED_KEY ? t('group.ungrouped') : group.title
                  return (
                    <section key={group.key} aria-labelledby={`archived-group-${group.key}`}>
                      <h3 id={`archived-group-${group.key}`} className={css.groupTitle}>
                        {groupTitle}
                        <span className={css.count}>{String(group.rows.length)}</span>
                      </h3>
                      <ul className={css.list}>
                        {group.rows.map(row => (
                          <li key={row.id} className={css.row}>
                            <span className={css.rowMain}>
                              <span className={css.rowTitle} title={row.title}>{row.title}</span>
                              <span className={css.archivedAt}>
                                {row.archivedAt === undefined
                                  ? t('row.archivedAtUnknown')
                                  : t('row.archivedAt', { date: formatDate(row.archivedAt, t) })}
                              </span>
                            </span>
                            {row.running ? <span className={css.running}>{t('row.running')}</span> : null}
                            <span className={css.actions}>
                              <Tooltip label={t('row.details', { name: row.title })}>
                                <span className={css.actionAnchor}>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label={t('row.details', { name: row.title })}
                                    onClick={() => { setDetail({ row, groupTitle }) }}
                                  >
                                    <IconInfoOutlineMedium />
                                  </Button>
                                </span>
                              </Tooltip>
                              <Tooltip label={t('row.restore').replace('{name}', row.title)}>
                                <span className={css.actionAnchor}>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label={t('row.restore').replace('{name}', row.title)}
                                    disabled={busy.has(row.id)}
                                    onClick={() => { void onRestore(row.id) }}
                                  >
                                    <IconRefreshOutlineMedium />
                                  </Button>
                                </span>
                              </Tooltip>
                              <Tooltip label={row.running
                                ? t('row.deleteDisabled')
                                : t('row.delete', { name: row.title })}
                              >
                                <span className={css.actionAnchor}>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label={t('row.delete', { name: row.title })}
                                    disabled={busy.has(row.id) || row.running}
                                    onClick={() => { setPendingDelete({ row, groupTitle }) }}
                                  >
                                    <IconTrashOutlineMedium />
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
                  )
                })}
              </div>
            )}
      <Modal
        open={detail !== undefined}
        title={t('details.title')}
        closeLabel={t('details.close')}
        onClose={() => { setDetail(undefined) }}
      >
        {detail === undefined
          ? null
          : (
            <dl className={css.details}>
              <dt>{t('details.group')}</dt>
              <dd>{detail.groupTitle}</dd>
              {detail.row.cwd === undefined
                ? null
                : (
                  <>
                    <dt>{t('details.cwd')}</dt>
                    <dd>{detail.row.cwd}</dd>
                  </>
                )}
              {detail.row.agentPreset === undefined
                ? null
                : (
                  <>
                    <dt>{t('details.agentPreset')}</dt>
                    <dd>{detail.row.agentPreset}</dd>
                  </>
                )}
              <dt>{t('details.archivedAt')}</dt>
              <dd>{detail.row.archivedAt === undefined
                ? t('row.archivedAtUnknown')
                : formatInstant(detail.row.archivedAt, t)}
              </dd>
              <dt>{t('details.updatedAt')}</dt>
              <dd>{detail.row.updatedAt > 0 ? formatInstant(detail.row.updatedAt, t) : '—'}</dd>
              <dt>{t('details.status')}</dt>
              <dd>{detail.row.running ? t('row.running') : t('details.statusIdle')}</dd>
              <dt>{t('details.descendants')}</dt>
              <dd>{String(descendantCounts(detail.row.id))}</dd>
              <dt>{t('details.id')}</dt>
              <dd>{detail.row.id}</dd>
            </dl>
          )}
      </Modal>
      <Modal
        open={pendingDelete !== undefined}
        title={t('confirm.title')}
        closeLabel={t('confirm.cancel')}
        onClose={closeConfirm}
        footer={pendingDelete === undefined
          ? null
          : (
            <div className={css.confirmActions}>
              <Button
                variant="outline"
                disabled={deleting}
                onClick={closeConfirm}
              >
                {t('confirm.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={deleting}
                onClick={() => { void onDelete(pendingDelete.row.id) }}
              >
                {t('confirm.confirm')}
              </Button>
            </div>
          )}
      >
        {pendingDelete === undefined
          ? null
          : (
            <>
              <p className={css.confirmBody}>
                {confirmBody(pendingDelete.row, descendantCounts(pendingDelete.row.id), t)}
              </p>
              {deleteError === undefined
                ? null
                : <p className={css.error} role="alert">{deleteError}</p>}
            </>
          )}
      </Modal>
    </div>
  )
}
