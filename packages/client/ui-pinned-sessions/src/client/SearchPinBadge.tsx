import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createPinnedSessionsStore } from './stores.ts'
import css from './SearchPinBadge.module.css'

export function SearchPinBadge({
  sessionId, useStore, t,
}: PropsRuntime<'sidebar.workspaces.searchResultExtra'>
  & PropsStore<ReturnType<typeof createPinnedSessionsStore>>
  & PropsLocale<'sessionPins'>) {
  const ready = useStore(s => s.ready)
  const snapshot = useStore(s => s.snapshot)
  if (!ready || !snapshot.pinnedSessionIds.includes(sessionId)) return null
  return (
    <span className={css.searchPinBadge} aria-label={t('pinnedBadge')}>
      <svg className={css.pinIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 3l5 5-3.5 3.5L19 16l-3 1-5-5-4.5 4.5L5 15l6-6-5-5 1-3 4.5 1.5L16 3z" />
      </svg>
    </span>
  )
}
