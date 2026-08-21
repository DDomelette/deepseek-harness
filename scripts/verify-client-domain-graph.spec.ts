import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveClientImport } from './verify-client-domain-graph.ts'

describe('client domain import resolution', () => {
  it('preserves imports that leave src/client from a top-level file', () => {
    expect(resolveClientImport('styles.ts', '../styles/base.css?inline'))
      .toBe('../styles/base.css?inline')
  })

  it('normalizes imports between domains inside src/client', () => {
    expect(resolveClientImport('input/hub.ts', '../queue/store.ts'))
      .toBe('queue/store.ts')
  })

  it('accepts the repository client source tree', () => {
    const gate = resolve(import.meta.dirname, 'verify-client-domain-graph.ts')
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', gate], {
      encoding: 'utf8',
    })

    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 0,
      stdout: 'verify-client-domain-graph: client domain layering clean.\n',
      stderr: '',
    })
  })
})
