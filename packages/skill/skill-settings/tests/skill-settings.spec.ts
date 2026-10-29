import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillSettings from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'

const BOTH = { modelInvocable: true, userInvocable: true }
const NEITHER = { modelInvocable: false, userInvocable: false }

/** Mount the skill registry plus the settings-declaring plugin under one Loader. */
async function boot(initial: object = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SkillRegistry)
  ctx.skills.register({ name: 'demo-skill', description: 'Demo', source: 'runtime', content: 'Demo body.' })
  const configuration = await liveConfig(ctx, SkillSettings, initial)
  return { ctx, configuration }
}

describe('dsh-skill-settings plugin exports', () => {
  it('declares stable plugin metadata', () => {
    expect(SkillSettings.name).toBe('skill-settings')
    expect(SkillSettings.inject).toEqual(['skills'])
    expect(SkillSettings.SKILL_SETTINGS_NAMESPACE).toBe('skill-settings')
  })
})

describe('dsh-skill-settings', () => {
  it('keeps its instance off generated Settings pages and withdraws the policy on disposal', () =>
    omitsGeneratedPage(async (ctx) => {
      onTestFinished(() => ctx.fiber.dispose())
      await ctx.plugin(SkillRegistry)
      return ctx.plugin(SkillSettings)
    }))

  it('does not validate a pending Fiber configuration as a live settings write', async () => {
    const { configuration } = await boot()
    const ctx = configuration.fiber.ctx
    const pending = ctx.plugin({ name: 'pending-config-probe', inject: ['unavailable'], apply() {} })
    await pending.await()
    const stored = { disabled: ['stored legacy name'] }
    expect(ctx.waterfall(pending, 'internal/config', stored, () => stored)).toBe(stored)
  })

  it('disables configured skills through the registry override and reverts live', async () => {
    const { ctx, configuration } = await boot()
    const changes = vi.fn()
    ctx.on('skills/change', changes)
    const emittedBefore = changes.mock.calls.length
    expect((await ctx.skills.list())[0]?.invocation).toEqual(BOTH)

    await configuration.update({ disabled: ['demo-skill'] })
    expect(plainConfig(configuration.fiber.config)).toEqual({ disabled: ['demo-skill'] })
    expect((await ctx.skills.list())[0]?.invocation).toEqual(NEITHER)
    expect((await ctx.skills.get('demo-skill'))?.invocation).toEqual(NEITHER)
    // A committed override change is a catalog invalidation: consumers with
    // held catalogs refetch on the notification.
    expect(changes.mock.calls.length).toBeGreaterThan(emittedBefore)

    await configuration.update({ disabled: [] })
    expect((await ctx.skills.list())[0]?.invocation).toEqual(BOTH)
  })

  it('notifies every catalog observer when an earlier listener throws', async () => {
    const { ctx, configuration } = await boot()
    const reached = vi.fn()
    ctx.on('skills/change', () => { throw new Error('observer failed') })
    ctx.on('skills/change', reached)

    await configuration.update({ disabled: ['demo-skill'] })
    await Promise.resolve()

    expect(reached).toHaveBeenCalled()
    expect((await ctx.skills.list())[0]?.invocation).toEqual(NEITHER)
  })

  it('leaves the catalog untouched while no settings service is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({ name: 'demo-skill', description: 'Demo', source: 'runtime', content: 'Demo body.' })
    const fiber = ctx.plugin(SkillSettings)
    await fiber
    expect((await ctx.skills.list())[0]?.invocation).toEqual(BOTH)
    await fiber.dispose()
  })

  it('rejects disabled entries that are not valid skill names', async () => {
    const { ctx, configuration } = await boot()
    await expect(configuration.update({ disabled: ['not a name'] }))
      .rejects.toThrow(/not a valid skill name/)
    expect((await ctx.skills.list())[0]?.invocation).toEqual(BOTH)
  })

  it('releases its override registration when the fiber unloads', async () => {
    const { ctx, configuration } = await boot({ disabled: ['demo-skill'] })
    const changes = vi.fn()
    ctx.on('skills/change', changes)
    expect((await ctx.skills.list())[0]?.invocation).toEqual(NEITHER)
    expect(() => ctx.skills.registerInvocationOverride(() => undefined)).toThrow('already registered')

    await configuration.fiber.dispose()

    expect(changes).toHaveBeenCalled()
    expect((await ctx.skills.list())[0]?.invocation).toEqual(BOTH)
    const dispose = ctx.skills.registerInvocationOverride(() => undefined)
    dispose()
  })
})
