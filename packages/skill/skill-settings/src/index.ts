/**
 * User-level skill enablement overrides.
 *
 * This package owns the settings-backed invocation override for the skill
 * capability seam: its entry declares the live `disabled` roster (a list of
 * skill names) and pushes it into the registry's invocation override slot, so
 * every consumer — the model catalog, the `skill` tool, the `/name` gesture,
 * and configuration listings — agrees on which skills are off. Disabling is
 * total: a listed skill is neither model- nor user-invocable.
 *
 * @module @deepseek-ai/dsh-skill-settings
 */

import { Context, FiberState, type Fiber, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { isSkillName, type SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a
     * remount. Declared here because this package does not load the Loader's
     * own event declarations; a Loader that declares it merges as an identical
     * overload.
     * @mode emit
     * @param paths - changed paths, each an array of object keys.
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

export const name = 'skill-settings'
export const inject = ['skills']

/** Settings namespace carrying the user-disabled skill names (the Loader entry id). */
export const SKILL_SETTINGS_NAMESPACE = 'skill-settings'

/** Runtime settings section: skill names the user switched off. */
export interface Config {
  /** Disabled skill names; disabling is total (neither model nor user invocation). */
  disabled: Volatile<string[]>
}

/** Live section; the entry id `skill-settings` is the settings namespace. */
export const Config = z.object({
  disabled: z.array(z.string()).default([]).volatile(),
}) as unknown as z<Config>

const DISABLED_POLICY: SkillInvocationPolicy = { modelInvocable: false, userInvocable: false }

/**
 * Refuse a section naming an entry that is not a skill name. The grammar is not
 * expressible in the schema's own string type, so the check runs where the
 * candidate config is validated: a settings write fails before it is persisted.
 * @param section - candidate live section.
 * @throws Error naming the offending entry.
 */
function assertSkillNames(section: Config): void {
  for (const entry of section.disabled.get()) {
    if (!isSkillName(entry)) {
      throw new Error(`skill-settings: disabled entry "${entry}" is not a valid skill name`)
    }
  }
}

/**
 * Register the settings-backed invocation override on the skill registry.
 * The override reads the live disabled set, so a committed settings change
 * takes effect on the next catalog read without registry invalidation.
 * @param ctx - plugin context carrying the skill registry.
 * @param config - the entry's live section.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(
    () => ctx.skills.registerInvocationOverride(skill => config.disabled.get().includes(skill) ? DISABLED_POLICY : undefined),
    'skill-settings: invocation override',
  )
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  // A settings write commits a candidate config through this waterfall before
  // it is persisted. Only an active fiber is a write: activation accepts
  // whatever the composition stores, because a section that predates this
  // owner is the stored-section backstop's case.
  ctx.on('internal/config', function (this: Fiber, _raw, next) {
    const candidate = next()
    if (this.state !== FiberState.ACTIVE) return candidate
    assertSkillNames(Config(candidate))
    return candidate
  })
  // A volatile-only commit replaces the running section reference in place, so
  // the override's answers change without a re-registration: the registry's own
  // disposer never runs, and the notification must come from the commit.
  ctx.on('loader/volatile-update', () => { ctx.skills.notifyInvocationOverrideChange() })
}
