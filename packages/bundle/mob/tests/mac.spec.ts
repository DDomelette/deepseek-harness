/**
 * MAC resolution from ARP output: row matching, unusable-address filtering,
 * normalization, and the failures that must answer undefined.
 */

import { describe, expect, it, vi } from 'vitest'
import { macFromArpOutput, resolveMacAddress } from '../src/mac.ts'

const WINDOWS_LISTING = [
  'Interface: 192.168.0.1 --- 0xb',
  '  Internet Address      Physical Address      Type',
  '  192.168.0.122         48-A7-3C-F1-87-18     dynamic',
  '  192.168.0.255         FF-FF-FF-FF-FF-FF     static',
].join('\r\n')

const LINUX_LISTING = [
  'Address                  HWtype  HWaddress           Flags Mask            Iface',
  '192.168.0.122            ether   48:a7:3c:f1:87:18   C                     wlan0',
  '192.168.0.122            ether   9c:8e:99:00:11:22   C                     eth0',
].join('\n')

describe('macFromArpOutput', () => {
  it('reads the row for the requested address and normalizes case and separators', () => {
    expect(macFromArpOutput(WINDOWS_LISTING, '192.168.0.122')).toBe('48:a7:3c:f1:87:18')
    expect(macFromArpOutput(LINUX_LISTING, '192.168.0.122')).toBe('48:a7:3c:f1:87:18')
  })

  it('matches the address only at a column boundary', () => {
    const listing = '  192.168.0.10         48-A7-3C-F1-87-18     dynamic'
    expect(macFromArpOutput(listing, '192.168.0.1')).toBeUndefined()
    expect(macFromArpOutput(listing, '192.168.0.10')).toBe('48:a7:3c:f1:87:18')
  })

  it('skips broadcast and multicast rows instead of reporting them as a phone', () => {
    expect(macFromArpOutput(WINDOWS_LISTING, '192.168.0.255')).toBeUndefined()
    const multicast = '  224.0.0.22            01-00-5E-00-00-16     static'
    expect(macFromArpOutput(multicast, '224.0.0.22')).toBeUndefined()
  })

  it('skips the all-zero address an unresolved row carries', () => {
    const windows = '  192.168.0.122         00-00-00-00-00-00     dynamic'
    const linux = '192.168.0.122            ether   00:00:00:00:00:00   C                     wlan0'
    expect(macFromArpOutput(windows, '192.168.0.122')).toBeUndefined()
    expect(macFromArpOutput(linux, '192.168.0.122')).toBeUndefined()
  })

  it('answers undefined when no row names the address or the row carries no MAC', () => {
    expect(macFromArpOutput(WINDOWS_LISTING, '192.168.0.200')).toBeUndefined()
    expect(macFromArpOutput('', '192.168.0.122')).toBeUndefined()
    expect(macFromArpOutput('  192.168.0.122         (incomplete)          dynamic', '192.168.0.122'))
      .toBeUndefined()
  })
})

describe('resolveMacAddress', () => {
  it('resolves through the injected ARP reader', async () => {
    const lookup = vi.fn(async () => WINDOWS_LISTING)
    expect(await resolveMacAddress('192.168.0.122', lookup)).toBe('48:a7:3c:f1:87:18')
    expect(lookup).toHaveBeenCalledWith('192.168.0.122')
  })

  it('answers undefined without invoking the reader for a non-IPv4 source', async () => {
    const lookup = vi.fn(async () => WINDOWS_LISTING)
    expect(await resolveMacAddress('unknown', lookup)).toBeUndefined()
    expect(await resolveMacAddress('::ffff:192.168.0.122', lookup)).toBeUndefined()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('answers undefined when the ARP read fails rather than failing the approval', async () => {
    expect(await resolveMacAddress('192.168.0.122', async () => {
      throw new Error('arp: command not found')
    })).toBeUndefined()
  })
})
