/**
 * The workspace directory field, shared by the settings card and the first-run
 * gate.
 *
 * The field is free text, so it commits on blur or Enter rather than on every
 * keystroke; a blank-after-trim value unsets the directory. A directory the
 * host's own chooser or the in-card browser yields is a deliberate value, so it
 * saves on the pick. A deployment that serves no native chooser gets the
 * in-card browser over the host's directory listing instead.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesInjected } from './face.ts'
import css from './WorkspaceField.module.css'

/** The field's props: the resolved directory, the panel's commands, and copy. */
export interface WorkspaceFieldProps {
  /** The directory the settings section resolves to, or null while unset. */
  readonly workspace: string | null
  /** The panel's commands. */
  readonly commands: NotesInjected
  /** Namespace-bound translate. */
  readonly t: PropsLocale<'notes'>['t']
}

/**
 * The workspace directory field.
 * @param props - the resolved directory, the panel's commands, and copy.
 * @returns the field, its browse control, and the browser a pick can open.
 */
export function WorkspaceField({ workspace: resolved, commands, t }: WorkspaceFieldProps): ReactNode {
  const [workspace, setWorkspace] = useState(resolved ?? '')
  const [browsing, setBrowsing] = useState<'closed' | 'level' | 'drives'>('closed')
  const [listed, setListed] = useState<DirectoryListing | undefined>(undefined)
  const [reading, setReading] = useState(false)
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
    if (trimmed === (resolved ?? '')) return
    commands.saveSettings({ workspace: trimmed === '' ? null : trimmed })
  }
  return (
    <>
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
          className={css.browse}
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
          createDirectory={commands.createDirectory}
          choose={() => {
            setWorkspace(listed.path)
            // A level chosen in the browser is deliberate, like a native pick.
            commands.saveSettings({ workspace: listed.path })
            setBrowsing('closed')
          }}
          close={() => { setBrowsing('closed') }}
        />
      )}
    </>
  )
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
 * leads on from it opens the volume list the host reported instead. "New
 * folder" creates a child of the level in view and steps into it, so choosing
 * it is one click away.
 * @param props - the view, its level, the read state, navigations, and copy.
 * @returns the browser.
 */
function DirectoryBrowser({ view, listed, reading, open, showDrives, choose, close, createDirectory, t }: {
  readonly view: 'level' | 'drives'
  readonly listed: DirectoryListing
  readonly reading: boolean
  readonly open: (path: string) => void
  readonly showDrives: () => void
  readonly choose: () => void
  readonly close: () => void
  readonly createDirectory: NotesInjected['createDirectory']
  readonly t: PropsLocale<'notes'>['t']
}): ReactNode {
  const parent = listed.crumbs.at(-2)
  const drives = listed.drives ?? []
  const rows = view === 'drives' ? drives : listed.entries.filter(entry => !entry.hidden)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState<'exists' | 'failed' | null>(null)
  const [busy, setBusy] = useState(false)
  /** Create the named child under the level in view and step into it. */
  const create = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    setCreateError(null)
    const created = await createDirectory(listed.path, trimmed)
    setBusy(false)
    if (!created.ok) {
      setCreateError(created.code)
      return
    }
    setCreating(false)
    setName('')
    open(created.path)
  }
  return (
    <div className={css.browser} data-notes-browser>
      <p className={css.browserPath} data-notes-browser-path>
        {view === 'drives' ? t('settings.browseDrives') : listed.path}
      </p>
      {reading && <p className={css.line}>{t('settings.browseReading')}</p>}
      {creating && view === 'level' && (
        <div className={css.createRow} data-notes-browser-create>
          <input
            className={css.field}
            aria-label={t('settings.folderName')}
            placeholder={t('settings.folderNamePlaceholder')}
            data-notes-new-folder-name
            value={name}
            autoFocus
            onChange={(event) => { setName(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create()
              if (event.key === 'Escape') setCreating(false)
            }}
          />
          <Button
            size="sm"
            variant="primary"
            className={css.browse}
            data-notes-new-folder-create
            disabled={name.trim() === '' || busy}
            onClick={() => { void create() }}
          >
            {t('settings.folderCreate')}
          </Button>
        </div>
      )}
      {createError !== null && (
        <p className={css.createFailure} data-notes-new-folder-failure={createError}>
          {t(createError === 'exists' ? 'error.directoryExists' : 'error.directoryCreateFailed')}
        </p>
      )}
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
        {view === 'level' && !creating && (
          <Button
            size="sm"
            variant="outline"
            data-notes-browse-new-folder
            onClick={() => {
              setCreateError(null)
              setCreating(true)
            }}
          >
            {t('settings.browseNewFolder')}
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
