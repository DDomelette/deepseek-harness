import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { expect, it, onTestFinished, vi } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import SessionFlagRegistry from '../../session-flags/src/index.ts'
import SessionPinsService, { sessionPinsDomainSpec } from '../src/index.ts'

it('closes a pins domain returned after disposal without leaving a flag provider, then reloads', async () => {
  const ctx = new Context()
  const release = Promise.withResolvers<undefined>()
  onTestFinished(async () => {
    release.resolve(undefined)
    await ctx.fiber.dispose()
    vi.restoreAllMocks()
  })
  await ctx.plugin(Storage).await()
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  onTestFinished(() => facility.closeAll())
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionFlagRegistry).await()
  const register = vi.spyOn(ctx.sessionFlags, 'registerProvider')
  const open = facility.open.bind(facility)
  const acquired = Promise.withResolvers<undefined>()
  vi.spyOn(facility, 'open').mockImplementationOnce(async (spec) => {
    const domain = await open(spec)
    acquired.resolve(undefined)
    await release.promise
    return domain
  })
  const instances: SessionPinsService[] = []
  class ObservedPins extends SessionPinsService {
    constructor(context: Context) {
      super(context)
      instances.push(this)
    }
  }
  const owner = ctx.plugin(ObservedPins)
  await acquired.promise
  const cancelled = instances[0]!
  expect(cancelled.ready).toBe(false)
  const disposal = owner.dispose()
  expect(owner.uid).toBeNull()
  release.resolve(undefined)
  await disposal
  expect(cancelled.ready).toBe(false)
  expect(register).not.toHaveBeenCalled()

  const reopened = await open(sessionPinsDomainSpec)
  await reopened.close()
  const reloaded = ctx.plugin(SessionPinsService)
  await reloaded.await()
  const pins = ctx.sessionPins
  expect(pins.ready).toBe(true)
  expect(register).toHaveBeenCalledOnce()
  await ctx.sessionPins.setPinned({ sessionId: 'pinned', pinned: true })
  expect(ctx.sessionFlags.snapshot()).toEqual({ flags: { pinned: { pinned: true } }, complete: true })
  await reloaded.dispose()
  expect(pins.ready).toBe(false)
  expect(ctx.sessionFlags.snapshot()).toEqual({ flags: {}, complete: true })
  const afterReload = await open(sessionPinsDomainSpec)
  await afterReload.close()
})
