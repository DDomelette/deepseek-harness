/**
 * The notes plugin through a real Loader composition.
 *
 * `packages/AGENTS.md` requires a non-unit composition test for a
 * product-visible plugin, so this boots a test-owned `cordis.yml` through the
 * real Loader rather than hand-building a context. The row carries no `config`,
 * so what it serves is exactly what the schema defaults compose.
 *
 * The config is written into a temporary directory this spec owns instead of a
 * committed fixture: suites run in forked workers beside the other gate
 * processes, and a shared fixture path (or a shared environment variable naming
 * one) would couple them.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import * as Notes from '../src/index.ts'
import { notesDomainSpec } from '../src/domain.ts'
import { noteId, published } from './bench.ts'

const NOTES_PACKAGE = '@deepseek-ai/dsh-notes'

/** A conversation id no fixture ever writes to. */
const listedNoteId = noteId('probe-conversation')

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot one composition file through the Loader.
 * @param configPath - absolute path of the `cordis.yml` to boot.
 * @returns the settled context.
 */
async function loadComposition(configPath: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(root as string).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    [NOTES_PACKAGE, Notes],
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
  expect([...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)).toEqual([])
  return ctx
}

/** Write the test composition into the spec's temporary directory. */
async function writeComposition(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-notes-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'storage'))}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    '- id: notes',
    `  name: '${NOTES_PACKAGE}'`,
    '',
  ].join('\n'))
  return configPath
}

describe('notes through a real Loader composition', () => {
  it('activates the host half and serves the row schema defaults', async () => {
    const configPath = await writeComposition()
    const ctx = await loadComposition(configPath)

    const rows = [...ctx.loader.entries()].filter(entry => entry.options.name === NOTES_PACKAGE)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.fiber?.state).toBe(FiberState.ACTIVE)
    await published(() => ctx.get('notesSessions'), 'notesSessions')
    expect(ctx.notesSessions.list()).toEqual([])
    expect(ctx.notesMaterials.list(listedNoteId)).toEqual([])
    // The bare row supplies no config, so these values are the schema defaults
    // the Loader resolved — not anything this spec passed in.
    expect(ctx.notesSettings.strategy()).toBe('manual')
    expect(ctx.notesSettings.actions().map(action => action.id)).toEqual(['translate'])
    expect(ctx.notesSettings.workspace()).toBeNull()
    expect(ctx.notesSettings.model()).toBeNull()
  })

  it('releases the domain name when the notes row unmounts', async () => {
    const configPath = await writeComposition()
    const ctx = await loadComposition(configPath)
    await published(() => ctx.get('notesStore'), 'notesStore')

    const notesRow = [...ctx.loader.entries()].find(entry => entry.options.name === NOTES_PACKAGE)
    await notesRow?.fiber?.dispose()

    // The row's domain close ran with its fiber, so this context can open the
    // same domain name again.
    const reopened = await ctx.storageDomain.open(notesDomainSpec)
    await reopened.close()
  })
})
