/**
 * The bind policy this page reads and writes. The values mirror the
 * `dsh-web-app` startup entry's `bindMode`/`bindHost`; the operator-gated
 * `/pair/bind` route carries them, because their consumer (the listener) runs
 * before any page can load and only the operator may choose one.
 */

/** How a launch without `--host` picks its bind address. */
export type MobileBindMode = 'loopback' | 'auto' | 'fixed'

/** The two fields the page reads and writes. */
export interface MobileBindSettings {
  /** Policy in force for the next launch. */
  bindMode: MobileBindMode
  /** Concrete address `fixed` binds, and the fallback `auto` uses when detection finds nothing. */
  bindHost: string
}
