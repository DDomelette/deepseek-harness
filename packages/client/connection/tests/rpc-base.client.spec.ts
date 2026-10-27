/** RPC URLs preserve the application mount in pages and Workers. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebConnectionRpc } from '../src/client/rpc.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('RPC application base', () => {
  it.each([
    { document: { baseURI: 'https://page.example/mount/' }, location: { href: 'https://worker.example/ignored/worker.js' }, base: 'https://page.example/mount/' },
    { document: { baseURI: 'https://page.example/mount' }, location: undefined, base: 'https://page.example/mount/' },
    { document: { baseURI: '' }, location: { href: 'https://worker.example/prefix/worker.js' }, base: 'https://worker.example/prefix/' },
    { document: { baseURI: 'null' }, location: { href: 'https://worker.example/prefix/worker.js' }, base: 'https://worker.example/prefix/' },
    { document: undefined, location: { href: 'https://worker.example/prefix/worker.js' }, base: 'https://worker.example/prefix/' },
    { document: undefined, location: { href: '', origin: 'https://origin.example' }, base: 'https://origin.example/' },
    { document: undefined, location: { href: 'null', origin: 'https://origin.example' }, base: 'https://origin.example/' },
    { document: undefined, location: { origin: 'null' }, base: 'http://dsh.internal/' },
    { document: undefined, location: {}, base: 'http://dsh.internal/' },
    { document: undefined, location: undefined, base: 'http://dsh.internal/' },
  ])('posts inside $base for document=$document and location=$location', async ({ document, location, base }) => {
    vi.stubGlobal('document', document)
    vi.stubGlobal('location', location)
    try {
      const urls: string[] = []
      const rpc = createWebConnectionRpc(async (target, init) => {
        urls.push(target.href)
        const message = JSON.parse(init.body as string) as { rpcId: string }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value: 'done' } })
      })
      expect(await rpc.call('/api', 'fixture/read', {})).toEqual({ ok: true, value: 'done' })
      expect(urls).toEqual([base + 'api/fixture/read'])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
