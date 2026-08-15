/**
 * User-level skill enablement overrides.
 *
 * This package owns the settings-backed invocation override for the skill
 * capability seam: it registers the `skills` settings namespace (a list of
 * disabled skill names) and pushes it into the registry's invocation
 * override slot, so every consumer — the model catalog, the `skill` tool,
 * the `/name` gesture, and configuration listings — agrees on which skills
 * are off. Disabling is total: a listed skill is neither model- nor
 * user-invocable.
 *
 * @module @deepseek-ai/dsh-skill-settings
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { isSkillName, type SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'

export const name = 'skill-settings'
export const inject = ['skills']

/** Settings namespace carrying the user-disabled skill names. */
export const SKILL_SETTINGS_NAMESPACE = settingsNamespace('skills')

/** Resolved settings section: skill names the user switched off. */
export interface SkillSettingsSection {
  /** Disabled skill names; disabling is total (neither model nor user invocation). */
  disabled: string[]
}

const skillSettingsSchema: z<SkillSettingsSection> = z.object({
  disabled: z.array(z.string()).default([]),
})

const DISABLED_POLICY: SkillInvocationPolicy = { modelInvocable: false, userInvocable: false }

/**
 * Register the settings-backed invocation override on the skill registry.
 * The override reads the live disabled set, so committed settings changes
 * take effect on the next catalog read without registry invalidation. The
 * settings wiring is optional: without a settings service the override
 * resolves nothing and the catalog behaves exactly as composed.
 * @param ctx - plugin context carrying the skill registry.
 */
export function apply(ctx: Context): void {
  let disabled: ReadonlySet<string> = new Set()
  ctx.effect(
    () => ctx.skills.registerInvocationOverride(skill => disabled.has(skill) ? DISABLED_POLICY : undefined),
    'skill-settings: invocation override',
  )

  let current: (() => SkillSettingsSection) | undefined
  installSettingsSection(ctx, SKILL_SETTINGS_NAMESPACE, skillSettingsSchema, { disabled: [] }, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // The settings wiring installs setSource before the first onChange;
      // the empty fallback keeps a detached service from leaving stale names.
      // v8 ignore next -- installSettingsSection guarantees setSource first.
      disabled = new Set(current?.().disabled ?? [])
      // A committed override change is a catalog invalidation for every
      // consumer holding a catalog (menus, panels): notify the registry's
      // unfiltered change event so they refetch.
      ctx.skills.notifyInvocationOverrideChange()
    },
    validate: (value) => {
      for (const entry of value.disabled) {
        if (!isSkillName(entry)) {
          throw new Error(`skill-settings: disabled entry "${entry}" is not a valid skill name`)
        }
      }
    },
  })
}
