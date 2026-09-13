/**
 * The way back into the notes panel: one button in the conversation header's
 * corner seat. Opening a panel that is already open reveals it, so the button
 * needs no state of its own.
 */
import type { ReactNode } from 'react'
import { IconListPenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './NotesButton.module.css'

/** The commands the header control calls. */
export interface NotesButtonInjected {
  /** Show the notes panel, revealing an already open one. */
  readonly open: () => void
}

/** The button's props: the header corner seat, its command, and copy. */
export type NotesButtonProps =
  & PropsRuntime<'conversation.session.header.corner'>
  & InjectFace<NotesButtonInjected>
  & PropsLocale<'notes'>

/**
 * The notes control, registered into the conversation header's corner seat.
 * @param props - composed slot props.
 * @returns the button.
 */
export function NotesButton({ open, t }: NotesButtonProps): ReactNode {
  return (
    <Tooltip label={t('header.open')} side="bottom" delayMs={500}>
      <button
        type="button"
        className={css.button}
        aria-label={t('header.openAria')}
        data-notes-open
        onClick={open}
      >
        <IconListPenOutline16 className={css.icon} />
      </button>
    </Tooltip>
  )
}
