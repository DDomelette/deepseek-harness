import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as SkillSettings from '../src/index.ts'

/** A provider implementing only the three primitives: the Service Definition owns initialization. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const BOTH = { modelInvocable: true, userInvocable: true }
const NEITHER = { modelInvocable: false, userInvocable: false }

async function boot(doc: Record<string, unknown> = {}): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  ctx.skills.register({ name: 'demo-skill', description: 'Demo', source: 'runtime', content: 'Demo body.' })
  await ctx.plugin(MemorySettings, { doc })
  const fiber = ctx.plugin(SkillSettings)
  await fiber
  return { ctx, fiber }
}

describe('dsh-skill-settings plugin exports', () => {
  it('declares stable plugin metadata', () => {
    expect(SkillSettings.name).toBe('skill-settings')
    expect(SkillSettings.inject).toEqual(['skills'])
    expect(SkillSettings.SKILL_SETTINGS_NAMESPACE).toBe('skills')
  })
})

describe('dsh-skill-settings', () => {
  it('disables configured skills through the registry override and reverts live', async () => {
    const { ctx } = await boot()
    const changes = vi.fn()
    ctx.on('skills/change', changes)
    const emittedBefore = changes.mock.calls.length
    expect((await ctx.skills.list())[0]?.invocation).toEqual(BOTH)

    await ctx.settings.update(SkillSettings.SKILL_SETTINGS_NAMESPACE, { disabled: ['demo-skill'] })
    expect((await ctx.skills.list())[0]?.invocation).toEqual(NEITHER)
    expect((await ctx.skills.get('demo-skill'))?.invocation).toEqual(NEITHER)
    // A committed override change is a catalog invalidation: consumers with
    // held catalogs refetch on the notification.
    expect(changes.mock.calls.length).toBeGreaterThan(emittedBefore)

    await ctx.settings.update(SkillSettings.SKILL_SETTINGS_NAMESPACE, { disabled: [] })
    expect((await ctx.skills.list())[0]?.invocation).toEqual(BOTH)
  })

  it('notifies every catalog observer when an earlier listener throws', async () => {
    const { ctx } = await boot()
    const reached = vi.fn()
    ctx.on('skills/change', () => { throw new Error('observer failed') })
    ctx.on('skills/change', reached)

    await ctx.settings.update(SkillSettings.SKILL_SETTINGS_NAMESPACE, { disabled: ['demo-skill'] })
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
    const { ctx } = await boot()
    await expect(ctx.settings.update(SkillSettings.SKILL_SETTINGS_NAMESPACE, { disabled: ['not a name'] }))
      .rejects.toThrow(/not a valid skill name/)
    expect((await ctx.skills.list())[0]?.invocation).toEqual(BOTH)
  })

  it('releases its override registration when the fiber unloads', async () => {
    const { ctx, fiber } = await boot({ skills: { disabled: ['demo-skill'] } })
    const changes = vi.fn()
    ctx.on('skills/change', changes)
    expect((await ctx.skills.list())[0]?.invocation).toEqual(NEITHER)
    expect(() => ctx.skills.registerInvocationOverride(() => undefined)).toThrow('already registered')

    await fiber.dispose()

    expect(changes).toHaveBeenCalledTimes(1)
    expect((await ctx.skills.list())[0]?.invocation).toEqual(BOTH)
    const dispose = ctx.skills.registerInvocationOverride(() => undefined)
    dispose()
  })
})
