/**
 * Web notes panel, node half. Owns the notes storage domain, serves the notes
 * settings namespace, and drives collected materials into the dsh Sessions
 * that answer them. The browser half is the panel itself.
 * @module @deepseek-ai/dsh-notes
 */

import type { Context } from '@deepseek-ai/cordis'
import { Analysis } from './analysis.ts'
import { Materials } from './materials.ts'
import { NoteSessions } from './note-sessions.ts'
import { NotesRemote } from './remote.ts'
import { NotesSettings } from './settings.ts'
import type { Config } from './settings.ts'
import { NotesStore } from './store.ts'

/** Cordis plugin name. */
export const name = 'notes'

/**
 * Services the host half needs before it can activate. The plugin opens its own
 * storage domain and serves its own settings section, so the only external
 * requirement is the storage hub's domain facility.
 */
export const inject: string[] = ['storageDomain']

/**
 * The row's config schema, so the Loader validates and defaults it. The Loader
 * reads `Config` from the entry module's namespace, so it must be exported
 * here and not only from `settings.ts`.
 */
export { Config } from './settings.ts'

/**
 * Host plugin body. Each service below declares its own injections, so mounting
 * order fixes only which service publishes first, not whether the others
 * activate once their dependencies appear.
 * @param ctx - host context.
 * @param config - the row's validated composition entry.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(NotesStore)
  ctx.plugin(Materials)
  ctx.plugin(NoteSessions)
  ctx.plugin(NotesSettings, config)
  ctx.plugin(Analysis)
  ctx.plugin(NotesRemote)
}
