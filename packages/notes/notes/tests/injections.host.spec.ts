/**
 * Every service a plugin body reaches is declared where it reaches it.
 *
 * Cordis resolves `ctx.<name>` by walking the accessing fiber's parent chain,
 * and the loaded runtime throws `cannot get property "<name>" without inject`
 * when the walk ends first — a hand-built context instead falls back to the
 * global store, so a unit suite cannot see the omission, and the panel receives
 * it as an unreachable Host. This pins the declaration for every file that owns
 * a fiber (one that declares `inject`); `ctx.get(name)` is the documented way to
 * reach an optional service and needs no declaration, and a helper that takes a
 * caller's context belongs to that caller's declaration rather than its own.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Context members that are framework plumbing rather than services. */
const PLUMBING = new Set([
  'accessor', 'bail', 'baseUrl', 'effect', 'emit', 'events', 'extend', 'fiber', 'inject',
  'isolate', 'loader', 'logger', 'mixin', 'on', 'once', 'parallel', 'plugin', 'provide',
  'reflect', 'root', 'scope', 'set', 'start', 'stop', 'waterfall',
])

const SOURCE = join(import.meta.dirname, '..', 'src')

/**
 * Every host and browser source file that owns a fiber, with what it declares
 * and reaches.
 * @returns one record per plugin body, in file order.
 */
function declarations(): { file: string; declared: string[]; reached: string[] }[] {
  const files = [
    ...readdirSync(SOURCE).filter(file => file.endsWith('.ts')).map(file => join(SOURCE, file)),
    ...readdirSync(join(SOURCE, 'client'))
      .filter(file => file.endsWith('.ts') || file.endsWith('.tsx'))
      .map(file => join(SOURCE, 'client', file)),
  ]
  return files
    .map((path) => {
      const text = readFileSync(path, 'utf8')
      const declared = [...text.matchAll(/(?:static inject|export const inject(?::[^=]+)?) = \[([^\]]*)\]/g)]
        .flatMap(match => [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map(quoted => quoted[1] as string))
      const reached = [...text.matchAll(/\b(?:this\.)?ctx\.([A-Za-z_$][\w$]*)/g)]
        .map(match => match[1] as string)
        .filter(name => name !== 'get' && !PLUMBING.has(name))
      return {
        file: path.slice(SOURCE.length + 1).replace(/\\/g, '/'),
        declared,
        reaches: [...new Set(reached)].sort(),
        ownsFiber: /static inject|export const inject/.test(text),
      }
    })
    .filter(entry => entry.ownsFiber)
    .map(({ file, declared, reaches }) => ({ file, declared, reached: reaches }))
}

describe('host injection declarations', () => {
  it('declares every service each plugin body reaches through the context proxy', () => {
    const files = declarations()
    // Guard against an empty corpus: a moved source root must fail loudly
    // rather than pass by finding nothing to check.
    expect(files.length).toBeGreaterThan(4)

    const undeclared = files
      .map(entry => ({ file: entry.file, missing: entry.reached.filter(name => !entry.declared.includes(name)) }))
      .filter(entry => entry.missing.length > 0)

    expect(undeclared).toEqual([])
  })
})
