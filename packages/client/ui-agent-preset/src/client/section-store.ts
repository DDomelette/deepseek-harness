/**
 * Agent-preset management controller: the roster as a list and a read-only
 * viewer over the shipped compositions.
 *
 * A deployment's presets are declared in its own composition files, outside
 * the browser, so this page offers no way to create, edit, or remove one. The
 * host stays the single fact source; every write goes through the wire and the
 * page re-reads the roster afterwards.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { loadRoster, writeDefaultPreset } from './settings-store.ts'

/** One preset row the page renders, exactly as the host reports it. */
export type PresetRow = AgentPresetRow

/** The read-only composition viewer over one shipped preset. */
export interface PresetView {
  /** The preset whose composition is shown. */
  id: string
  /** Display name, for the dialog title. */
  title: string
  /** Composition text exactly as stored. */
  content: string
}

/** Page snapshot. */
export interface AgentPresetSectionState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** Every preset the deployment currently supplies. */
  rows: readonly PresetRow[]
  /** The open read-only viewer, or null. */
  view: PresetView | null
}

const INITIAL: AgentPresetSectionState = {
  status: 'idle',
  error: null,
  rows: [],
  view: null,
}

/** Reads the roster and drives the viewer. */
export class AgentPresetSectionController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSectionState> = createSnapshotStore(INITIAL)

  /**
   * @param ctx - the browser plugin context.
   */
  constructor(
    private readonly ctx: ClientContext,
  ) {}

  private set(patch: Partial<AgentPresetSectionState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Load the roster. An empty roster means the deployment composes no
   * presets, which is a valid deployment rather than a failure — the section
   * reports `unavailable` and renders nothing.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    // Nothing to manage leaves nothing to keep a dialog open over.
    await loadRoster(this.ctx, this.store, presets => (presets.length === 0
      ? { status: 'unavailable', rows: [], view: null }
      : { status: 'ready', error: null, rows: presets.map(preset => ({ ...preset })) }))
  }

  /**
   * Open one shipped preset's composition in the read-only viewer.
   * @param id - the preset to view.
   * @returns once the composition loaded or the failure is on the page.
   */
  async view(id: string): Promise<void> {
    this.set({ error: null })
    const result = await this.ctx.remote.agentPresets.read(id)
    if (!result.ok) {
      this.set({ error: result.error.message })
      return
    }
    const { name, content } = result.value
    this.set({ view: { id, title: name ?? id, content } })
  }

  /** Close the read-only viewer. */
  closeView(): void {
    this.set({ view: null })
  }

  /**
   * Make one preset the default for sessions created later. Running sessions
   * keep the composition they began with, so this never disturbs work.
   * @param id - the preset to make default.
   * @returns once the write settled and the roster was re-read.
   */
  async makeDefault(id: string): Promise<void> {
    const failure = await writeDefaultPreset(this.ctx, id)
    if (failure !== undefined) {
      this.set({ error: failure })
      return
    }
    await this.load()
  }
}
