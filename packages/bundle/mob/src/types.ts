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
    /** No advertised authority or URL-compatible non-loopback listener is configured for phone access. */
    'mob/no-advertised-origin': {}
  }
}
