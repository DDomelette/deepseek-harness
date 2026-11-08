/**
 * The persistent bind policy this page edits: the `dsh-web-app` startup entry's
 * Config namespace and the two fields the page writes. The values mirror the
 * Host schema's `bindMode`/`bindHost`; this page is the only editor, because
 * their consumer (the listener) runs before any page can load.
 */

/**
 * Settings namespace of the Host entry that carries the policy.
 * It is the Loader entry id of `@deepseek-ai/dsh-web-app/startup`.
 */
export const WEB_STARTUP_NAMESPACE = 'web-startup'

/** How a launch without `--host` picks its bind address. */
export type MobileBindMode = 'loopback' | 'auto' | 'fixed'

/** The two fields this page reads and writes. */
export interface MobileBindSettings {
  /** Policy in force for the next launch. */
  bindMode: MobileBindMode
  /** Concrete address `fixed` binds; ignored by the other modes. */
  bindHost: string
}
