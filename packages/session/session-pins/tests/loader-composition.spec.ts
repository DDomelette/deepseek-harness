import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionFlagRegistry from '../../session-flags/src/index.ts'
import SessionPinsService from '../src/index.ts'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(configPath: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root as string).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session-flags', SessionFlagRegistry],
    ['@deepseek-ai/dsh-session-pins', SessionPinsService],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return ctx
}

describe('session pins through a real Loader composition', () => {
  it('persists pins across a cold restart and projects them through sessionFlags', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-session-pins-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'storage'))}`,
      "- name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: json',
      "- name: '@deepseek-ai/dsh-session-flags'",
      "- name: '@deepseek-ai/dsh-session-pins'",
      '',
    ].join('\n'))

    const first = await loadComposition(configPath)
    await first.sessionPins.setPinned({ sessionId: 'pinned', pinned: true })
    expect(first.sessionFlags.snapshot().flags['pinned' as SessionId]).toEqual({ pinned: true })

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await loadComposition(configPath)
    expect(second.sessionPins.list().pinnedSessionIds).toEqual(['pinned'])
    expect(second.sessionFlags.snapshot().flags['pinned' as SessionId]).toEqual({ pinned: true })
  })
})
