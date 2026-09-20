/** Optional settings-header action for opening a file-backed Host document. */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button, IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsDocumentStore } from './settings-document-store.ts'
import css from './SettingsDocumentAction.module.css'

/** Registrant-owned dependencies of {@link SettingsDocumentAction}. */
export interface SettingsDocumentActionInjected {
  /** Provider metadata and action state owner. */
  controller: SettingsDocumentStore
  hooks: {
    /** Controller snapshot bound by the UI renderer as useSnapshot. */
    snapshot: SettingsDocumentStore['store']
  }
}

/** Header-action owner share, localized copy, and the registrant's state face. */
export type SettingsDocumentActionProps =
  PropsRuntime<'settings.action'> & PropsLocale<'settings'> & InjectFace<SettingsDocumentActionInjected>

/**
 * Render the open-document action only after Host metadata confirms document availability.
 * @param props - header owner props, localized copy, and injected document state.
 * @returns the action, or null while unavailable or unresolved.
 */
export function SettingsDocumentAction({ controller, useSnapshot, t }: SettingsDocumentActionProps): ReactNode {
  const state = useSnapshot(snapshot => snapshot)

  useEffect(() => {
    void controller.load()
  }, [controller])

  if (state.status !== 'ready') return null

  return (
    <div className={css.action}>
      {state.error === null ? null : <span className={css.error} role="alert">{t('openDocument.error')}</span>}
      <Button
        variant="outline"
        size="sm"
        aria-label={t('openDocument')}
        disabled={state.opening}
        onClick={() => { void controller.open() }}
      >
        {/* Single-pane handsets swap the label for the glyph (the header also
            holds back, the section title, and close); the name stays on the
            button's aria-label either way. */}
        <span className={css.actionIcon} aria-hidden><IconCodeOutline16 size={16} /></span>
        <span className={css.actionLabel}>{t('openDocument')}</span>
      </Button>
    </div>
  )
}
