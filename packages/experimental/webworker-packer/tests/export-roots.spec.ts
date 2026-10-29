import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadVfsImage, WorkerModuleLoader } from '@deepseek-ai/dsh-experimental-webworker-runtime'
import { DEFAULT_ROOT, packVfsImage } from '../src/pack.ts'

describe('workspace export roots', () => {
  let directory: string
  const name = '@deepseek-ai/dsh-packer-fixture'

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'dsh-packer-exports-'))
    mkdirSync(join(directory, 'lib'))
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name,
      type: 'module',
      files: ['lib'],
      exports: {
        '.': { types: './lib/index.d.ts', default: './lib/index.js' },
        './types': { types: './lib/types.d.ts' },
        './remote-events': { types: './lib/remote-events.d.ts' },
        './runtime': { types: './lib/runtime.d.ts', default: './lib/runtime.js' },
      },
    }))
    writeFileSync(join(directory, 'lib/index.js'), 'export const ready = true\n')
    writeFileSync(join(directory, 'lib/runtime.js'), 'export const value = 42\n')
  })

  afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

  const pack = (): ReturnType<typeof packVfsImage> => packVfsImage({
    config: `- name: '${name}'\n`,
    profile: 'export-roots',
    workspaces: new Map([[name, directory]]),
    resolveFrom: directory,
    entries: [],
  })

  it('packs declaration-only exports without treating them as runtime roots', () => {
    const result = pack()
    const vfs = loadVfsImage(gunzipSync(result.image), DEFAULT_ROOT)
    const loader = new WorkerModuleLoader({ vfs, root: DEFAULT_ROOT, staticModules: {} })
    expect(loader.requireFrom(DEFAULT_ROOT)(name)).toEqual({ ready: true })
    expect(loader.requireFrom(DEFAULT_ROOT)(`${name}/runtime`)).toEqual({ value: 42 })
    expect(result.missing).toEqual([])
    expect(result.unresolvedExternalRequests).toEqual([])
  })

  it.each(['@fixture/missing', `${name}/types`])(
    'rejects a runtime import of %s',
    (specifier) => {
      writeFileSync(join(directory, 'lib/index.js'), `import '${specifier}'\n`)
      expect(pack).toThrow(`"${specifier}"`)
    },
  )

  it('rejects a missing runtime export even when that export also declares types', () => {
    rmSync(join(directory, 'lib/runtime.js'))
    expect(pack).toThrow(`workspace face ${name}: "${name}/runtime"`)
  })
})
