/** Importing process primitives does not evaluate their native dependency. */
import { expect, it, vi } from 'vitest'

const nativeLoad = vi.hoisted(() => vi.fn(() => { throw new Error('native dependency evaluated during import') }))
vi.mock('koffi', () => nativeLoad())

it('imports process operations without loading Koffi', async () => {
  const primitives = await import('../src/index.ts')
  expect(primitives.spawnCurrentTokenJobProcess).toBeTypeOf('function')
  expect(primitives.probeCurrentTokenJobSupport).toBeTypeOf('function')
  expect(nativeLoad).not.toHaveBeenCalled()
})
