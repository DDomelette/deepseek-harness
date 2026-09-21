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
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import { Button, Modal, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
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
  const [browsing, setBrowsing] = useState<'closed' | 'level' | 'drives'>('closed')
  const [listed, setListed] = useState<DirectoryListing | undefined>(undefined)
  const [reading, setReading] = useState(false)
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
   * Read one directory level into the card's browser.
   * @param path - the level to show, or null for the host's home directory.
   */
  const readLevel = async (path: string | null): Promise<void> => {
    setReading(true)
    const level = await commands.listDirectories(path)
    setReading(false)
    // A refused level leaves the browser where it was; the face reports the
    // refusal on the card's failure line.
    if (level === null) return
    setListed(level)
    setBrowsing('level')
  }
  /** Fill the directory field from the host's own chooser, or browse when it serves none. */
  const browse = async (): Promise<void> => {
    const chosen = await commands.pickDirectory()
    if (chosen.kind === 'picked') {
      setWorkspace(chosen.path)
      // A picked directory is a deliberate value, so it saves on the pick.
      commands.saveSettings({ workspace: chosen.path })
      return
    }
    if (chosen.kind === 'cancelled') return
    await readLevel(null)
  }
  /**
   * Write the directory field. The field is free text, so it commits on blur
   * or Enter rather than on every keystroke; a blank-after-trim value unsets
   * the directory, matching the explicit clear the save button had.
   */
  const commitWorkspace = (): void => {
    const trimmed = workspace.trim()
    if (trimmed === (settings.workspace ?? '')) return
    commands.saveSettings({ workspace: trimmed === '' ? null : trimmed })
  }
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
        <div className={css.directory}>
          <input
            className={css.field}
            aria-label={t('settings.workspace')}
            data-notes-workspace
            value={workspace}
            onChange={(event) => { setWorkspace(event.target.value) }}
            onBlur={commitWorkspace}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitWorkspace()
            }}
          />
          <Button
            size="sm"
            variant="outline"
            aria-label={t('settings.browse')}
            data-notes-browse
            onClick={() => { void browse() }}
          >
            {t('settings.browse')}
          </Button>
        </div>
        {browsing !== 'closed' && listed !== undefined && (
          <DirectoryBrowser
            view={browsing}
            listed={listed}
            reading={reading}
            t={t}
            open={(path) => { void readLevel(path) }}
            showDrives={() => { setBrowsing('drives') }}
            choose={() => {
              setWorkspace(listed.path)
              // A level chosen in the browser is deliberate, like a native pick.
              commands.saveSettings({ workspace: listed.path })
              setBrowsing('closed')
            }}
            close={() => { setBrowsing('closed') }}
          />
        )}
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

/**
 * The directory browser a deployment without a native chooser gets.
 *
 * It shows one level at a time — the host lists directories and their ancestry,
 * so the card never joins path segments itself — and the reader descends by
 * opening a child and chooses by taking the level it is standing in. Hidden
 * entries stay out of the list: the host platform's convention decides which
 * they are, and a configuration field does not need them. A level that is
 * itself a volume root has no parent to step up into, so the control that
 * leads on from it opens the volume list the host reported instead.
 * @param props - the view, its level, the read state, navigations, and copy.
 * @returns the browser.
 */
function DirectoryBrowser({ view, listed, reading, open, showDrives, choose, close, t }: {
  readonly view: 'level' | 'drives'
  readonly listed: DirectoryListing
  readonly reading: boolean
  readonly open: (path: string) => void
  readonly showDrives: () => void
  readonly choose: () => void
  readonly close: () => void
  readonly t: PropsLocale<'notes'>['t']
}): ReactNode {
  const parent = listed.crumbs.at(-2)
  const drives = listed.drives ?? []
  const rows = view === 'drives' ? drives : listed.entries.filter(entry => !entry.hidden)
  return (
    <div className={css.browser} data-notes-browser>
      <p className={css.browserPath} data-notes-browser-path>
        {view === 'drives' ? t('settings.browseDrives') : listed.path}
      </p>
      {reading && <p className={css.line}>{t('settings.browseReading')}</p>}
      <ul className={css.browserList}>
        {rows.map(row => (
          <li key={row.path}>
            <button
              type="button"
              className={css.browserEntry}
              data-notes-browse-entry={row.path}
              onClick={() => { open(row.path) }}
            >
              {row.name}
            </button>
          </li>
        ))}
      </ul>
      <div className={css.browserActions}>
        {/* Up one level, or on to the volumes where this level is a root. */}
        {view === 'level' && parent !== undefined && (
          <Button
            size="sm"
            variant="outline"
            data-notes-browse-up
            disabled={reading}
            onClick={() => { open(parent.path) }}
          >
            {t('settings.browseUp')}
          </Button>
        )}
        {view === 'level' && parent === undefined && drives.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            data-notes-browse-drives
            disabled={reading}
            onClick={showDrives}
          >
            {t('settings.browseDrives')}
          </Button>
        )}
        {view === 'level' && (
          <Button size="sm" variant="outline" data-notes-browse-choose onClick={choose}>
            {t('settings.browseChoose')}
          </Button>
        )}
        <Button size="sm" variant="outline" data-notes-browse-close onClick={close}>
          {t('settings.browseClose')}
        </Button>
      </div>
    </div>
  )
}
