/** Explicit deletion shares writer exclusion and removes every readable generation. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionAlreadyOwnedError, SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '../src/index.ts'
import { generationLogPath, sessionDir } from '../src/format.ts'
import { LEASE_FILENAME, SessionWriteLease } from '../src/lease.ts'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function mount(root?: string) {
  if (root === undefined) {
    root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-deletion-'))
    roots.push(root)
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return { root, ctx, persistence: ctx.sessionPersistence }
}

describe('explicit JSONL deletion', () => {
  it('removes a historical session after read-only migration without publishing a successor', async () => {
    const { root, persistence } = await mount()
    const header = meta('historical-deletion', '/project')
    const dir = sessionDir(root, header.cwd, header.id)
    await mkdir(dir, { recursive: true })
    const source = generationLogPath(root, header.cwd, header.id, 1, 'none')
    const bytes = `${JSON.stringify({
      type: 'session', version: 1, id: header.id, createdAt: header.createdAt,
      cwd: header.cwd, delegationDepth: 0,
    })}\n`
    await writeFile(source, bytes)
    const reader = await persistence.open(header.id, 'read')
    try {
      expect((await reader.read()).events).toEqual([])
      expect(await readFile(source, 'utf8')).toBe(bytes)
      await expect(readFile(generationLogPath(root, header.cwd, header.id, header.version, 'none')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await reader.close()
    }
    await persistence.delete(header.id)
    expect((await readdir(dir)).filter(name => name !== LEASE_FILENAME)).toEqual([])
    await expect(persistence.open(header.id, 'write')).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
    const replacement = await persistence.create(header)
    try {
      await replacement.append(oneTurnLog())
      expect((await replacement.read()).events).toEqual(oneTurnLog())
    } finally {
      await replacement.close()
    }
  })

  it('refuses both local and independent writers before changing any artifact', async () => {
    const { root, persistence } = await mount()
    const second = await mount(root)
    const header = meta('owned', '/project')
    const writer = await persistence.create(header)
    await writer.append(oneTurnLog())
    await writer.flush()
    const path = generationLogPath(root, header.cwd, header.id, header.version, 'none')
    const before = await readFile(path)
    try {
      await expect(persistence.delete(header.id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
      await expect(second.persistence.delete(header.id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
      expect(await readFile(path)).toEqual(before)
    } finally {
      await writer.close()
    }
    await second.persistence.delete(header.id)
    await expect(persistence.open(header.id, 'write')).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
  })

  it('removes attachments and every generation without exposing a predecessor on reread', async () => {
    const { root, persistence } = await mount()
    const header = meta('generations', '/project')
    const writer = await persistence.create(header)
    await writer.append(oneTurnLog())
    await writer.close()
    const current = generationLogPath(root, header.cwd, header.id, header.version, 'none')
    const dir = sessionDir(root, header.cwd, header.id)
    await writeFile(generationLogPath(root, header.cwd, header.id, 1, 'none'), await readFile(current))
    await mkdir(join(dir, 'attachments'))
    await writeFile(join(dir, 'attachments', 'asset.txt'), 'owned attachment')
    await persistence.delete(header.id)
    expect((await readdir(dir)).filter(name => name !== LEASE_FILENAME)).toEqual([])
    expect(await persistence.list()).toEqual([])
    await expect(persistence.open(header.id, 'read')).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
    await expect(persistence.delete(header.id)).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
  })

  it('keeps an independent writer excluded until deletion releases its lease', async () => {
    const { root, persistence } = await mount()
    const second = await mount(root)
    const header = meta('deletion-race', '/project')
    const writer = await persistence.create(header)
    await writer.append(oneTurnLog())
    await writer.close()
    const held = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const acquire = SessionWriteLease.acquire.bind(SessionWriteLease)
    vi.spyOn(SessionWriteLease, 'acquire').mockImplementationOnce(async (...args) => {
      const lease = await acquire(...args)
      held.resolve(undefined)
      await proceed.promise
      return lease
    })
    const deletion = persistence.delete(header.id)
    try {
      await held.promise
      await expect(second.persistence.open(header.id, 'write')).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    } finally {
      proceed.resolve(undefined)
      await deletion
    }
    await expect(second.persistence.open(header.id, 'write')).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
  })
})
