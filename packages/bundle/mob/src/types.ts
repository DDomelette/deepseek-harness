/**
 * Browser-safe failure vocabulary of the `mob` Remote namespace, shared by the
 * Host throw site and the Client dialog. The leading `export {}` keeps the
 * file a module so the declaration below augments the protocol module instead
 * of shadowing it.
 *
 * @module @deepseek-ai/dsh-mob/types
 */

export {}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A loopback-only deployment has no LAN address a phone can join through. */
    'mob/loopback-only': {}
    /** The bind covers the network, but no interface yielded an address a phone can reach. */
    'mob/no-lan-address': {}
  }
}
