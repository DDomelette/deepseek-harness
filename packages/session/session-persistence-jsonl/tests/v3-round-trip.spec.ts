/**
 * End-to-end acceptance for the released-V3 → V4 upgrade edge: a V3 parent plus
 * its V3 subagent child on disk must load as current V4 with the child's catalog
 * facts, and a write open must republish that same logical history as V4 while
 * leaving the released generation byte-identical.
 */

import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { generationLogPath } from '../src/format.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** One released V3 parent/child pair on disk; the parent generation's bytes and inode are the non-mutation witness. */
async function releasedV3Corpus() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-v3-round-trip-'))
  roots.push(root)
  const parent = SessionId('released-parent')
  const child = SessionId('released-child')
  const rows = (header: unknown, events: readonly unknown[]): string =>
    [header, ...events].map(row => JSON.stringify(row) + '\n').join('')
  const parentPath = generationLogPath(root, undefined, parent, 3, 'none')
  const childPath = generationLogPath(root, undefined, child, 3, 'none')
  await mkdir(dirname(parentPath), { recursive: true })
  await mkdir(dirname(childPath), { recursive: true })
  await writeFile(parentPath, rows(
    { type: 'session', version: 3, id: parent, createdAt: 1, isSeeded: false, delegationDepth: 0 },
    [
      { type: 'turn/start', seq: 0, time: 11, data: { turn: 1 } },
      { type: 'turn/end', seq: 1, time: 12, data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  ))
  await writeFile(childPath, rows(
    {
      type: 'session', version: 3, id: child, createdAt: 2, isSeeded: false, delegationDepth: 1,
      origin: 'subagent', parentSession: parent,
    },
    [{ type: 'subagent/descriptor', seq: 0, time: 21,
      data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'released child' } }],
  ))
  const info = await stat(parentPath, { bigint: true })
  return { root, parent, parentPath, source: await readFile(parentPath), ino: info.ino }
}

async function mount(root: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx
}

describe('released V3 round trip', () => {
  it('prepares a V3 parent and child as V4, then publishes one byte-stable successor', async () => {
    const corpus = await releasedV3Corpus()
    const ctx = await mount(corpus.root)
    expect((await ctx.sessionPersistence.stat(corpus.parent))?.formatStatus).toBe('migration-required')

    const reader = await ctx.sessionPersistence.open(corpus.parent, 'read')
    let prepared: readonly SessionEvent[]
    try {
      expect(reader.header.version).toBe(SESSION_FORMAT_VERSION)
      prepared = (await reader.read()).events
    } finally {
      await reader.close()
    }
    expect(prepared.filter(event => event.type === 'subagent/catalog')).toMatchObject([
      { data: { childId: 'released-child', mode: 'continuable', label: 'released child' } },
    ])
    expect(prepared.filter(event => event.type === 'turn/start')
      .map(event => event.data)).toEqual([{ turn: 1 }])

    // A read-only preparation publishes nothing and never rewrites the released generation.
    expect(await readFile(corpus.parentPath)).toEqual(corpus.source)
    expect((await stat(corpus.parentPath, { bigint: true })).ino).toBe(corpus.ino)
    expect((await readdir(dirname(corpus.parentPath))).filter(name => name !== 'session.lock'))
      .toEqual(['session.v3.jsonl'])

    const writer = await ctx.sessionPersistence.open(corpus.parent, 'write')
    try {
      expect((await writer.read()).events).toEqual(prepared)
    } finally {
      await writer.close()
    }
    expect(await readFile(corpus.parentPath)).toEqual(corpus.source)
    expect((await stat(corpus.parentPath, { bigint: true })).ino).toBe(corpus.ino)
    expect((await readdir(dirname(corpus.parentPath))).filter(name => name !== 'session.lock').sort())
      .toEqual(['session.v3.jsonl', 'session.v4.jsonl'])
    expect((await ctx.sessionPersistence.stat(corpus.parent))?.formatStatus).toBe('current')

    // A process that never saw the preparation reads the published V4 generation unchanged.
    const independent = await mount(corpus.root)
    const reopened = await independent.sessionPersistence.open(corpus.parent, 'read')
    try {
      expect((await reopened.read()).events).toEqual(prepared)
    } finally {
      await reopened.close()
    }
    expect(await readFile(corpus.parentPath)).toEqual(corpus.source)
  })
})
