/**
 * The usage-telemetry card's staged switch over the `usage-telemetry` settings
 * namespace. Only the `enabled` leaf is written; the capture service applies
 * committed changes without a restart.
 */

import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { CardActions, CardShell } from './card-form.ts'

/** Namespace of the local usage recorder. Spelled here: a client package must not depend on a Host package. */
export const USAGE_TELEMETRY_NS = 'usage-telemetry'

/** The section fields this card edits. */
export interface UsageTelemetrySettings {
  /** Whether local usage capture listens to `llm/stream`. */
  enabled?: boolean
}

/** What the usage-telemetry card renders. */
export interface UsageTelemetryCardState extends CardShell {
  /** Effective enablement served by the Host. */
  enabled: boolean
  /** The staged switch value; equals `enabled` while the card is clean. */
  draft: boolean
}

/** The registration-side face the usage-telemetry card's slot entry injects. */
export interface UsageTelemetryCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useUsageTelemetryCard. */
    usageTelemetryCard: SnapshotStore<UsageTelemetryCardState>
  }
}

/** Bridges the `usage-telemetry` scope onto the card's single switch. */
export class UsageTelemetryCardController {
  /** uSES-safe state source shared by the registered card. */
  readonly store: SnapshotStore<UsageTelemetryCardState>

  private draft: boolean | undefined
  private saving = false
  private failed = false

  /**
   * @param scope - the bound settings scope for the `usage-telemetry` namespace.
   */
  constructor(private readonly scope: SettingsScope<UsageTelemetrySettings>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.store.set(this.projection()) })
    this.store.set(this.projection())
  }

  /** Effective value when no draft is staged. */
  private effective(): boolean {
    return this.scope.getSnapshot().value?.enabled ?? true
  }

  private projection(): UsageTelemetryCardState {
    const snapshot = this.scope.getSnapshot()
    const draft = this.draft ?? this.effective()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.draft !== undefined,
      invalid: false,
      saving: this.saving,
      failed: this.failed,
      enabled: this.effective(),
      draft,
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its staged edit actions.
   */
  inject(): UsageTelemetryCardFace {
    return {
      hooks: { usageTelemetryCard: this.store },
      edit: (field, text) => {
        if (field !== 'enabled') throw new Error(`usage telemetry card has no field ${field}`)
        this.draft = text === 'true'
        this.failed = false
        this.store.set(this.projection())
      },
      resetField: (field) => {
        if (field !== 'enabled') throw new Error(`usage telemetry card has no field ${field}`)
        this.draft = (this.scope.getSnapshot().base as UsageTelemetrySettings | undefined)?.enabled ?? true
        this.failed = false
        this.store.set(this.projection())
      },
      save: () => { void this.save() },
      discard: () => {
        this.draft = undefined
        this.failed = false
        this.store.set(this.projection())
      },
    }
  }

  /**
   * Write the staged switch, then re-read whether the Host accepted it.
   * The Host is the authority: a read-only document or a settings conflict
   * leaves the draft in place for the user to retry or discard.
   */
  private async save(): Promise<void> {
    const draft = this.draft
    if (draft === undefined || this.saving) return
    this.saving = true
    this.failed = false
    this.store.set(this.projection())
    let accepted = false
    try {
      await this.scope.set('enabled', draft)
      accepted = this.scope.getSnapshot().value?.enabled === draft
    } catch {
      accepted = false
    }
    if (accepted) this.draft = undefined
    this.saving = false
    this.failed = !accepted
    this.store.set(this.projection())
  }
}
