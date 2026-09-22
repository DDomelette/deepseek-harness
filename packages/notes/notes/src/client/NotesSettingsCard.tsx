/**
 * The notes settings card: what the deployment's notes section resolves to,
 * and the fields a reader can change from the panel.
 *
 * The card edits one field at a time and writes only what changed, so two
 * readers on the same document cannot overwrite each other's unrelated fields.
 * A control saves the moment its value is decided — choices on the pick, the
 * directory field on blur or Enter — except the feature editor, which writes a
 * whole list entry from two fields and keeps an explicit save.
 * The selection-feature list is the exception: the editor holds one feature and
 * writes the complete list, because the list is one document value and an
 * index-addressed write would drift as soon as it changes shape. The model and
 * feature pickers read the deployment's own catalog, so the card offers what
 * this deployment serves instead of a second copy of what is configured.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { Button, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesSettingsView } from '../types.ts'
import { failureLine } from './failure-line.ts'
import type { NotesPanelFailure } from './failure-line.ts'
import type { NotesInjected } from './face.ts'
import { WorkspaceField } from './WorkspaceField.tsx'
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
  const [catalog, setCatalog] = useState<ModelCatalog | undefined>(undefined)
  const [modelKey, setModelKey] = useState(modelKeyOf(settings.model))
  const [effort, setEffort] = useState(settings.model?.reasoningEffort ?? '')
  const [feature, setFeature] = useState(settings.actions[0]?.id ?? '')
  const [label, setLabel] = useState(settings.actions[0]?.label ?? '')
  const [prompt, setPrompt] = useState(settings.actions[0]?.prompt ?? '')
  useEffect(() => {
    // The catalog is the deployment's own answer, read once per open like the
    // section itself; a refusal leaves the pickers showing the stored route.
    void commands.loadModels().then((loaded) => { if (loaded !== null) setCatalog(loaded) })
  }, [commands])
  const picked = findModel(catalog, modelKey)
  const efforts = picked?.reasoning?.efforts ?? []
  const current = settings.actions.find(action => action.id === feature)
  // A feature being added has nothing stored to compare against, so its save
  // is offered as soon as both fields carry text; a blank field is what the
  // Host refuses too.
  const unchanged = current !== undefined && label === current.label && prompt === current.prompt
  const blank = label.trim() === '' || prompt.trim() === ''
  /**
   * Write the model route and effort the pickers show; the pickers are
   * discrete choices, so a change saves immediately.
   * @param key - the picker key (`provider/model`), or '' for the session default.
   * @param effortValue - the effort pick, or '' for the route's own default.
   */
  const saveModel = (key: string, effortValue: string): void => {
    const route = findModel(catalog, key)
    if (route === undefined) {
      commands.saveSettings({ model: null })
      return
    }
    commands.saveSettings({
      model: {
        provider: route.group,
        model: route.id,
        reasoningEffort: effortValue === '' ? null : effortValue,
      },
    })
  }
  /** Show one configured feature in the editor. */
  const openFeature = (id: string): void => {
    setFeature(id)
    const action = settings.actions.find(candidate => candidate.id === id)
    setLabel(action?.label ?? '')
    setPrompt(action?.prompt ?? '')
  }
  /** Start a feature that is not in the list yet. */
  const addFeature = (): void => {
    setFeature('')
    setLabel('')
    setPrompt('')
  }
  /** Write the editor's feature into the complete list. */
  const saveFeature = (): void => {
    if (current === undefined) {
      const id = mintActionId(settings.actions)
      setFeature(id)
      commands.saveSettings({ actions: [...settings.actions, { id, label, prompt, autoSend: false }] })
      return
    }
    // The list is one document value, so an edit writes the whole list with
    // this feature replaced and every other one as the last read resolved it.
    commands.saveSettings({
      actions: settings.actions.map(candidate => candidate.id === feature
        ? { ...candidate, label, prompt }
        : candidate),
    })
  }
  return (
    <>
      <section className={css.section}>
        <h3 className={css.heading}>{t('settings.strategy')}</h3>
        {(['manual', 'auto'] as const).map(option => (
          <Button
            key={option}
            size="sm"
            variant={settings.strategy === option ? 'primary' : 'outline'}
            aria-pressed={settings.strategy === option}
            data-notes-strategy={option}
            onClick={() => { commands.saveSettings({ strategy: option }) }}
          >
            {t(option === 'manual' ? 'settings.strategyManual' : 'settings.strategyAuto')}
          </Button>
        ))}
      </section>
      <section className={css.section}>
        <h3 className={css.heading}>{t('settings.workspace')}</h3>
        <WorkspaceField workspace={settings.workspace} commands={commands} t={t} />
      </section>
      <section className={css.section}>
        <h3 className={css.heading}>{t('settings.model')}</h3>
        <select
          className={css.field}
          aria-label={t('settings.modelPick')}
          data-notes-model-pick
          value={modelKey}
          onChange={(event) => {
            const key = event.target.value
            setModelKey(key)
            // Each route declares its own efforts, so the effort follows the pick.
            setEffort('')
            saveModel(key, '')
          }}
        >
          <option value="">{t('settings.modelFollow')}</option>
          {catalog?.groups.map(group => (
            <optgroup key={group.id} label={group.name}>
              {group.models.map(model => (
                <option key={`${group.id}/${model.id}`} value={`${group.id}/${model.id}`}>{model.name}</option>
              ))}
            </optgroup>
          ))}
          {/* A route the catalog no longer advertises stays selectable while the
              section stores it; switching away from it is the reader's call. */}
          {picked === undefined && modelKey !== '' && <option value={modelKey}>{modelKey}</option>}
        </select>
        {efforts.length > 0 && (
          <select
            className={css.field}
            aria-label={t('settings.effort')}
            data-notes-effort-pick
            value={effort}
            onChange={(event) => {
              setEffort(event.target.value)
              saveModel(modelKey, event.target.value)
            }}
          >
            <option value="">{t('settings.effortDefault')}</option>
            {efforts.map(option => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        )}
      </section>
      <section className={css.section}>
        <h3 className={css.heading}>{t('settings.actions')}</h3>
        <select
          className={css.field}
          aria-label={t('settings.actionPick')}
          data-notes-action-pick
          value={feature}
          onChange={(event) => { openFeature(event.target.value) }}
        >
          {current === undefined && <option value="">{t('settings.actionNew')}</option>}
          {settings.actions.map(action => (
            <option key={action.id} value={action.id}>{action.label}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          className={css.addFeature}
          aria-label={t('settings.actionAdd')}
          data-notes-add-action
          onClick={addFeature}
        >
          +
        </Button>
        <input
          className={css.field}
          aria-label={t('settings.actionLabelInput')}
          placeholder={t('settings.actionLabelPlaceholder')}
          data-notes-action-label
          value={label}
          onChange={(event) => { setLabel(event.target.value) }}
        />
        <textarea
          className={css.actionPrompt}
          aria-label={t('settings.actionPromptInput')}
          placeholder={t('settings.actionPromptPlaceholder')}
          data-notes-action-prompt
          value={prompt}
          onChange={(event) => { setPrompt(event.target.value) }}
        />
        <div className={css.actionFoot}>
          {/* The feature editor writes a whole list entry from two fields, so
              it keeps an explicit commit; the primary look marks it as one. */}
          <Button
            size="sm"
            variant="primary"
            data-notes-save-action
            disabled={unchanged || blank}
            onClick={saveFeature}
          >
            {t('settings.saveAction')}
          </Button>
          {current !== undefined && (
            <span className={css.actionFlags}>
              <Tag tone="quiet">{current.autoSend ? t('settings.autoSend') : t('settings.manualSend')}</Tag>
            </span>
          )}
        </div>
      </section>
    </>
  )
}

/** The picker key of one stored model override: `provider/model`, or '' for none. */
function modelKeyOf(model: NotesSettingsView['model']): string {
  return model === null ? '' : `${model.provider}/${model.model}`
}

/** One catalog model together with the provider group it belongs to. */
type PickedModel = ModelCatalog['groups'][number]['models'][number] & { readonly group: string }

/**
 * Find the catalog entry one picker key names.
 * @param catalog - the deployment's catalog, or undefined while it is unread.
 * @param key - the picker key (`provider/model`), or ''.
 * @returns the model and its provider, or undefined when the catalog holds none.
 */
function findModel(catalog: ModelCatalog | undefined, key: string): PickedModel | undefined {
  if (catalog === undefined || key === '') return undefined
  const separator = key.indexOf('/')
  const provider = key.slice(0, separator)
  const id = key.slice(separator + 1)
  const group = catalog.groups.find(candidate => candidate.id === provider)
  const model = group?.models.find(candidate => candidate.id === id)
  return model === undefined ? undefined : { ...model, group: provider }
}

/**
 * Mint the id of a feature the reader is adding.
 *
 * A material stores the id it was collected under, so it must be stable and
 * unique within the list; the label is free text the reader may rename at any
 * time, which is why the id is not derived from it.
 * @param actions - the features already configured.
 * @returns an id no configured feature uses.
 */
function mintActionId(actions: NotesSettingsView['actions']): string {
  for (let index = 1; ; index += 1) {
    const id = `custom-${String(index)}`
    if (!actions.some(action => action.id === id)) return id
  }
}
