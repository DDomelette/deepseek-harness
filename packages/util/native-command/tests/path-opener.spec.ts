/** Cross-platform native path opener behavior. */
type ExecFileCallback = (
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void
type ExecFileMock = (
  command: string,
  args: readonly string[],
  options: { encoding: string; signal: AbortSignal; windowsHide: boolean },
  callback: ExecFileCallback,
) => void

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn<ExecFileMock>() }))

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { release as osRelease } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canOpenNativePath, openNativePath, openNativeTextFile, windowsPathToHost, type PathOpenerRunner } from '../src/index.ts'

const signal = () => new AbortController().signal
beforeEach(() => { execFileMock.mockReset() })

describe('Windows paths on a WSL Host', () => {
  const wsl = { platform: 'linux' as const, osRelease: '6.8.0-microsoft-standard-WSL2', env: {} }

  it('uses wslpath output instead of assuming a drive mount root, preserving argument bytes', async () => {
    const path = "D:\\my files\\o'reilly;$(pwd)"
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '/drives/d/my files/project\r\n', stderr: '' }))
    const requestSignal = signal()
    await expect(windowsPathToHost(path, requestSignal, { ...wsl, run }))
      .resolves.toBe('/drives/d/my files/project')
    expect(run).toHaveBeenCalledExactlyOnceWith('wslpath', ['-u', path], requestSignal)
  })

  it.each(['win32', 'darwin', 'linux'] as const)('leaves paths unchanged on ordinary %s hosts', async (platform) => {
    const run = vi.fn<PathOpenerRunner>()
    await expect(windowsPathToHost('D:\\project', signal(), {
      platform, osRelease: '6.8.0-generic', env: {}, run,
    })).resolves.toBe('D:\\project')
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['', 'relative/path'])('rejects non-absolute translator output %j', async (stdout) => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout, stderr: '' }))
    await expect(windowsPathToHost('D:\\project', signal(), { ...wsl, run }))
      .rejects.toThrow('wslpath returned no absolute Linux path')
  })

  it('propagates translation failure instead of inventing a mount path', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => { throw new Error('drive is unavailable') })
    await expect(windowsPathToHost('D:\\project', signal(), { ...wsl, run }))
      .rejects.toThrow('drive is unavailable')
  })

  it('runs wslpath with the native runner when no runner is injected', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => callback(null, '/mnt/d/project\n', ''))
    const requestSignal = signal()
    await expect(windowsPathToHost('D:\\project', requestSignal, { ...wsl }))
      .resolves.toBe('/mnt/d/project')
    expect(execFileMock).toHaveBeenCalledWith('wslpath', ['-u', 'D:\\project'], {
      encoding: 'utf8', signal: requestSignal, windowsHide: true,
    }, expect.any(Function))
  })

  it('uses the host kernel when no WSL environment marker is present', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '/mnt/d/project\n', stderr: '' }))
    const isWslKernel = osRelease().toLowerCase().includes('microsoft')
    await expect(windowsPathToHost('D:\\project', signal(), { platform: 'linux', env: {}, run }))
      .resolves.toBe(isWslKernel ? '/mnt/d/project' : 'D:\\project')
    expect(run).toHaveBeenCalledTimes(isWslKernel ? 1 : 0)
  })

  it('uses the ambient host platform without overrides', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => callback(null, '/mnt/d/project\n', ''))
    const wslHost = process.platform === 'linux' && (
      Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) || osRelease().toLowerCase().includes('microsoft')
    )
    await expect(windowsPathToHost('D:\\project', signal())).resolves.toBe(wslHost ? '/mnt/d/project' : 'D:\\project')
    expect(execFileMock).toHaveBeenCalledTimes(wslHost ? 1 : 0)
  })

  it('refuses an already cancelled call and discards output after cancellation', async () => {
    const abort = new AbortController()
    const run = vi.fn<PathOpenerRunner>(async () => {
      abort.abort(new Error('caller left'))
      return { stdout: '/mnt/d/project\n', stderr: '' }
    })
    await expect(windowsPathToHost('D:\\project', abort.signal, { ...wsl, run })).rejects.toThrow('caller left')
    await expect(windowsPathToHost('D:\\project', abort.signal, { ...wsl, run })).rejects.toThrow('caller left')
    expect(run).toHaveBeenCalledOnce()
  })
})

describe('native path opener', () => {
  it('opens with macOS open(1)', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativePath('/Users/test/file.txt', signal(), { platform: 'darwin', run })
    expect(run).toHaveBeenCalledWith('open', ['/Users/test/file.txt'], expect.any(AbortSignal))
  })

  it('bypasses macOS file associations for text documents', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('/Users/test/settings.yaml', signal(), { platform: 'darwin', run })
    expect(run).toHaveBeenCalledWith('open', ['-t', '/Users/test/settings.yaml'], expect.any(AbortSignal))
  })

  it('uses the Linux desktop association for text documents', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('/tmp/settings.yaml', signal(), {
      platform: 'linux', osRelease: '6.8.0-generic', env: {}, run,
    })
    expect(run).toHaveBeenCalledWith('xdg-open', ['/tmp/settings.yaml'], expect.any(AbortSignal))
  })

  it.each([
    ['distribution marker', { WSL_DISTRO_NAME: 'Ubuntu' }, '6.8.0-generic'],
    ['interop marker', { WSL_INTEROP: '/run/WSL/123_interop' }, '6.8.0-generic'],
    ['kernel release', {}, '5.15.153.1-microsoft-standard-WSL2'],
  ])('hands WSL text documents to the Windows desktop from the %s', async (_label, env, osRelease) => {
    const requestSignal = signal()
    const run = vi.fn<PathOpenerRunner>(async command => command === 'wslpath'
      ? { stdout: '\\\\wsl.localhost\\Ubuntu\\home\\test user\\settings.yaml\r\n', stderr: '' }
      : { stdout: '', stderr: '' })
    await openNativeTextFile('/home/test user/settings.yaml', requestSignal, {
      platform: 'linux', osRelease, env, run,
    })
    expect(run.mock.calls).toEqual([
      ['wslpath', ['-w', '/home/test user/settings.yaml'], requestSignal],
      [
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          "Invoke-Item -LiteralPath '\\\\wsl.localhost\\Ubuntu\\home\\test user\\settings.yaml'",
        ],
        requestSignal,
      ],
    ])
  })

  it('rejects an empty WSL path translation before invoking Windows', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '\r\n', stderr: '' }))
    await expect(openNativeTextFile('/home/test/settings.yaml', signal(), {
      platform: 'linux', osRelease: '6.8.0-generic', env: { WSL_DISTRO_NAME: 'Ubuntu' }, run,
    })).rejects.toThrow('wslpath returned no Windows path')
    expect(run).toHaveBeenCalledOnce()
  })

  it('does not invoke Windows when the request aborts during WSL path translation', async () => {
    const abort = new AbortController()
    const run = vi.fn<PathOpenerRunner>(async () => {
      abort.abort(new Error('closed'))
      return { stdout: '\\\\wsl.localhost\\Ubuntu\\home\\test\\settings.yaml\n', stderr: '' }
    })
    await expect(openNativeTextFile('/home/test/settings.yaml', abort.signal, {
      platform: 'linux', osRelease: '6.8.0-generic', env: { WSL_DISTRO_NAME: 'Ubuntu' }, run,
    })).rejects.toThrow('closed')
    expect(run).toHaveBeenCalledOnce()
  })

  it('opens with Windows Invoke-Item and escapes single quotes', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativePath("C:\\work\\o'reilly.txt", signal(), { platform: 'win32', run })
    expect(run).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', "Invoke-Item -LiteralPath 'C:\\work\\o''reilly.txt'"],
      expect.any(AbortSignal),
    )
  })

  it('uses the Windows desktop association for text documents', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativeTextFile('C:\\work\\settings.yaml', signal(), { platform: 'win32', run })
    expect(run).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', "Invoke-Item -LiteralPath 'C:\\work\\settings.yaml'"],
      expect.any(AbortSignal),
    )
  })

  it('opens with Linux xdg-open', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativePath('/tmp/a.txt', signal(), {
      platform: 'linux', osRelease: '6.8.0-generic',
      env: { WSL_DISTRO_NAME: '', WSL_INTEROP: '' }, run,
    })
    expect(run).toHaveBeenCalledWith('xdg-open', ['/tmp/a.txt'], expect.any(AbortSignal))
  })

  it('rejects unsupported platforms', async () => {
    await expect(openNativePath('/x', signal(), { platform: 'freebsd' as NodeJS.Platform }))
      .rejects.toThrow('unsupported on freebsd')
  })

  it('uses the current process platform when no platform override is supplied', async () => {
    const run = vi.fn<PathOpenerRunner>(async () => ({ stdout: '', stderr: '' }))
    await openNativePath('/tmp/platform-default.txt', signal(), {
      osRelease: '6.8.0-generic', env: {}, run,
    })
    const expected = process.platform === 'win32'
      ? 'powershell.exe'
      : process.platform === 'linux'
        ? 'xdg-open'
        : 'open'
    expect(run.mock.calls[0]?.[0]).toBe(expected)
  })

  it('samples ambient WSL markers and kernel release when no fact overrides are supplied', async () => {
    const ambientWsl = [process.env.WSL_DISTRO_NAME, process.env.WSL_INTEROP]
      .some(value => value !== undefined && value !== '')
      || osRelease().toLowerCase().includes('microsoft')
    const run = vi.fn<PathOpenerRunner>(async command => command === 'wslpath'
      ? { stdout: 'C:\\settings.yaml\n', stderr: '' }
      : { stdout: '', stderr: '' })
    await openNativePath('/tmp/ambient-facts.yaml', signal(), { platform: 'linux', run })
    expect(run.mock.calls[0]?.[0]).toBe(ambientWsl ? 'wslpath' : 'xdg-open')
  })

  it('runs the default command adapter without a shell and preserves command failures', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, '', '')
    })
    await openNativePath('/tmp/default.txt', signal(), { platform: 'darwin' })
    const [command, args, options] = execFileMock.mock.calls[0]!
    expect(command).toBe('open')
    expect(args).toEqual(['/tmp/default.txt'])
    expect(options.encoding).toBe('utf8')
    expect(options.windowsHide).toBe(true)
    expect(options.signal).toBeInstanceOf(AbortSignal)

    const commandError = Object.assign(new Error('open failed'), { code: 1 })
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(commandError, 'partial output', 'failure details')
    })
    await expect(openNativePath('/tmp/missing.txt', signal(), { platform: 'darwin' })).rejects.toMatchObject({
      message: 'open failed', cause: commandError, code: 1,
      stdout: 'partial output', stderr: 'failure details',
    })
  })
})

describe('browser-renderable documents', () => {
  const LS_PLIST = `{
    LSHandlers = (
        {
            LSHandlerPreferredVersions =             {
                LSHandlerRoleAll = "-";
            };
            LSHandlerRoleAll = "com.google.chrome";
            LSHandlerURLScheme = https;
        }
    );
}`

  it('opens a page with the default browser rather than the .html handler on darwin', async () => {
    const calls: { command: string; args: readonly string[] }[] = []
    const run = async (command: string, args: readonly string[]) => {
      calls.push({ command, args })
      return { stdout: command === 'defaults' ? LS_PLIST : '', stderr: '' }
    }
    await openNativePath('/w/page.html', new AbortController().signal, { platform: 'darwin', run })
    // A developer who bound .html to an editor still gets a rendered page.
    expect(calls.map(c => [c.command, ...c.args])).toEqual([
      ['defaults', 'read', 'com.apple.LaunchServices/com.apple.launchservices.secure'],
      ['open', '-b', 'com.google.chrome', '/w/page.html'],
    ])
  })

  it('leaves every other document to the default application', async () => {
    const calls: string[][] = []
    const run = async (command: string, args: readonly string[]) => {
      calls.push([command, ...args])
      return { stdout: '', stderr: '' }
    }
    await openNativePath('/w/report.md', new AbortController().signal, { platform: 'darwin', run })
    // No LaunchServices read at all: markdown is not a browser document.
    expect(calls).toEqual([['open', '/w/report.md']])
  })

  it('falls back to the default application when no browser can be named', async () => {
    // LaunchServices has no https record (a fresh account), so the system's
    // own content-type choice is the best answer available.
    const calls: string[][] = []
    const run = async (command: string, args: readonly string[]) => {
      calls.push([command, ...args])
      if (command === 'defaults') throw new Error('domain not found')
      return { stdout: '', stderr: '' }
    }
    await openNativePath('/w/page.html', new AbortController().signal, { platform: 'darwin', run })
    expect(calls).toEqual([
      ['defaults', 'read', 'com.apple.LaunchServices/com.apple.launchservices.secure'],
      ['open', '/w/page.html'],
    ])

    // A record without an https handler is the same answer.
    const bare: string[][] = []
    await openNativePath('/w/page.html', new AbortController().signal, {
      platform: 'darwin',
      run: async (command, args) => {
        bare.push([command, ...args])
        return { stdout: '{ LSHandlers = ( ); }', stderr: '' }
      },
    })
    expect(bare[1]).toEqual(['open', '/w/page.html'])
  })

  it('honors $BROWSER on linux and leaves windows to its association', async () => {
    const linux: string[][] = []
    await openNativePath('/w/page.html', new AbortController().signal, {
      platform: 'linux',
      osRelease: '6.8.0-generic',
      env: { BROWSER: 'firefox' },
      run: async (command, args) => { linux.push([command, ...args]); return { stdout: '', stderr: '' } },
    })
    expect(linux).toEqual([['firefox', '/w/page.html']])

    // Unset $BROWSER: xdg-open's association is the fallback.
    const bare: string[][] = []
    await openNativePath('/w/page.html', new AbortController().signal, {
      platform: 'linux',
      osRelease: '6.8.0-generic',
      env: {},
      run: async (command, args) => { bare.push([command, ...args]); return { stdout: '', stderr: '' } },
    })
    expect(bare).toEqual([['xdg-open', '/w/page.html']])

    // Windows names no browser without the UserChoice registry.
    const win: string[][] = []
    await openNativePath('C:\\w\\page.html', new AbortController().signal, {
      platform: 'win32',
      run: async (command, args) => { win.push([command, ...args]); return { stdout: '', stderr: '' } },
    })
    expect(win[0]?.[0]).toBe('powershell.exe')
  })

  it('hands browser-renderable WSL paths to the Windows desktop', async () => {
    const calls: string[][] = []
    await openNativePath('/home/test/page.html', new AbortController().signal, {
      platform: 'linux',
      osRelease: '5.15.153.1-microsoft-standard-WSL2',
      env: { BROWSER: 'firefox' },
      run: async (command, args) => {
        calls.push([command, ...args])
        return {
          stdout: command === 'wslpath' ? 'C:\\workspace\\page.html\n' : '',
          stderr: '',
        }
      },
    })
    expect(calls).toEqual([
      ['wslpath', '-w', '/home/test/page.html'],
      [
        'powershell.exe',
        '-NoProfile',
        '-Command',
        "Invoke-Item -LiteralPath 'C:\\workspace\\page.html'",
      ],
    ])
  })
})

describe('canOpenNativePath', () => {
  it('always answers yes where the desktop is part of the platform', () => {
    expect(canOpenNativePath({ platform: 'darwin', env: {} })).toBe(true)
    expect(canOpenNativePath({ platform: 'win32', env: {} })).toBe(true)
  })

  it('requires a display server or WSL interop on linux', () => {
    const linux = { platform: 'linux' as const, osRelease: '6.8.0-generic' }
    // Headless is the case the capability exists for: `xdg-open` would spawn
    // into nothing, so a surface should show the path as text instead.
    expect(canOpenNativePath({ ...linux, env: {} })).toBe(false)
    expect(canOpenNativePath({ ...linux, env: { DISPLAY: ':0' } })).toBe(true)
    expect(canOpenNativePath({ ...linux, env: { WAYLAND_DISPLAY: 'wayland-0' } })).toBe(true)
    expect(canOpenNativePath({
      platform: 'linux', osRelease: '5.15.153.1-microsoft-standard-WSL2', env: {},
    })).toBe(true)
  })

  it('answers no on a platform the opener does not support', () => {
    expect(canOpenNativePath({ platform: 'freebsd', env: {} })).toBe(false)
  })

  it('samples the ambient environment when no override is supplied', () => {
    const env = process.env
    const marked = (value: string | undefined): boolean => value !== undefined && value !== ''
    const expected = marked(env.WSL_DISTRO_NAME) || marked(env.WSL_INTEROP)
      || marked(env.DISPLAY) || marked(env.WAYLAND_DISPLAY)

    expect(canOpenNativePath({ platform: 'linux', osRelease: '6.8.0-generic' })).toBe(expected)
  })

  it('samples the ambient platform when none is named', () => {
    // The internals are a test seam; a deployment calls this with nothing and
    // must get the answer for the host it is actually running on.
    expect(canOpenNativePath()).toBe(canOpenNativePath({ platform: process.platform }))
  })
})
