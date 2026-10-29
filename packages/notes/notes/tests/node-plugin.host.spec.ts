/**
 * The notes host half: the entry activates once its storage domain facility is
 * present, publishes its services, and releases both the Loader seat and the
 * domain name on dispose.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { notesDomainSpec } from '../src/domain.ts'
import { Config, apply, inject, name } from '../src/index.ts'
import { noteId, published } from './bench.ts'
import { FakeAgents } from './bench.ts'

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('notes host half', () => {
  it('activates over a real storage stack and frees its domain on dispose', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-notes-plugin-'))
    const host = new Context()
    ctx = host
    await host.plugin(Storage).await()
    await host.plugin(StorageJson, { root }).await()
    await host.plugin(StorageDomain, { backend: 'json' }).await()
    // The conversation store injects `agents`, which the shipped composition
    // supplies from its own host row; this spec stands one in.
    host.provide('agents', new FakeAgents() as never)

    const mounted = host.plugin({ name, apply, inject, Config }, Config(undefined))
    await mounted.await()
    expect(mounted.state).toBe(FiberState.ACTIVE)
    // The mounted services open the domain asynchronously, so the plugin fiber
    // settling is not yet their availability.
    await published(() => host.get('notesSessions'), 'notesSessions')
    await published(() => host.get('notesMaterials'), 'notesMaterials')
    expect(host.notesSessions.list()).toEqual([])
    expect(host.notesMaterials.list(noteId('n1'))).toEqual([])

    await mounted.dispose()
    expect(mounted.state).toBe(FiberState.DISPOSED)
    // The domain name is released, so this context can open it again.
    const reopened = await host.storageDomain.open(notesDomainSpec)
    await reopened.close()
  })

  it('stays inactive while the storage domain facility is absent', async () => {
    ctx = new Context()
    const mounted = ctx.plugin({ name, apply, inject, Config }, Config(undefined))
    await Promise.resolve()
    expect(mounted.state).not.toBe(FiberState.ACTIVE)
    await mounted.dispose()
  })
})
