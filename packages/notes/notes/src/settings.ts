/**
 * The notes settings section and the host owner that reads it.
 *
 * Every deployment-varying choice lives here rather than in a constant: the
 * model-call strategy, the prompt template of each collection action, the
 * workspace, and the optional model override. The composition entry is the
 * base layer, so a cordis row can ship defaults without code, and a mounted
 * settings provider layers the user's document over it.
 * @module @deepseek-ai/dsh-notes/settings
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'

/** Settings namespace owned by this plugin. */
export const NOTES_SETTINGS_NAMESPACE = 'notes'

/** One collection action: the bubble entry and the prompt it prepends. */
export interface ActionDef {
  /** Stable action id, stored as the material's `action`. */
  readonly id: string
  /** Localized label the selection bubble shows. */
  readonly label: string
  /** Prompt text prepended to the material body before submission. */
  readonly prompt: string
  /** Whether picking the action analyses immediately, ignoring the strategy. */
  readonly autoSend: boolean
}

/** When a newly collected material is sent to the model. */
export type NotesStrategy = 'manual' | 'auto'

/** Composition entry, also the settings base layer. */
export interface Config {
  /** `manual` waits for an explicit analyse; `auto` analyses on collection. */
  readonly strategy: NotesStrategy
  /** Collection actions the selection bubble offers. */
  readonly actions: ActionDef[]
  /**
   * Absolute workspace path for notes conversations. Absent until first-run
   * setup has chosen one; schemastery reserves `null` as "no default", so
   * absence is `undefined` and the accessors report it as `null`.
   */
  readonly workspace?: string
  /**
   * Model override for notes conversations; absent follows the session default.
   * A nested literal rather than a named type, so the config catalog renders
   * both fields with their own prose.
   */
  readonly model?: {
    /** Registered provider route. */
    readonly provider: string
    /** Provider-owned model id. */
    readonly model: string
  }
}

const actionSchema: s<ActionDef> = s.object({
  id: s.string().required(),
  label: s.string().required(),
  prompt: s.string().required(),
  autoSend: s.boolean().default(false),
})

const modelSchema = s.object({
  provider: s.string().required(),
  model: s.string().required(),
})

/**
 * Loader validation for the notes cordis row; the same schema resolves the
 * settings section. The built-in translate action is a schema default rather
 * than a code constant, so a deployment replaces it from the composition file.
 */
export const Config: s<Config> = s.object({
  strategy: s.union(['manual', 'auto'] as const).default('manual'),
  actions: s.array(actionSchema).default([{
    id: 'translate',
    label: '翻译',
    prompt: '不改变语句结构，翻译下列内容：',
    autoSend: true,
  }]),
  workspace: s.string(),
  // A bare object schema defaults to `{}`, which would then fail the required
  // fields; the single-member union keeps the whole override skippable while
  // still validating a present one strictly.
  model: s.union([modelSchema]),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live notes settings. */
    notesSettings: NotesSettings
  }
}

/**
 * Reads the notes settings section for this plugin's own consumers.
 *
 * The settings service is not a declared injection: a deployment without one
 * must fall back to the composition entry rather than leave this service
 * pending forever. `installSection` restores that fallback when the provider
 * detaches.
 */
export class NotesSettings extends Service {
  private source: () => Config

  /**
   * @param ctx - host context.
   * @param entry - the row's validated composition entry, used as the base layer.
   */
  constructor(ctx: Context, entry: Config) {
    super(ctx, 'notesSettings')
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(ctx, NOTES_SETTINGS_NAMESPACE, Config, entry, {
        setSource: (source) => { this.source = source },
        // Consumers read through the accessors below on every use, so no
        // registration-level fact needs rebuilding when the document changes.
        onChange: () => {},
      })
    })
  }

  /**
   * Current model-call strategy.
   * @returns `manual` or `auto`.
   */
  strategy(): NotesStrategy {
    return this.source().strategy
  }

  /**
   * Collection actions the bubble offers.
   * @returns the configured actions.
   */
  actions(): readonly ActionDef[] {
    return this.source().actions
  }

  /**
   * Configured workspace path.
   * @returns the absolute path, or null before first-run setup.
   */
  workspace(): string | null {
    return this.source().workspace ?? null
  }

  /**
   * Configured model override.
   * @returns provider and model, or null to follow the session default.
   */
  model(): { provider: string; model: string } | null {
    return this.source().model ?? null
  }
}

export default NotesSettings
