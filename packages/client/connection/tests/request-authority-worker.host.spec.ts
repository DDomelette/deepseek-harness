import { expect, it, vi } from 'vitest'

it('rejects a request without a TCP peer when the runtime has no BlockList', async () => {
  vi.doMock('node:net', () => ({ BlockList: undefined }))
  try {
    const { isLoopbackPeer } = await import('../src/request-authority.ts')
    expect(isLoopbackPeer({ headers: {} })).toBe(false)
  } finally {
    vi.doUnmock('node:net')
    vi.resetModules()
  }
})
