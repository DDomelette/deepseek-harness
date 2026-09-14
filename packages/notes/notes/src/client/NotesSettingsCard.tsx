/**
 * The notes settings card: what the deployment's notes section resolves to,
 * and the three fields a reader can change from the panel.
 *
 * The card edits one field at a time and writes only what changed, so two
 * readers on the same document cannot overwrite each other's unrelated fields.
 * The collection actions stay read-only here: they are a list of prompt
 * templates, and editing them needs a form this card does not have yet.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesSettingsView } from '../types.ts'
import { failureLine } from './failure-line.ts'
import type { NotesPanelFailure } from './failure-line.ts'
import type { NotesInjected } from './face.ts'
import css from './NotesSettingsCard.module.css'

/** The card's props: the section, its read state, and the panel's commands. */
export interface NotesSettingsCardProps {
  /** The settings section, once a read answered. */
  readonly settings: NotesSettingsView | undefined
  /** A read is in flight. */
  readonly loading: boolean
  /** Why the last read or write produced nothing. */
  readonly failure: NotesPanelFailure | undefined
  /** The panel's commands. */
  readonly commands: NotesInjected
  /** Namespace-bound translate. */
  readonly t: PropsLocale<'notes'>['t']
  /** Close the card. */
  readonly close: () => void
}

/**
 * The settings card.
 * @param props - the section, its read state, and the panel's commands.
 * @returns the card, or the reason it has nothing to show.
 */
export function NotesSettingsCard({
  settings, loading, failure, commands, t, close,
}: NotesSettingsCardProps): ReactNode {
  return (
    <Modal open onClose={close} title={t('settings.title')} closeLabel={t('settings.close')}>
      <div className={css.card} data-notes-settings>
        {loading && <p className={css.line}>{t('settings.loading')}</p>}
        {failure !== undefined && (
          <p className={css.failure} data-notes-settings-failure={failure.code}>{failureLine(t, failure)}</p>
        )}
        {settings !== undefined && failure === undefined && (
          <SettingsForm settings={settings} commands={commands} t={t} />
        )}
      </div>
    </Modal>
  )
}

/** The editable fields of one deployment's notes section. */
function SettingsForm({ settings, commands, t }: {
  readonly settings: NotesSettingsView
  readonly commands: NotesInjected
  readonly t: PropsLocale<'notes'>['t']
}): ReactNode {
  const [workspace, setWorkspace] = useState(settings.workspace ?? '')
  const [provider, setProvider] = useState(settings.model?.provider ?? '')
  const [model, setModel] = useState(settings.model?.model ?? '')
  const overridden = settings.model !== null
  return (
    <>
      <section className={css.section}>
        <h3 className={css.heading}>{t('settings.strategy')}</h3>
        {(['manual', 'auto'] as const).map(option => (
          <button
            key={option}
            type="button"
            className={css.choice}
            aria-pressed={settings.strategy === option}
            data-notes-strategy={option}
            onClick={() => { commands.saveSettings({ strategy: option }) }}
          >
            {t(option === 'manual' ? 'settings.strategyManual' : 'settings.strategyAuto')}
          </button>
        ))}
      </section>
      <section className={css.section}>
        <h3 className={css.heading}>{t('settings.workspace')}</h3>
        <input
          className={css.field}
          aria-label={t('settings.workspace')}
          data-notes-workspace
          value={workspace}
          onChange={(event) => { setWorkspace(event.target.value) }}
        />
        <button
          type="button"
          className={css.action}
          data-notes-save-workspace
          onClick={() => { commands.saveSettings({ workspace: workspace === '' ? null : workspace }) }}
        >
          {t('settings.saveWorkspace')}
        </button>
      </section>
      <section className={css.section}>
        <h3 className={css.heading}>{t('settings.model')}</h3>
        <input
          className={css.field}
          aria-label={t('settings.provider')}
          placeholder={t('settings.provider')}
          data-notes-provider
          value={provider}
          onChange={(event) => { setProvider(event.target.value) }}
        />
        <input
          className={css.field}
          aria-label={t('settings.modelName')}
          placeholder={t('settings.modelName')}
          data-notes-model
          value={model}
          onChange={(event) => { setModel(event.target.value) }}
        />
        <button
          type="button"
          className={css.action}
          data-notes-save-model
          disabled={provider === '' || model === ''}
          onClick={() => { commands.saveSettings({ model: { provider, model } }) }}
        >
          {t('settings.saveModel')}
        </button>
        {overridden && (
          <button
            type="button"
            className={css.action}
            data-notes-clear-model
            onClick={() => { commands.saveSettings({ model: null }) }}
          >
            {t('settings.clearModel')}
          </button>
        )}
      </section>
      <section className={css.section}>
        <h3 className={css.heading}>{t('settings.actions')}</h3>
        <ul className={css.actions}>
          {settings.actions.map(action => (
            <li key={action.id} className={css.actionRow} data-notes-action={action.id}>
              <span className={css.actionLabel}>{action.label}</span>
              <span className={css.actionPrompt}>{action.prompt}</span>
              <span className={css.actionFlags}>
                {action.autoSend ? t('settings.autoSend') : t('settings.manualSend')}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {!settings.writable && (
        <p className={css.line} data-notes-settings-readonly>{t('settings.readOnly')}</p>
      )}
    </>
  )
}
