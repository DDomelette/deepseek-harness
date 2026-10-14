/**
 * Permission default-settings controller. The selectable presets and the
 * effective default come from the process catalog the Host serves; the shared
 * describe mirror supplies the namespace's writability, revision, and the
 * stored value once one exists. Writes target only `defaultPreset`, carry the
 * descriptor revision, and fold their answer back into the mirror.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PermissionCatalog } from '@deepseek-ai/dsh-permission-presets/client'
import { readPermissionCatalog } from './catalog.ts'
import { displayPermissionPreset } from './presentation.ts'

/** Permission's settings namespace on the host wire. */
export const PERMISSION_SETTINGS_NS = 'permission'

/** One selectable new-session default. */
export interface PermissionDefaultOption {
  /** Preset key written to Settings. */
  id: string
  /** Host-supplied label or a title-cased preset key. */
  label: string
}

/** Permission settings-row snapshot. */
export interface PermissionSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'unavailable' | 'error'
  error: string | null
  writable: boolean
  currentValue: string
  options: readonly PermissionDefaultOption[]
  revision: number
}

/**
 * Resolve the row's current default and its selectable options. The stored
 * value wins when the namespace publishes one; otherwise the catalog's
 * effective default for new sessions is what the row shows and what a
 * selection replaces.
 * @param view - permission namespace descriptor.
 * @param catalog - the process catalog the Host serves.
 * @returns current value and selectable options.
 * @throws when neither source supplies a default, or the catalog does not
 * advertise the one that applies — a row that cannot name its own value is an
 * error, never an empty selector.
 */
export function permissionDefaultOf(view: SettingsNamespaceView, catalog: PermissionCatalog): {
  currentValue: string
  options: PermissionDefaultOption[]
} {
  const stored = (view.value as { defaultPreset?: unknown } | null)?.defaultPreset
  const currentValue = stored ?? catalog.defaultPreset
  if (typeof currentValue !== 'string' || currentValue.length === 0) {
    throw new Error('permission settings and the permission catalog both lack a defaultPreset value')
  }
  const options = catalog.defaultOptions.map(option => ({
    id: option.value, label: displayPermissionPreset(option.value, option.name),
  }))
  if (options.length === 0 || !options.some(option => option.id === currentValue)) {
    throw new Error('permission catalog does not advertise its current default')
  }
  return { currentValue, options }
}

/** Controller deriving the row from the shared mirror and writing the default through it. */
export class PermissionPresetSettingsController {
  /** Row snapshot consumed through a bound selector hook. */
  readonly store: SnapshotStore<PermissionSettingsState> = createSnapshotStore({
    status: 'idle',
    error: null,
    writable: false,
    currentValue: '',
    options: [],
    revision: 0,
  })

  private following: (() => void) | undefined
  private saving = false
  private disposed = false
  /** Catalog read by {@link load}; the row derives nothing until one arrives. */
  private catalog: PermissionCatalog | undefined

  /**
   * @param describeFace - the shared mirror's read/fold face (descriptor and schema source).
   * @param ctx - the row plugin's context, whose `remote.settings` namespace
   * carries the `defaultPreset` write and whose permission Remote serves the catalog.
   */
  constructor(
    private readonly describeFace: SettingsDescribeFace,
    private readonly ctx: ClientContext,
  ) {}

  /**
   * Begin following the mirror (idempotent), read the permission catalog, and
   * reflect the result.
   * @returns settlement once the snapshot reflects the mirror and the catalog.
   */
  async load(): Promise<void> {
    if (this.disposed) return
    this.following ??= this.describeFace.subscribe(() => { this.derive() })
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    await this.describeFace.ensure()
    // A terminal non-loopback client keeps persistence off, so the row hides
    // itself without reading a catalog no surface would render.
    if (this.describeFace.getSnapshot().status !== 'unavailable') {
      try {
        this.catalog = await readPermissionCatalog(this.ctx)
      } catch (error) {
        this.fail(error)
        return
      }
    }
    this.derive()
  }

  /**
   * Persist one preset as the default for subsequently created sessions.
   * A selection made while one is already saving is ignored — the row's
   * control is disabled during the save, so this only drops programmatic
   * double-submits rather than user intent.
   * @param preset - advertised preset key.
   * @returns nothing; {@link store} carries success or failure.
   */
  async select(preset: string): Promise<void> {
    const state = this.store.getSnapshot()
    const view = this.describeFace.getSnapshot().view?.namespaces
      .find(entry => entry.ns === PERMISSION_SETTINGS_NS)
    if (view === undefined || !state.writable || this.saving) return
    this.saving = true
    this.store.update((draft) => {
      draft.status = 'saving'
      draft.error = null
    })
    let response
    try {
      response = await this.ctx.remote.settings.mutate(
        PERMISSION_SETTINGS_NS,
        [{ op: 'set', path: ['defaultPreset'], value: preset }],
        view.revision,
      )
    } finally {
      // Cleared before the fold below, whose publish reaches `derive` through
      // this row's own subscription and is skipped while a save is pending.
      this.saving = false
    }
    if (this.disposed) return
    if (!response.ok) {
      this.fail(response.error)
      return
    }
    // The mirror publish reaches this row's own subscription, so the fold
    // is also what republishes the accepted value here.
    this.describeFace.acceptView(response.value)
  }

  /** Stop following the mirror; later publishes leave the snapshot alone. */
  dispose(): void {
    this.disposed = true
    this.following?.()
    this.following = undefined
  }

  private derive(): void {
    if (this.disposed || this.saving) return
    const mirrored = this.describeFace.getSnapshot()
    if (mirrored.status === 'unavailable') {
      // The terminal non-loopback state: this client keeps Host persistence disabled, so
      // the row hides itself exactly like an unserved namespace.
      this.store.update((state) => {
        state.status = 'unavailable'
        state.writable = false
        state.currentValue = ''
        state.options = []
      })
      return
    }
    if (mirrored.view === undefined) {
      // A held failure with no answer is a failed row; without one the read
      // is still in flight and the row keeps its loading state.
      if (mirrored.error !== null) this.fail(new Error(mirrored.error))
      return
    }
    const view = mirrored.view.namespaces.find(entry => entry.ns === PERMISSION_SETTINGS_NS)
    if (view === undefined) {
      this.store.update((state) => {
        state.status = 'unavailable'
        state.writable = false
        state.currentValue = ''
        state.options = []
      })
      return
    }
    const catalog = this.catalog
    // A publish that reaches this row before the catalog read settles leaves it
    // loading: naming a choice set it has not read would render a wrong row.
    if (catalog === undefined) return
    try {
      const resolved = permissionDefaultOf(view, catalog)
      const { writable } = mirrored.view
      this.store.update((state) => {
        state.status = 'ready'
        state.error = null
        state.writable = writable
        state.currentValue = resolved.currentValue
        state.options = resolved.options
        state.revision = view.revision
      })
    } catch (error) {
      this.fail(error)
    }
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    })
  }
}
