/** TCP-peer loopback classification shared by browser auth and the pairing routes. */

import { describe, expect, it } from 'vitest'
import { isLoopbackPeer } from '../src/request-authority.ts'

describe('isLoopbackPeer', () => {
  it('accepts every loopback form a dual-stack listener reports', () => {
    for (const remoteAddress of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      expect(isLoopbackPeer({ headers: {}, socket: { remoteAddress } })).toBe(true)
    }
  })

  it('refuses a LAN peer, a mapped LAN peer, and a request without a peer', () => {
    expect(isLoopbackPeer({ headers: {}, socket: { remoteAddress: '192.168.1.6' } })).toBe(false)
    expect(isLoopbackPeer({ headers: {}, socket: { remoteAddress: '::ffff:192.168.1.6' } })).toBe(false)
    expect(isLoopbackPeer({ headers: {} })).toBe(false)
  })
})
