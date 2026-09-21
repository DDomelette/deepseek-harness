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
import { NOTES_DOMAIN_NAME, materialRecord, notesDomainSpec } from '../src/domain.ts'
import {
  imageRef, material, materialId, messageId, noteId, noteSession, sessionId, sessionSeq, source,
} from './bench.ts'

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
    // Every optional source field carries a value, so the reopen exercises each
    // brand-minting schema at the durable read boundary rather than only the
    // null path.
    const record = material({
      noteId: noteId('n1'),
      text: 'hello',
      source: source({ messageId: messageId('m-7'), seq: sessionSeq(7) }),
    })
    await domain.table('materials').put(id, record)
    expect(domain.table('materials').get(id)?.text).toBe('hello')

    await domain.close()
    const reopened = await created.storageDomain.open(notesDomainSpec)
    const stored = reopened.table('materials').get(id)
    expect(stored?.text).toBe('hello')
    expect(stored?.source.messageId).toBe('m-7')
    expect(stored?.source.seq).toBe(7)
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

  it('reads a record written before the title field existed', async () => {
    const created = await storageStack()
    const domain = await created.storageDomain.open(notesDomainSpec)
    const id = materialId('m1')
    // Writes are not schema-checked, so this stores the bytes a pre-title
    // build wrote: the record without the key.
    const legacy = JSON.parse(JSON.stringify(material({ noteId: noteId('n1') }))) as Record<string, unknown>
    delete legacy['title']
    await domain.table('materials').put(id, legacy as never)
    await domain.close()

    const reopened = await created.storageDomain.open(notesDomainSpec)
    const stored = reopened.table('materials').get(id)
    expect(stored?.text).toBe('body')
    expect(stored?.title).toBeNull()
    await reopened.close()
  })

  it('round-trips a screenshot reference and refuses a bare attachment id', async () => {
    const created = await storageStack()
    const domain = await created.storageDomain.open(notesDomainSpec)
    const id = materialId('m1')
    await domain.table('materials').put(id, material({
      noteId: noteId('n1'),
      kind: 'image',
      text: null,
      image: imageRef(),
    }))

    await domain.close()
    const reopened = await created.storageDomain.open(notesDomainSpec)
    expect(reopened.table('materials').get(id)?.image).toEqual(imageRef())
    await reopened.close()

    // The reference is the request part's shape: an id alone cannot name the
    // media type, byte length, and dimensions a model request needs, so a
    // version-1 record is refused rather than read as an unusable reference.
    const versionOne = { ...material({ noteId: noteId('n1') }), image: 'attachment-1' }
    expect(materialRecord.safeParse(versionOne).success).toBe(false)
  })
})
