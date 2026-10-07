/**
 * Best-effort MAC resolution for a LAN peer. The pairing handshake sees only
 * the phone's source address, so the system ARP table is the one place that
 * still knows the hardware address of a device that just talked to us; the
 * resolved MAC is stored on the device row as its hardware fingerprint.
 * @module @deepseek-ai/dsh-mob/src/mac
 */

import { execFile } from 'node:child_process'

/** MAC as `arp` prints it: six octets joined by colons or hyphens. */
const ARP_MAC_PATTERN = /(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}/iu
/** Rows that are never a phone: broadcast, IPv4 multicast, and the all-zero address an unresolved row carries. */
const UNUSABLE_MAC_PATTERN = /^(?:ff[:-]){5}ff$|^01[:-]00[:-]5e|^(?:00[:-]){5}00$/iu
/** An IPv4 literal, the only sources an ARP table indexes. */
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/u
/** Longest an ARP read may take before the approval proceeds without it. */
const ARP_TIMEOUT_MILLISECONDS = 3_000

/**
 * Run the platform's ARP read for one address and answer its raw output.
 * @param ip - the IPv4 literal to look up.
 * @returns the raw `arp` output, rejecting when the tool is missing or fails.
 */
export type ArpLookup = (ip: string) => Promise<string>

/* v8 ignore start -- process plumbing: the parsing and failure logic is covered
   through resolveMacAddress's injected lookup; this shell-out only forwards to
   the platform tool. */
/** The platform's ARP read: `arp -a <ip>` on Windows, `arp -n <ip>` elsewhere. */
const runArp: ArpLookup = ip => new Promise((resolve, reject) => {
  const args = process.platform === 'win32' ? ['-a', ip] : ['-n', ip]
  execFile('arp', args, { timeout: ARP_TIMEOUT_MILLISECONDS }, (error, stdout) => {
    if (error !== null) {
      reject(new Error('arp lookup failed', { cause: error }))
      return
    }
    resolve(stdout)
  })
})
/* v8 ignore stop */

/**
 * Extract the MAC one ARP listing records for an address.
 * @param output - raw `arp` output, in any locale.
 * @param ip - the address whose row to read.
 * @returns the normalized `aa:bb:cc:dd:ee:ff` address, or undefined.
 */
export function macFromArpOutput(output: string, ip: string): string | undefined {
  const row = new RegExp(`(?:^|\\s)${ip.replaceAll('.', '\\.')}(?:\\s|$)`, 'u')
  for (const line of output.split('\n')) {
    if (!row.test(line)) continue
    const match = ARP_MAC_PATTERN.exec(line)
    if (match === null || UNUSABLE_MAC_PATTERN.test(match[0])) continue
    return match[0].toLowerCase().replaceAll('-', ':')
  }
  return undefined
}

/**
 * Resolve the hardware address of one LAN peer. A phone that just claimed a
 * pairing code leaves a fresh ARP entry, but a missing or stale entry, a
 * non-IPv4 source, or a platform without `arp` all answer undefined rather
 * than fail the approval.
 * @param source - the claiming request's remote address.
 * @param lookup - ARP reader; tests inject their own.
 * @returns the normalized MAC address, or undefined when it cannot be known.
 */
export async function resolveMacAddress(source: string, lookup: ArpLookup = runArp): Promise<string | undefined> {
  if (!IPV4_PATTERN.test(source)) return undefined
  try {
    return macFromArpOutput(await lookup(source), source)
  } catch {
    // The ARP read is decoration for the device row: a missing `arp` binary, a
    // nonzero exit, or a timeout must not fail an approval.
    return undefined
  }
}
