/** Host platform dispatch with filesystem and path-conversion adapters isolated. */
import { opendir, stat } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { windowsPathToHost } from '@deepseek-ai/dsh-native-command'
import { afterEach, expect, it, vi } from 'vitest'
import BrowseDirectoryPicker, { listingDrives } from '../src/index.ts'

vi.mock('node:fs/promises', () => ({ stat: vi.fn(), opendir: vi.fn(), mkdir: vi.fn() }))
vi.mock('@deepseek-ai/dsh-native-command', () => ({ windowsPathToHost: vi.fn() }))

afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks() })

it('probes drive roots and filters unavailable volumes', async () => {
  vi.mocked(stat).mockImplementation(async (path) => {
    if (path === 'C:\\') return {} as Awaited<ReturnType<typeof stat>>
    throw Object.assign(new Error('unavailable volume'), { code: 'ENOENT' })
  })
  await expect(listingDrives('win32')).resolves.toEqual([{ name: 'C:\\', path: 'C:\\', hidden: false }])
  expect(stat).toHaveBeenCalledTimes(26)
})

it.each(['linux', 'win32'] as const)('carries %s drive information in a directory response', async (platform) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  vi.mocked(stat).mockImplementation(async (path) => {
    if (path === 'C:\\') return {} as Awaited<ReturnType<typeof stat>>
    throw new Error('unavailable volume')
  })
  const close = vi.fn(async () => {})
  vi.mocked(opendir).mockResolvedValue({ read: async () => null, close } as unknown as Awaited<ReturnType<typeof opendir>>)
  vi.mocked(windowsPathToHost).mockResolvedValue('/mnt/c/project')
  const ctx = new Context()
  try {
    await ctx.plugin(BrowseDirectoryPicker)
    const capability = ctx.directoryPicker.capability()
    if (capability.kind !== 'browse') throw new Error('expected directory browsing')
    const input = 'C:\\project'
    const listing = await capability.list(input)
    if (platform === 'win32') {
      expect(listing.drives).toEqual([{ name: 'C:\\', path: 'C:\\', hidden: false }])
      expect(windowsPathToHost).not.toHaveBeenCalled()
    } else {
      expect(listing).not.toHaveProperty('drives')
      expect(windowsPathToHost).toHaveBeenCalledWith(input, expect.any(AbortSignal))
      const signal = new AbortController().signal
      await capability.list(input, signal)
      expect(windowsPathToHost).toHaveBeenLastCalledWith(input, signal)
    }
    expect(close).toHaveBeenCalled()
  } finally {
    await ctx.fiber.dispose()
  }
})

it('omits a symlink that resolves to a file', async () => {
  vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as unknown as Awaited<ReturnType<typeof stat>>)
  const read = vi.fn().mockResolvedValueOnce({ name: 'file-link', isDirectory: () => false, isSymbolicLink: () => true }).mockResolvedValue(null)
  vi.mocked(opendir).mockResolvedValue({ read, close: async () => {} } as unknown as Awaited<ReturnType<typeof opendir>>)
  const ctx = new Context()
  try {
    await ctx.plugin(BrowseDirectoryPicker)
    const capability = ctx.directoryPicker.capability()
    if (capability.kind !== 'browse') throw new Error('expected directory browsing')
    expect((await capability.list(process.cwd())).entries).toEqual([])
  } finally {
    await ctx.fiber.dispose()
  }
})
