/** Skills settings page store: catalog × settings-namespace join with revision-guarded toggles. */

import type { IApiClient, RpcResponse, SessionId, SkillCatalogEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Settings namespace carrying the user-disabled skill names (host: dsh-skill-settings). */
export const SKILLS_NAMESPACE = 'skills'

/** One reread closes a catalog/settings race without leaving the page in a retry loop. */
const MAX_LOAD_ATTEMPTS = 2

/** Browser state of the skills settings page. */
export interface SkillsSettingsState {
  /** Load phase; the page loads on first mount and refetches on pushed invalidations. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Invocation-neutral catalog rows with effective flags and the disabled marker. */
  skills: readonly SkillCatalogEntry[]
  /** Skills-namespace revision for revision-guarded writes; undefined while the namespace is not exposed. */
  revision: number | undefined
  /** Whether the settings seam accepts writes. */
  writable: boolean
  /** Names with an in-flight toggle write. */
  writing: readonly string[]
  /** Whether no session was open at load: the page shows the no-session posture. */
  noSession: boolean
  /** Last load or write diagnostic; UI exposes only localized copy around it. */
  error: string | null
}

/** A successful RPC result assembled locally (the no-session catalog). */
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: 'local' as never, result: { ok: true, value } }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Parse the namespace value the host validates against dsh-skill-settings' schema. */
function disabledNamesOf(value: unknown): ReadonlySet<string> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The skills settings namespace returned an invalid disabled list.')
  }
  const disabled = (value as { disabled?: unknown }).disabled
  if (!Array.isArray(disabled) || !disabled.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error('The skills settings namespace returned an invalid disabled list.')
  }
  return new Set(disabled)
}

/** Wire face the page reads and writes through. */
export type SkillsSettingsApi = Pick<IApiClient, 'skills' | 'settings'>

/**
 * Owns the skills page snapshot: the addressed session's catalog, the
 * skills-namespace revision, and the toggle write path. Toggling patches the
 * namespace's `disabled` list with the revision the page read; a conflict
 * reloads the page so the newest list backs the next attempt.
 */
export class SkillsSettingsStore {
  /** uSES-safe state source shared by the registered section. */
  readonly store: SnapshotStore<SkillsSettingsState> = createSnapshotStore({
    status: 'idle',
    skills: [],
    revision: undefined,
    writable: false,
    writing: [],
    noSession: false,
    error: null,
  })

  private generation = 0
  /** Full user-disabled list, including names absent from the current session's catalog. */
  private disabled: ReadonlySet<string> = new Set()

  /**
   * @param api - skill catalog and settings wire faces.
   * @param currentSessionId - thunk resolving the current session (the panel
   *   lists that session's composition; undefined means no session is open).
   */
  constructor(
    private readonly api: SkillsSettingsApi,
    private readonly currentSessionId: () => SessionId | undefined,
  ) {}

  /**
   * Load the addressed session's catalog and the settings seam's write
   * state; only a complete join reaches `ready`, so a stale revision can
   * never back a write. Without an open session the catalog is empty and the
   * page shows the no-session posture instead of fetching.
   * @returns after the latest load settles in the store.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt += 1) {
      try {
        const sessionId = this.currentSessionId()
        const [catalog, described] = await Promise.all([
          sessionId === undefined
            ? Promise.resolve(ok({ skills: [] as SkillCatalogEntry[] }))
            : this.api.skills.catalog({ sessionId }),
          this.api.settings.describe({}),
        ])
        if (generation !== this.generation) return
        if (!catalog.result.ok) {
          throw new Error(catalog.result.error.message)
        }
        if (!described.result.ok) {
          throw new Error(described.result.error.message)
        }
        const catalogValue = catalog.result.value
        const describedValue = described.result.value
        const namespace = describedValue.namespaces.find(entry => entry.ns === SKILLS_NAMESPACE)
        let disabled: ReadonlySet<string> = new Set()
        if (namespace !== undefined) {
          disabled = disabledNamesOf(namespace.value)
          const consistent = catalogValue.skills.every(skill => skill.disabled === disabled.has(skill.name))
          if (!consistent) {
            if (attempt < MAX_LOAD_ATTEMPTS) continue
            throw new Error('The skill catalog changed while the page was loading. Try again.')
          }
        }
        this.disabled = disabled
        this.store.update((state) => {
          state.status = 'ready'
          state.skills = catalogValue.skills
          state.writable = describedValue.writable
          state.revision = namespace?.revision
          state.noSession = sessionId === undefined
        })
        return
      } catch (error) {
        if (generation !== this.generation) return
        this.store.update((state) => {
          state.status = 'error'
          state.error = messageOf(error)
        })
        return
      }
    }
  }

  /**
   * Switch one skill on or off through a revision-guarded namespace write,
   * then reload the page so the store reflects the host's effective state.
   * @param name - the skill to toggle.
   * @param enabled - whether the skill should be available.
   * @returns after the write and the reload settle.
   */
  async setEnabled(name: string, enabled: boolean): Promise<void> {
    const state = this.store.getSnapshot()
    if (state.status !== 'ready') return
    if (state.revision === undefined) {
      this.store.update((current) => {
        current.error = 'The skills settings namespace is not exposed.'
      })
      return
    }
    const disabled = new Set(this.disabled)
    if (enabled) disabled.delete(name)
    else disabled.add(name)
    this.store.update((current) => {
      current.error = null
      current.writing = [...current.writing, name]
    })
    try {
      const response = await this.api.settings.update({
        ns: SKILLS_NAMESPACE,
        patch: { disabled: [...disabled] },
        expectedRevision: state.revision,
      })
      if (!response.result.ok) {
        throw new Error(response.result.error.message, { cause: response.result.error.code })
      }
    } catch (error) {
      // A stale revision means someone else wrote the namespace: reload first
      // so the page's next attempt merges over the newest stored list.
      if ((error as { cause?: unknown }).cause === 'settings-conflict') {
        await this.load()
      }
      this.store.update((current) => {
        current.error = messageOf(error)
      })
      return
    } finally {
      this.store.update((current) => {
        current.writing = current.writing.filter(entry => entry !== name)
      })
    }
    await this.load()
  }
}
