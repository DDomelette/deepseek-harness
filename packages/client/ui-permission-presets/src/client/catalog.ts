/**
 * The process permission catalog the Host serves: every selectable preset and
 * the effective default for new sessions. The General-settings default row and
 * the `/permission` popup read it through this one function, so both surfaces
 * offer the same choices and agree on the effective default — the row's own
 * namespace descriptor carries only what a write needs (writability, revision,
 * and the stored value once one exists).
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PermissionCatalog } from '@deepseek-ai/dsh-permission-presets/client'

/**
 * Read the Host's complete permission catalog.
 * @param ctx - client context carrying the permission Remote.
 * @returns the catalog the Host currently serves.
 * @throws when the Host refuses the read, naming its own error code and message.
 */
export async function readPermissionCatalog(ctx: ClientContext): Promise<PermissionCatalog> {
  const result = await ctx.remote.permissionPresets.catalog()
  if (!result.ok) {
    throw new Error(`permission catalog failed: ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}
