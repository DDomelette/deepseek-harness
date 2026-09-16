/**
 * The notes settings card: what the deployment's notes section resolves to,
 * and the fields a reader can change from the panel.
 *
 * The card edits one field at a time and writes only what changed, so two
 * readers on the same document cannot overwrite each other's unrelated fields.
 * A collection action is the exception: an action's label and prompt are edited
 * in place and written as the complete list, because the list is one document
 * value and an index-addressed write would drift as soon as it changes shape.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesActionView, NotesSettingsView } from '../types.ts'
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
  /** Fill the directory field from the host's own chooser. */
  const browse = async (): Promise<void> => {
    const picked = await commands.pickDirectory()
    // Null is a cancelled chooser or a deployment that serves none; the face
    // reports the second case on the card's failure line.
    if (picked !== null) setWorkspace(picked)
  }
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
        <div className={css.directory}>
          <input
            className={css.field}
            aria-label={t('settings.workspace')}
            data-notes-workspace
            value={workspace}
            onChange={(event) => { setWorkspace(event.target.value) }}
          />
          <button
            type="button"
            className={css.browse}
            aria-label={t('settings.browse')}
            data-notes-browse
            onClick={() => { void browse() }}
          >
            {t('settings.browse')}
          </button>
        </div>
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
            <ActionRow
              key={action.id}
              action={action}
              t={t}
              save={(edited) => {
                // The list is one document value, so an edit writes the whole
                // list with this action replaced and every other action as the
                // last read resolved it.
                commands.saveSettings({
                  actions: settings.actions.map(candidate =>
                    candidate.id === action.id ? edited : candidate),
                })
              }}
            />
          ))}
        </ul>
      </section>
    </>
  )
}

/**
 * One configured collection action, editable in place.
 *
 * The draft lives here rather than in the form so each row keeps its own edit;
 * the save is offered only once the copy differs from what the Host resolved,
 * and never while a field is blank, which is what the Host refuses too.
 * @param props - the action, the write to make, and copy.
 * @returns the row.
 */
function ActionRow({ action, save, t }: {
  readonly action: NotesActionView
  readonly save: (action: NotesActionView) => void
  readonly t: PropsLocale<'notes'>['t']
}): ReactNode {
  const [label, setLabel] = useState(action.label)
  const [prompt, setPrompt] = useState(action.prompt)
  const changed = label !== action.label || prompt !== action.prompt
  const blank = label.trim() === '' || prompt.trim() === ''
  return (
    <li className={css.actionRow} data-notes-action={action.id}>
      <input
        className={css.field}
        aria-label={t('settings.actionLabel', { action: action.id })}
        data-notes-action-label={action.id}
        value={label}
        onChange={(event) => { setLabel(event.target.value) }}
      />
      <textarea
        className={css.actionPrompt}
        aria-label={t('settings.actionPrompt', { action: action.id })}
        data-notes-action-prompt={action.id}
        value={prompt}
        onChange={(event) => { setPrompt(event.target.value) }}
      />
      <div className={css.actionFoot}>
        <button
          type="button"
          className={css.action}
          data-notes-save-action={action.id}
          disabled={!changed || blank}
          onClick={() => { save({ ...action, label, prompt }) }}
        >
          {t('settings.saveAction')}
        </button>
        <span className={css.actionFlags}>
          {action.autoSend ? t('settings.autoSend') : t('settings.manualSend')}
        </span>
      </div>
    </li>
  )
}
