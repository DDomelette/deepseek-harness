import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cordisConfigFiles, readCordisConfigFile } from './cordis-config-files.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('cordisConfigFiles', () => {
  it('finds Loader YAML without treating translation records as configs', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-files-'))
    roots.push(root)
    for (const directory of ['.claude', 'apps/cli/config/examples', 'docs', 'node_modules/pkg', 'vendor/pkg']) {
      mkdirSync(join(root, directory), { recursive: true })
    }
    for (const file of [
      '.claude/hidden.cordis.yml',
      'docs/cordis-primer.i18n.yaml',
      'apps/cli/config/examples/agent.cordis.yaml',
      'apps/cli/config/examples/headless.cordis.yml',
      'node_modules/pkg/hidden.cordis.yml',
      'vendor/pkg/hidden.cordis.yml',
    ]) {
      writeFileSync(join(root, file), '[]\n')
    }

    expect(cordisConfigFiles(root)).toEqual([
      join('apps', 'cli', 'config', 'examples', 'agent.cordis.yaml'),
      join('apps', 'cli', 'config', 'examples', 'headless.cordis.yml'),
    ])
  })
})

describe('readCordisConfigFile', () => {
  const shared = "- id: shared\n  name: '@deepseek-ai/dsh-shared'\n"

  function repository(): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cordis-config-read-'))
    roots.push(root)
    mkdirSync(join(root, 'targets'), { recursive: true })
    mkdirSync(join(root, 'apps'), { recursive: true })
    writeFileSync(join(root, 'targets', 'shared.yml'), shared)
    return root
  }

  it('resolves an alias a symlink-less checkout wrote as its relative target', () => {
    const root = repository()
    // Git materializes a mode-120000 entry as its target text, without a newline.
    writeFileSync(join(root, 'apps', 'cordis.yml'), '../targets/shared.yml')

    expect(readCordisConfigFile(root, 'apps/cordis.yml')).toBe(shared)
  })

  it('returns an ordinary one-line document unchanged', () => {
    const root = repository()
    writeFileSync(join(root, 'apps', 'empty.cordis.yml'), '[]')

    expect(readCordisConfigFile(root, 'apps/empty.cordis.yml')).toBe('[]')
  })

  it('names the file and its target when the materialized target is missing', () => {
    const root = repository()
    writeFileSync(join(root, 'apps', 'cordis.yml'), '../targets/absent.yml')

    expect(() => readCordisConfigFile(root, 'apps/cordis.yml'))
      .toThrow('apps/cordis.yml: the materialized symbolic-link target "../targets/absent.yml" does not exist')
  })
})
