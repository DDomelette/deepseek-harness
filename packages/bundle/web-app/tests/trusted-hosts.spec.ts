/** Single-sample LAN-trust resolution for the /api browser-trust fence (`resolveLanTrust`). */

import { networkInterfaces } from 'node:os'
import type { NetworkInterfaceInfo } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLanTrust } from '../src/index.ts'

vi.mock('node:os', () => ({
  networkInterfaces: vi.fn(),
}))

const interfaces = vi.mocked(networkInterfaces)

type IfaceMap = Record<string, NetworkInterfaceInfo[] | undefined>

const DEFAULT_INTERFACES: IfaceMap = {
  lo0: [
    { family: 'IPv4', internal: true, address: '127.0.0.1' } as NetworkInterfaceInfo,
  ],
  en0: [
    { family: 'IPv6', internal: false, address: 'fe80::1' } as NetworkInterfaceInfo,
    { family: 'IPv4', internal: false, address: '192.168.1.5' } as NetworkInterfaceInfo,
  ],
  en1: [
    { family: 'IPv4', internal: false, address: '10.0.0.7' } as NetworkInterfaceInfo,
  ],
  utun0: undefined,
}

beforeEach(() => {
  interfaces.mockReturnValue(DEFAULT_INTERFACES as never)
})

describe('resolveLanTrust', () => {
  it('samples non-internal IPv4 addresses once for an all-interfaces bind: trust and display share them', () => {
    const { lanAddresses, trustedHosts } = resolveLanTrust('0.0.0.0', ['harness.internal:3080'])
    expect(lanAddresses).toEqual(['192.168.1.5', '10.0.0.7'])
    expect(trustedHosts).toEqual(['192.168.1.5', '10.0.0.7', 'harness.internal:3080'])
  })

  it('derives nothing for a loopback bind — extras alone stand, no LAN URL to print', () => {
    expect(resolveLanTrust('127.0.0.1', [])).toEqual({ lanAddresses: [], trustedHosts: [] })
    expect(resolveLanTrust('127.0.0.1', ['lab.internal']))
      .toEqual({ lanAddresses: [], trustedHosts: ['lab.internal'] })
  })

  it('excludes the 198.18.0.0/15 fake-ip range from both display addresses and fence authorities', () => {
    interfaces.mockReturnValue({
      FlClash: [
        { family: 'IPv4', internal: false, address: '198.18.0.1' } as NetworkInterfaceInfo,
      ],
      'fake-ip-edge': [
        { family: 'IPv4', internal: false, address: '198.19.255.255' } as NetworkInterfaceInfo,
      ],
      WLAN: [
        { family: 'IPv4', internal: false, address: '192.168.0.126' } as NetworkInterfaceInfo,
      ],
    } as never)

    const { lanAddresses, trustedHosts } = resolveLanTrust('0.0.0.0', [])
    expect(lanAddresses).toEqual(['192.168.0.126'])
    expect(trustedHosts).toEqual(['192.168.0.126'])
  })

  it('sorts virtual and tunnel adapters after physical ones, keeping enumeration order within each group', () => {
    interfaces.mockReturnValue({
      FlClash: [
        { family: 'IPv4', internal: false, address: '10.255.0.2' } as NetworkInterfaceInfo,
      ],
      'VMware Network Adapter VMnet8': [
        { family: 'IPv4', internal: false, address: '192.168.88.1' } as NetworkInterfaceInfo,
      ],
      WLAN: [
        { family: 'IPv4', internal: false, address: '192.168.0.126' } as NetworkInterfaceInfo,
      ],
      'vEthernet (WSL)': [
        { family: 'IPv4', internal: false, address: '172.20.128.1' } as NetworkInterfaceInfo,
      ],
      en0: [
        { family: 'IPv4', internal: false, address: '192.168.1.5' } as NetworkInterfaceInfo,
      ],
    } as never)

    expect(resolveLanTrust('0.0.0.0', []).lanAddresses).toEqual([
      '192.168.0.126',
      '192.168.1.5',
      '10.255.0.2',
      '192.168.88.1',
      '172.20.128.1',
    ])
  })

  it('still returns virtual addresses when they are the only non-loopback path', () => {
    interfaces.mockReturnValue({
      lo0: [
        { family: 'IPv4', internal: true, address: '127.0.0.1' } as NetworkInterfaceInfo,
      ],
      'Tailscale Tunnel': [
        { family: 'IPv4', internal: false, address: '100.64.0.5' } as NetworkInterfaceInfo,
      ],
    } as never)

    const { lanAddresses, trustedHosts } = resolveLanTrust('0.0.0.0', [])
    expect(lanAddresses).toEqual(['100.64.0.5'])
    expect(trustedHosts).toEqual(['100.64.0.5'])
  })
})
