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
        <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
      </svg>
    </span>
  )
}
