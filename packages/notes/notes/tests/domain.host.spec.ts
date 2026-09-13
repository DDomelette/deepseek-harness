/**
 * The notes domain opens over a real storage stack, round-trips one material
 * record, and frees the domain name on close so a later open succeeds.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { NOTES_DOMAIN_NAME, notesDomainSpec } from '../src/domain.ts'
import { material, materialId, noteId, noteSession, sessionId } from './bench.ts'

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Mount the storage stack the domain needs. */
async function storageStack(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-notes-domain-'))
  const created = new Context()
  await created.plugin(Storage).await()
  await created.plugin(StorageJson, { root }).await()
  await created.plugin(StorageDomain, { backend: 'json' }).await()
  ctx = created
  return created
}

describe('notes domain', () => {
  it('opens, round-trips a material, and frees the name on close', async () => {
    const created = await storageStack()
    const domain = await created.storageDomain.open(notesDomainSpec)
    expect(domain.name).toBe(NOTES_DOMAIN_NAME)

    const id = materialId('m1')
    const record = material({ noteId: noteId('n1'), text: 'hello' })
    await domain.table('materials').put(id, record)
    expect(domain.table('materials').get(id)?.text).toBe('hello')

    await domain.close()
    const reopened = await created.storageDomain.open(notesDomainSpec)
    expect(reopened.table('materials').get(id)?.text).toBe('hello')
    await reopened.close()
  })

  it('brands the stored ids back at the durable read boundary', async () => {
    const created = await storageStack()
    const domain = await created.storageDomain.open(notesDomainSpec)
    await domain.table('sessions').put(noteId('n1'), noteSession({ sessionId: sessionId('s1'), createdAt: 7 }))
    // Stored plain strings come back branded, so a record read from the medium
    // is usable everywhere the branded id is required.
    expect(domain.table('sessions').get(noteId('n1'))?.sessionId).toBe('s1')
    await domain.close()
  })
})
