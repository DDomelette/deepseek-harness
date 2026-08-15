/** Skills settings section registration: slot injection, locale-following label, and disposal. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-skills/client'
import { SkillsSection } from '../src/client/SkillsSection.tsx'

usePinnedBrowserLanguages('zh-CN')

async function bench(): Promise<{
  ctx: Context
  slots: SlotRegistry
  locale: LocaleRuntime
  sessionsListeners: Set<() => void>
  setCurrentSession: (id: string | undefined) => void
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  new TestRemote(ctx)
  ctx.provide('connection', { api: {}, isLoopback: true } as never)
  const sessionsListeners = new Set<() => void>()
  let currentSession: string | undefined
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ current: currentSession }),
      subscribe: (listener: () => void) => {
        sessionsListeners.add(listener)
        return () => { sessionsListeners.delete(listener) }
      },
    },
  } as never)
  return {
    ctx,
    slots: ctx.get('slots') as SlotRegistry,
    locale,
    sessionsListeners,
    setCurrentSession: (id) => { currentSession = id },
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-skills apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'sessions', 'remote'])
  })

  it('registers the skills nav entry for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(SkillsSection)
    expect(entry.options).toMatchObject({ id: 'skills', order: 30 })
    expect(resolveSlotLabel(entry.options.label)).toBe('技能')
    const injected = entry.inject as unknown as () => import('../src/client/SkillsSection.tsx').SkillsSectionInjected
    expect(typeof injected().load).toBe('function')
    expect(typeof injected().setEnabled).toBe('function')
    expect(injected().hooks.skills.getSnapshot().status).toBe('idle')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')[0]!.component).toBe(SkillsSection)
    expect(after.slots.entries('settings.section')).toHaveLength(1)
  })

  it('the label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Skills')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('技能')
  })

  it('registers the zh/en nav dictionaries and disposes everything with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings.skills')('nav')).toBe('技能')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(() => b.locale.register('settings.skills', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings.skills', 'en', {})).not.toThrow()
  })

  it('ignores pushed invalidations before the page ever loaded', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.ctx.remote.$dispatch('skills/change', [])
    b.ctx.emit('connection/reset')
  })

  it('refreshes a loaded page on catalog, connection, and active composition changes only', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = entry.inject as unknown as () => import('../src/client/SkillsSection.tsx').SkillsSectionInjected
    const { hooks, load } = injected()
    // The first load reaches the session-id thunk before the intentionally
    // incomplete bench API fails; a ready snapshot then opens refreshes.
    await load().catch(() => undefined)
    hooks.skills.update((state) => { state.status = 'ready' })
    const subscribe = vi.spyOn(hooks.skills, 'getSnapshot')

    b.ctx.remote.$dispatch('skills/change', [])
    expect(subscribe).toHaveBeenCalledTimes(1)
    b.ctx.emit('connection/reset')
    expect(subscribe).toHaveBeenCalledTimes(2)
    for (const listener of b.sessionsListeners) listener()
    expect(subscribe).toHaveBeenCalledTimes(2)
    b.setCurrentSession('sk-apply-next')
    for (const listener of b.sessionsListeners) listener()
    expect(subscribe).toHaveBeenCalledTimes(3)
    b.ctx.remote.$dispatch('agent-preset/selected', ['sk-other', 'cordis'])
    expect(subscribe).toHaveBeenCalledTimes(3)
    b.ctx.remote.$dispatch('agent-preset/selected', ['sk-apply-next', 'cordis'])
    expect(subscribe).toHaveBeenCalledTimes(4)
  })
})
