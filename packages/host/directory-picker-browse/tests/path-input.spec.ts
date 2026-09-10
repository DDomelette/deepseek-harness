/** Windows-form input resolves before filesystem operations on a POSIX Host. */
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { windowsPathToHost } from '@deepseek-ai/dsh-native-command'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryPickerBrowseCapability } from '@deepseek-ai/dsh-host-directory-picker'
import BrowseDirectoryPicker from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-native-command', () => ({ windowsPathToHost: vi.fn() }))

let root: string
let ctx: Context
let capability: DirectoryPickerBrowseCapability
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-windows-input-'))
  ctx = new Context()
  await ctx.plugin(BrowseDirectoryPicker)
  const picked = ctx.get('directoryPicker')!.capability()
  if (picked.kind !== 'browse') throw new Error('expected browse capability')
  capability = picked
  vi.mocked(windowsPathToHost).mockImplementation(async path => path)
})
afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
  vi.resetAllMocks()
})

it('lists native paths without invoking a translator', async () => {
  expect((await capability.list(root)).path).toBe(root)
  expect(windowsPathToHost).not.toHaveBeenCalled()
})

describe.skipIf(process.platform === 'win32')('foreign Windows paths on POSIX', () => {
  it.each(['D:\\my project', '\\\\wsl.localhost\\Ubuntu\\home\\project'])('lists %s using the translated path', async (input) => {
    await mkdir(join(root, 'child'))
    vi.mocked(windowsPathToHost).mockResolvedValue(root)
    const signal = new AbortController().signal
    const listing = await capability.list(input, signal)
    expect(windowsPathToHost).toHaveBeenCalledWith(input, signal)
    expect(listing.path).toBe(root)
    expect(listing.entries.map(entry => entry.path)).toEqual([join(root, 'child')])
    expect(listing.crumbs.at(-1)?.path).toBe(root)
  })

  it('creates a child under the translated parent', async () => {
    vi.mocked(windowsPathToHost).mockResolvedValue(root)
    await expect(capability.createDirectory('D:\\my project', 'child')).resolves.toBe(join(root, 'child'))
    expect((await stat(join(root, 'child'))).isDirectory()).toBe(true)
  })

  it('keeps relative Windows paths outside the translation path', async () => {
    for (const input of ['D:relative', '\\rooted', '\\\\server']) {
      await expect(capability.list(input)).rejects.toMatchObject({ code: 'directory-unreadable', path: input })
      await expect(capability.createDirectory(input, 'child')).rejects.toMatchObject({ code: 'directory-create-failed' })
    }
    expect(windowsPathToHost).not.toHaveBeenCalled()
  })

  it('reports conversion failures in the existing directory error vocabulary', async () => {
    vi.mocked(windowsPathToHost).mockRejectedValue(new Error('drive unavailable'))
    await expect(capability.list('D:\\missing')).rejects.toMatchObject({ code: 'directory-unreadable', path: 'D:\\missing' })
    await expect(capability.createDirectory('D:\\missing', 'child')).rejects.toMatchObject({ code: 'directory-create-failed' })
  })
})
