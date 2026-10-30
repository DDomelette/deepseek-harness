import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { expect, it, onTestFinished, vi } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { notesDomainSpec } from '../src/domain.ts'
import { NotesStore } from '../src/store.ts'

it('closes a notes domain returned after disposal and allows the owner to reload', async () => {
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
  const open = facility.open.bind(facility)
  const acquired = Promise.withResolvers<undefined>()
  vi.spyOn(facility, 'open').mockImplementationOnce(async (spec) => {
    const domain = await open(spec)
    acquired.resolve(undefined)
    await release.promise
    return domain
  })
  const owner = ctx.plugin(NotesStore)
  await acquired.promise
  const disposal = owner.dispose()
  expect(owner.uid).toBeNull()
  release.resolve(undefined)
  await disposal

  const reopened = await open(notesDomainSpec)
  await reopened.close()
  const reloaded = ctx.plugin(NotesStore)
  await reloaded.await()
  expect([...ctx.notesStore.materials.entries()]).toEqual([])
  await reloaded.dispose()
  const afterReload = await open(notesDomainSpec)
  await afterReload.close()
})
