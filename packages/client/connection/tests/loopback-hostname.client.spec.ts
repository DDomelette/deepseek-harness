/** Shared loopback-hostname semantics for the Host fence and browser UI. */

import { describe, expect, it } from 'vitest'
import { isLoopbackHostname } from '../src/loopback-hostname.ts'

describe('isLoopbackHostname', () => {
  it('accepts localhost, IPv6 loopback, and the whole IPv4 127/8 block', () => {
    for (const hostname of ['localhost', '[::1]', '127.0.0.1', '127.8.9.10', '127.255.255.255']) {
      expect(isLoopbackHostname(hostname)).toBe(true)
    }
  })

  it('accepts the absolute form of localhost and IPv4-mapped literals', () => {
    for (const hostname of [
      'localhost.',
      '127.0.0.1.',
      '[::ffff:7f00:1]',
      '[::ffff:127.0.0.1]',
      '[::FFFF:7F00:0001]',
      '[::ffff:7f01:1]',
      '[::ffff:127.0.1.2]',
    ]) {
      expect(isLoopbackHostname(hostname)).toBe(true)
    }
  })

  it('refuses malformed and non-loopback hostnames', () => {
    for (const hostname of [
      'remote.localhost',
      '::1',
      '128.0.0.1',
      '127.0.0',
      '127.0.0.256',
      '127.0.0.-1',
      '[::ffff:8000:1]',
      '[::ffff:zzzz:1]',
      '[::ffff:7f00]',
      '[fe80::1]',
      '[::ffff:7f00:1',
    ]) {
      expect(isLoopbackHostname(hostname)).toBe(false)
    }
  })
})
