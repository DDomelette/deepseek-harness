/**
 * The way back into the notes panel: one button in the conversation header's
 * right-aligned utilities. Opening a panel that is already open reveals it, so
 * the button needs no state of its own.
 */
import type { ReactNode } from 'react'
import { IconListPenOutlineMedium, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './NotesButton.module.css'

/** The commands the header control calls. */
export interface NotesButtonInjected {
  /** Show the notes panel, revealing an already open one. */
  readonly open: () => void
}

/** The button's props: the header utilities seat, its command, and copy. */
export type NotesButtonProps =
  & PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<NotesButtonInjected>
  & PropsLocale<'notes'>

/**
 * The notes control, registered into the conversation header's utilities.
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
        <IconListPenOutlineMedium className={css.icon} />
      </button>
    </Tooltip>
  )
}
