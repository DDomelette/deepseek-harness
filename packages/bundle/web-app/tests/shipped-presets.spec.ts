/**
 * The shipped preset declarations: this bundle's patch list carries one
 * `@deepseek-ai/dsh-agent-preset` row per shipped preset, and every plugin row
 * those declarations mount resolves from this bundle's own dependencies.
 */

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundlePatchPaths, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { entryListProblem } from '@deepseek-ai/dsh-agent-preset-registry'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const WEB_BUNDLE = join(REPO_ROOT, 'packages/bundle/web-app')
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')

interface BundleManifest {
  name: string
  dependencies?: Record<string, string>
  dsh: { bundle: { patch: string | string[] } }
}
interface Row {
  id?: string
  name?: string
  disabled?: boolean
  insert?: Row[]
  config?: { id?: string; name?: string; description?: string; order?: number; plugins?: unknown[] }
}

const manifest = JSON.parse(readFileSync(join(WEB_BUNDLE, 'package.json'), 'utf8')) as BundleManifest
const patchPaths = bundlePatchPaths(WEB_BUNDLE, manifest.dsh.bundle)
const rows = composeEntries([[
  ...loadOverlayPatches('shipped presets', BASE_PATCH),
  ...patchPaths.flatMap(file => loadOverlayPatches('shipped presets', file)),
]]) as Row[]
const declarations = rows.filter(row => row.name === '@deepseek-ai/dsh-agent-preset')

/** Every plugin package a row names, including nested group and preset rows. */
function pluginPackages(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) pluginPackages(item, found)
    return found
  }
  if (typeof value !== 'object' || value === null) return found
  const row = value as Row & { group?: boolean; insert?: unknown }
  const name = row.name
  if (typeof name === 'string' && !name.startsWith('cordis:') && !name.startsWith('.')) {
    found.add(name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/'))
  }
  pluginPackages(row.insert, found)
  if (Array.isArray(row.config)) pluginPackages(row.config, found)
  else if (row.config !== undefined && Array.isArray(row.config.plugins)) pluginPackages(row.config.plugins, found)
  return found
}

/** Every row with this id inside a preset declaration, including group and preset rows. */
function rowsWithId(value: unknown, id: string, found: Row[] = []): Row[] {
  if (Array.isArray(value)) {
    for (const item of value) rowsWithId(item, id, found)
    return found
  }
  if (typeof value !== 'object' || value === null) return found
  const row = value as Row & { insert?: unknown }
  if (row.id === id) found.push(row)
  rowsWithId(row.insert, id, found)
  if (Array.isArray(row.config)) rowsWithId(row.config, id, found)
  else if (row.config !== undefined && Array.isArray(row.config.plugins)) rowsWithId(row.config.plugins, id, found)
  return found
}

describe('the shipped Web preset declarations', () => {
  it('lists the preset patch files in the bundle patch list', () => {
    expect(patchPaths.map(file => file.slice(WEB_BUNDLE.length + 1).replaceAll('\\', '/'))).toEqual([
      'cordis.patch.yml',
      'presets/standard.patch.yml',
      'presets/ptc.patch.yml',
      'presets/minimal.patch.yml',
      'presets/cordis.patch.yml',
    ])
  })

  it('declares the four shipped presets with their roster metadata', () => {
    expect(declarations.map(row => row.config?.id)).toEqual(['standard', 'ptc', 'minimal', 'cordis'])
    expect(declarations.map(row => row.config?.order)).toEqual([1, 2, 3, 4])
    // A shipped preset publishes no name or description: the roster's copy comes
    // from the active locale, so a declaration that named itself would freeze one
    // language into every page.
    for (const row of declarations) {
      expect(row.id).toBe(`preset-${row.config?.id as string}`)
      expect(row.config?.name).toBeUndefined()
      expect(row.config?.description).toBeUndefined()
      // The registry's own validator: what it accepts is what the Loader mounts.
      expect(entryListProblem(row.config?.plugins)).toBeUndefined()
    }
  })

  it('composes each preset from rows this bundle declares', () => {
    const declared = new Set(Object.keys(manifest.dependencies ?? {}))
    for (const row of declarations) {
      for (const name of pluginPackages(row.config?.plugins)) {
        expect(declared, `${row.config?.id as string} mounts ${name}`).toContain(name)
      }
    }
  })

  it('ships the creator preset the composition-authoring skills it mounts', () => {
    const cordis = declarations.find(row => row.config?.id === 'cordis')
    const rows = cordis?.config?.plugins as Row[]
    const skillRow = rows.find(row => row.id === 'skill-filesystem')
    expect(skillRow?.name).toBe('@deepseek-ai/dsh-skill-filesystem')
    expect(JSON.stringify(skillRow?.config)).toContain('@deepseek-ai/dsh-agent-preset')
    expect(readFileSync(join(REPO_ROOT, 'packages/preset/agent-preset/skills', 'editing-cordis-compositions', 'SKILL.md'), 'utf8'))
      .toMatch(/^---\nname: editing-cordis-compositions/u)
  })

  it('ships no preset with fresh-agent Ralph iteration enabled', () => {
    // The base bundle leaves `tool-ralph` off; the optional ralph bundle inserts
    // its own enabled row, so a preset that mounted it enabled would expose the
    // tool in every session by default.
    const enabled = declarations.flatMap(row => rowsWithId(row.config?.plugins, 'tool-ralph')
      .filter(found => found.disabled !== true)
      .map(() => row.config?.id as string))
    expect(enabled).toEqual([])
  })

  it('names every shipped preset file after the preset it declares', () => {
    for (const file of patchPaths.slice(1)) {
      const declared = loadOverlayPatches('shipped presets', file) as Row[]
      expect(declared[0]?.insert?.[0]?.config?.id).toBe(basename(file).replace(/\.patch\.yml$/u, ''))
    }
  })
})
