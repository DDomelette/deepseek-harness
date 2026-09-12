/**
 * The screen a non-loopback browser sees when the Host served it the shell
 * without accepting a session — a device that was revoked, or one that never
 * paired. Its own cookie is the only LAN credential, so the screen states that
 * the computer has to create a new pairing code.
 */
// Type-only: pulls the frame's slot declarations (shell.overlay).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AuthRequiredScreen.module.css'

/** Injected face: the reload that picks up a device cookie earned meanwhile. */
export interface AuthRequiredScreenInjected {
  /** Reload this page, so a device cookie obtained since it was served authenticates it. */
  reload: () => void
}

/** Composed props: the overlay seat's runtime share, the pairing dictionary, and the injected face. */
export type AuthRequiredScreenProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<'pair.mobile'>
  & AuthRequiredScreenInjected

/**
 * Read the auth-required boot fact, written by `@deepseek-ai/dsh-host-frontend-static`.
 * @returns true only on a shell this Host served without accepting a session.
 */
export function authRequiredBootFact(): boolean {
  return Reflect.get(globalThis, '__DSH_AUTH_REQUIRED__') === true
}

/**
 * Render the session-required screen.
 * @param props - composed slot props and the injected reload.
 * @returns the screen element tree.
 */
export function AuthRequiredScreen({ t, reload }: AuthRequiredScreenProps) {
  return (
    <div className={css.screen} data-auth-required-screen>
      <div className={css.card}>
        <div className={css.title}>{t('authTitle')}</div>
        <p className={css.body} role="status">{t('authBody')}</p>
        <button className={css.reload} type="button" onClick={reload}>{t('authReload')}</button>
      </div>
    </div>
  )
}
