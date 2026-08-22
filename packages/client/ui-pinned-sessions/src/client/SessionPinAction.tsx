import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionPinInjected } from './index.ts'
import type { createPinnedSessionsStore } from './stores.ts'
import css from './SessionPinAction.module.css'

export function SessionPinAction({
  sessionId, blank, useStore, setPinned, t,
}: PropsRuntime<'sidebar.workspaces.sessionActions'>
  & PropsStore<ReturnType<typeof createPinnedSessionsStore>>
  & SessionPinInjected
  & PropsLocale<'sessionPins'>) {
  const ready = useStore(s => s.ready)
  const snapshot = useStore(s => s.snapshot)
  if (blank || !ready) return null
  const pinned = snapshot.pinnedSessionIds.includes(sessionId)
  return (
    <button
      type="button"
      className={clsx(css.pinButton, pinned && css.pinOn)}
      aria-label={pinned ? t('unpin') : t('pin')}
      onClick={(event) => {
        event.stopPropagation()
        void setPinned(sessionId, !pinned, snapshot)
      }}
    >
      <svg className={css.pinIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
      </svg>
    </button>
  )
}
