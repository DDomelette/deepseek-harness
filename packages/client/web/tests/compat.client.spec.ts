import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserCompat } from '../src/compat.ts'

/** The globals the floor patches, viewed as writable properties. */
interface CompatHosts {
  AbortSignal: { any?: unknown }
  Promise: { withResolvers?: unknown }
  Iterator?: unknown
}

const hosts = globalThis as unknown as CompatHosts
const originals: { any: unknown; withResolvers: unknown; iterator: unknown } = {
  any: undefined,
  withResolvers: undefined,
  iterator: undefined,
}

/**
 * The engine's intrinsic %IteratorPrototype%, reached through an array iterator
 * so the lookup carries no generator syntax the spec transform could rewrite.
 */
function intrinsicIteratorPrototype(): object {
  const iterator = ([] as unknown[])[Symbol.iterator]()
  return Object.getPrototypeOf(Object.getPrototypeOf(iterator)) as object
}

beforeEach(() => {
  originals.any = hosts.AbortSignal.any
  originals.withResolvers = hosts.Promise.withResolvers
  originals.iterator = hosts.Iterator
  delete hosts.AbortSignal.any
  delete hosts.Promise.withResolvers
  delete hosts.Iterator
})

afterEach(() => {
  hosts.AbortSignal.any = originals.any
  hosts.Promise.withResolvers = originals.withResolvers
  if (originals.iterator === undefined) delete hosts.Iterator
  else hosts.Iterator = originals.iterator
  vi.restoreAllMocks()
})

describe('browser floor', () => {
  it('defines every API the shell bundles call unconditionally', async () => {
    installBrowserCompat()
    expect(typeof hosts.AbortSignal.any).toBe('function')
    expect(typeof hosts.Promise.withResolvers).toBe('function')

    // pdfjs-dist writes Iterator.prototype.join at import time; the carrier must
    // put that write where an iterator created by the engine reaches it.
    const installed = hosts.Iterator as { prototype: Record<string, unknown> }
    const iterator = ([] as unknown[])[Symbol.iterator]() as unknown as Record<string, unknown>
    expect(installed.prototype).toBe(intrinsicIteratorPrototype())
    try {
      installed.prototype.join = 'pdfjs-write'
      expect(iterator.join).toBe('pdfjs-write')
    } finally {
      delete installed.prototype.join
    }

    const resolvers = (hosts.Promise.withResolvers as <T>() => PromiseWithResolvers<T>)<string>()
    resolvers.resolve('settled')
    await expect(resolvers.promise).resolves.toBe('settled')
    const rejected = (hosts.Promise.withResolvers as <T>() => PromiseWithResolvers<T>)<string>()
    rejected.reject(new Error('refused'))
    await expect(rejected.promise).rejects.toThrow('refused')
  })

  it('leaves an engine-provided API untouched', () => {
    const any = vi.fn()
    const withResolvers = vi.fn()
    const iterator = { marker: 'engine' }
    hosts.AbortSignal.any = any
    hosts.Promise.withResolvers = withResolvers
    hosts.Iterator = iterator

    installBrowserCompat()

    expect(hosts.AbortSignal.any).toBe(any)
    expect(hosts.Promise.withResolvers).toBe(withResolvers)
    expect(hosts.Iterator).toBe(iterator)
  })

  it('fuses sources with the reason of the first one to abort', () => {
    installBrowserCompat()
    const first = new AbortController()
    const second = new AbortController()
    const fused = (hosts.AbortSignal.any as (signals: AbortSignal[]) => AbortSignal)([first.signal, second.signal])

    expect(fused.aborted).toBe(false)
    second.abort(new Error('second'))
    expect(fused.aborted).toBe(true)
    expect((fused.reason as Error).message).toBe('second')
    first.abort(new Error('first'))
    expect((fused.reason as Error).message).toBe('second')
  })

  it('aborts at once from an already-aborted source and subscribes to no later one', () => {
    installBrowserCompat()
    const spent = new AbortController()
    spent.abort(new Error('spent'))
    const later = new AbortController()
    const subscribe = vi.spyOn(later.signal, 'addEventListener')

    const fused = (hosts.AbortSignal.any as (signals: AbortSignal[]) => AbortSignal)([spent.signal, later.signal])

    expect(fused.aborted).toBe(true)
    expect((fused.reason as Error).message).toBe('spent')
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('releases every source subscription once the fused signal aborts', () => {
    installBrowserCompat()
    const first = new AbortController()
    const second = new AbortController()
    const releaseFirst = vi.spyOn(first.signal, 'removeEventListener')
    const releaseSecond = vi.spyOn(second.signal, 'removeEventListener')

    const fused = (hosts.AbortSignal.any as (signals: AbortSignal[]) => AbortSignal)([first.signal, second.signal])
    first.abort()

    expect(fused.aborted).toBe(true)
    expect(releaseFirst).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(releaseSecond).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
