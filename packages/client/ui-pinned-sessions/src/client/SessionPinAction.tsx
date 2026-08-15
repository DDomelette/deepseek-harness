import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { PinnedSessionsInjected } from './index.ts'
import type { createPinnedSessionsStore } from './stores.ts'
import css from './SessionPinAction.module.css'

export function SessionPinAction({
  sessionId, blank, useStore, setPinned, t,
}: PropsRuntime<'sidebar.workspaces.sessionActions'>
  & PropsStore<ReturnType<typeof createPinnedSessionsStore>>
  & PinnedSessionsInjected
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
        <path d="M16 3l5 5-3.5 3.5L19 16l-3 1-5-5-4.5 4.5L5 15l6-6-5-5 1-3 4.5 1.5L16 3z" />
      </svg>
    </button>
  )
}
