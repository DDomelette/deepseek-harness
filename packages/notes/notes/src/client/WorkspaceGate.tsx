/**
 * The first-run gate: while the settings section resolves to no workspace, the
 * panel shows this centered picker and nothing else.
 *
 * The gate carries the same directory field the settings card edits, so a
 * directory chosen here is the same write, and the panel opens the moment the
 * re-read section names it. Every other control stays out of the tree until
 * then: a conversation cannot start without the workspace, so offering the
 * rest of the panel earlier would only invite the `workspace-missing` refusal.
 */
import type { ReactNode } from 'react'
import { IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesInjected } from './face.ts'
import { WorkspaceField } from './WorkspaceField.tsx'
import css from './WorkspaceGate.module.css'

/** The gate's props: the panel's commands and copy. */
export interface WorkspaceGateProps {
  /** The panel's commands. */
  readonly commands: NotesInjected
  /** Namespace-bound translate. */
  readonly t: PropsLocale<'notes'>['t']
}

/**
 * The first-run workspace gate.
 * @param props - the panel's commands and copy.
 * @returns the centered workspace picker.
 */
export function WorkspaceGate({ commands, t }: WorkspaceGateProps): ReactNode {
  return (
    <div className={css.gate} data-notes-gate>
      <IconFolderOpenOutline16 size={24} />
      <p className={css.title}>{t('gate.title')}</p>
      <p className={css.hint}>{t('gate.hint')}</p>
      <div className={css.field}>
        <WorkspaceField workspace={null} commands={commands} t={t} />
      </div>
    </div>
  )
}
