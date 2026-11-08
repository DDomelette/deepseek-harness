import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  benchmarkNpmResolution,
  buildRegistryIndex,
  npmInvocation,
  parseBenchmarkOptions,
  publishWorkspaceRange,
  removeConsumerDirectory,
  resolveNpmPackageLock,
  runCommandWithTimeout,
  type RegistryIndex,
} from './benchmark-npm-resolution.ts'

const roots: string[] = []

// Hang guard for the real npm subprocess, not a performance assertion: the
// cases below count registry and archive requests and never read the clock.
// Windows CI runners start npm cold and resolve measurably past 10s, while
// the fork's coverage lane grants each case 90s.
const NPM_SUBPROCESS_GUARD_MS = 60_000

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeJson(root: string, path: string, value: unknown): void {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function processCanExecute(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
  if (process.platform !== 'linux') return true
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/, 1)[0]
    return !/^[ZXx]$/.test(state ?? '')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

describe('npm resolution benchmark', () => {
  it('parses repeat, timeout, threshold, and ref options', () => {
    expect(parseBenchmarkOptions([])).toEqual({ runs: 1, timeoutMs: 300_000 })
    expect(parseBenchmarkOptions([
      '--runs', '3', '--timeout-ms', '45000', '--max-ms', '20000', '--ref', 'master',
    ])).toEqual({ runs: 3, timeoutMs: 45_000, maxMs: 20_000, ref: 'master' })
    expect(parseBenchmarkOptions(['--', '--runs', '2'])).toEqual({ runs: 2, timeoutMs: 300_000 })
    expect(() => parseBenchmarkOptions(['--runs', '0'])).toThrow('--runs must be a positive integer')
  })

  it('starts npm as the child it terminates instead of through a shell wrapper', () => {
    const invocation = npmInvocation(['--version'])

    expect(invocation.args.at(-1)).toBe('--version')
    if (process.platform === 'win32') {
      expect(invocation.command).toBe(process.execPath)
      expect(invocation.args[0]?.replace(/\\/g, '/')).toMatch(/\/node_modules\/npm\/bin\/npm-cli\.js$/)
    } else {
      expect(invocation.command).toBe('npm')
    }
  })

  it('projects workspace protocols to published ranges', () => {
    expect(publishWorkspaceRange('workspace:^', '1.2.3')).toBe('^1.2.3')
    expect(publishWorkspaceRange('workspace:~', '1.2.3')).toBe('~1.2.3')
    expect(publishWorkspaceRange('workspace:*', '1.2.3')).toBe('1.2.3')
    expect(publishWorkspaceRange('^4.0.0', '1.2.3')).toBe('^4.0.0')
  })

  it('combines installed metadata with current publishable workspace fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-npm-registry-index-'))
    roots.push(root)
    writeJson(root, 'node_modules/.pnpm/external@2.0.0/node_modules/external/package.json', {
      name: 'external',
      version: '2.0.0',
      dependencies: { child: '^1.0.0' },
      devDependencies: { ignored: '^1.0.0' },
    })
    writeJson(root, 'apps/cli/package.json', {
      name: '@deepseek-ai/dsh',
      version: '0.1.0',
      dependencies: { '@deepseek-ai/dsh-child': 'workspace:^', external: '^2.0.0' },
      devDependencies: { ignored: 'workspace:^' },
    })
    writeJson(root, 'packages/core/child/package.json', {
      name: '@deepseek-ai/dsh-child',
      version: '0.1.0',
    })

    const index = buildRegistryIndex(root)

    expect(index.get('external')?.get('2.0.0')).toMatchObject({ dependencies: { child: '^1.0.0' } })
    expect(index.get('@deepseek-ai/dsh')?.get('0.1.0')).toEqual({
      name: '@deepseek-ai/dsh',
      version: '0.1.0',
      dependencies: { '@deepseek-ai/dsh-child': '^0.1.0', external: '^2.0.0' },
    })
  })

  it('runs npm against the local registry without requesting an archive', async () => {
    const index: RegistryIndex = new Map([[
      '@deepseek-ai/dsh',
      new Map([['0.1.0', { name: '@deepseek-ai/dsh', version: '0.1.0' }]]),
    ]])
    const result = await benchmarkNpmResolution(index, '0.1.0', NPM_SUBPROCESS_GUARD_MS)

    expect(result.durationMs).toBeGreaterThan(0)
    expect(result.registryRequests).toBeGreaterThan(0)
    expect(result.archiveRequests).toBe(0)
    expect(result.unknownPackages).toEqual([])
  })

  it('returns npm placement for two aliased package versions without requesting archives', async () => {
    const index: RegistryIndex = new Map([[
      '@deepseek-ai/dsh',
      new Map([
        ['0.1.0', { name: '@deepseek-ai/dsh', version: '0.1.0' }],
        ['0.2.0', { name: '@deepseek-ai/dsh', version: '0.2.0' }],
      ]),
    ]])

    const result = await resolveNpmPackageLock(index, {
      '@deepseek-ai/dsh': '0.2.0',
      'dsh-previous': 'npm:@deepseek-ai/dsh@0.1.0',
    }, NPM_SUBPROCESS_GUARD_MS)

    expect(result.archiveRequests).toBe(0)
    expect(result.packageLock.packages['node_modules/@deepseek-ai/dsh']?.version).toBe('0.2.0')
    expect(result.packageLock.packages['node_modules/dsh-previous']).toMatchObject({
      name: '@deepseek-ai/dsh',
      version: '0.1.0',
    })
  })

  it('isolates peer resolution from inherited npm configuration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-hostile-npm-config-'))
    roots.push(root)
    const userConfig = join(root, 'user.npmrc')
    writeFileSync(userConfig, '@deepseek-ai:registry=http://127.0.0.1:1/\nlegacy-peer-deps=true\nomit=peer\n')
    const previous = {
      userConfig: process.env.npm_config_userconfig,
      legacyPeerDeps: process.env.npm_config_legacy_peer_deps,
      omit: process.env.npm_config_omit,
    }
    process.env.npm_config_userconfig = userConfig
    process.env.npm_config_legacy_peer_deps = 'true'
    process.env.npm_config_omit = 'peer'
    try {
      const index: RegistryIndex = new Map([
        ['@deepseek-ai/dsh', new Map([['0.1.0', {
          name: '@deepseek-ai/dsh',
          version: '0.1.0',
          peerDependencies: { '@deepseek-ai/dsh-peer': '1.0.0' },
        }]])],
        ['@deepseek-ai/dsh-peer', new Map([['1.0.0', {
          name: '@deepseek-ai/dsh-peer',
          version: '1.0.0',
        }]])],
      ])

      const result = await resolveNpmPackageLock(index, { '@deepseek-ai/dsh': '0.1.0' }, NPM_SUBPROCESS_GUARD_MS)

      expect(result.archiveRequests).toBe(0)
      expect(result.packageLock.packages['node_modules/@deepseek-ai/dsh-peer']?.version).toBe('1.0.0')
    } finally {
      if (previous.userConfig === undefined) delete process.env.npm_config_userconfig
      else process.env.npm_config_userconfig = previous.userConfig
      if (previous.legacyPeerDeps === undefined) delete process.env.npm_config_legacy_peer_deps
      else process.env.npm_config_legacy_peer_deps = previous.legacyPeerDeps
      if (previous.omit === undefined) delete process.env.npm_config_omit
      else process.env.npm_config_omit = previous.omit
    }
  })

  // The removal below runs while the resolution's own error is propagating, so
  // a throw there would replace that error. Both mechanisms are the OS refusing
  // a real removal: Windows holds a live process's current directory, and POSIX
  // needs write access on the parent that `chmod` withdraws.
  const cleanupCanFail = process.platform === 'win32' || (process.getuid?.() ?? 0) !== 0

  it.skipIf(!cleanupCanFail)('reports the consumer directory it could not remove', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'dsh-npm-consumer-cleanup-'))
    roots.push(parent)

    const removable = join(parent, 'removable')
    mkdirSync(join(removable, 'nested'), { recursive: true })
    expect(removeConsumerDirectory(removable)).toBeUndefined()
    expect(existsSync(removable)).toBe(false)

    const consumer = join(parent, 'consumer')
    mkdirSync(join(consumer, 'nested'), { recursive: true })
    // The holder reports only after `chdir` returns, so its handle on the
    // directory exists before the removal below runs.
    const holder = process.platform === 'win32'
      ? spawn(process.execPath, [
        '-e',
        `process.chdir(${JSON.stringify(consumer)}); process.stdout.write('held'); setInterval(() => {}, 1000)`,
      ], { stdio: ['ignore', 'pipe', 'ignore'] })
      : undefined
    try {
      if (holder === undefined || holder.stdout === null) {
        chmodSync(parent, 0o500)
      } else {
        await new Promise<void>((resolveHeld, rejectHeld) => {
          holder.once('error', rejectHeld)
          holder.stdout.once('data', () => { resolveHeld() })
        })
      }

      const unreleased = removeConsumerDirectory(consumer)

      expect(unreleased).toContain(consumer)
      expect(existsSync(consumer)).toBe(true)
    } finally {
      if (holder === undefined || holder.stdout === null) {
        chmodSync(parent, 0o700)
      } else if (holder.exitCode === null && holder.signalCode === null) {
        await new Promise<void>((resolveExit) => {
          holder.once('exit', () => { resolveExit() })
          holder.kill()
        })
      }
    }
  })

  it.skipIf(process.platform === 'win32')('force-kills a timed-out process tree', async () => {
    const source = [
      "const { spawn } = require('node:child_process')",
      "process.on('SIGTERM', () => {})",
      'const child = spawn(process.execPath, [\'-e\', "process.on(\'SIGTERM\', () => {}); setInterval(() => {}, 1000)"], { stdio: \'ignore\' })',
      'console.log(child.pid)',
      'setInterval(() => {}, 1000)',
    ].join(';')
    let descendantPid: number | undefined
    try {
      const result = await runCommandWithTimeout(process.execPath, ['-e', source], {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 1_000,
        terminationGraceMs: 100,
      })
      const reportedPid = Number.parseInt(result.output.trim(), 10)
      if (!Number.isSafeInteger(reportedPid)) throw new Error(`child reported invalid pid ${result.output.trim()}`)
      descendantPid = reportedPid

      expect(result.timedOut).toBe(true)
      expect(result.signal).toBe('SIGKILL')
      await expect.poll(() => processCanExecute(reportedPid), { timeout: 5_000 }).toBe(false)
    } finally {
      if (descendantPid !== undefined && Number.isSafeInteger(descendantPid)) {
        try {
          process.kill(descendantPid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
      }
    }
  })
})
