/**
 * The composer's Access seat data: the process-level permission catalog read
 * through the mounted Remote and refreshed by the forwarded
 * `permission-presets/catalog-changed` event.
 *
 * Session history carries the current selection alone (the `permissions`
 * Session projection), so the selectable presets live here. The published
 * options stay `undefined` until the first read settles, and the seat renders
 * nothing until then rather than a control that offers no choices.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { PermissionCatalog, PresetOption } from '@deepseek-ai/dsh-permission-presets/client'

/** Selectable presets the seat offers; absent until the first catalog read settles. */
export type PermissionOptions = readonly PresetOption[] | undefined

/** The narrow Remote face the seat reads; the mounted namespace satisfies it. */
export interface PermissionCatalogWire {
  /**
   * Read the process-level permission catalog.
   * @returns the catalog this Host currently serves, or a Remote refusal.
   */
  catalog(): Promise<RemoteResult<PermissionCatalog>>
}

/** One plugin's permission catalog, published as the seat's snapshot. */
export class PermissionCatalogSeat {
  /** Monotonic read identity, so a slow read cannot republish over a newer one. */
  private reads = 0

  /**
   * @param options - plugin-owned snapshot the seat publishes into, so the
   *   registration observes one stable source whether or not the Remote
   *   assembly is mounted yet.
   * @param wire - mounted Remote namespace that serves the catalog.
   * @param subscribeChanged - registers one refresh listener; the forwarded
   *   event carries no catalog state, so the listener re-reads.
   */
  constructor(
    private readonly options: SnapshotStore<PermissionOptions>,
    private readonly wire: PermissionCatalogWire,
    private readonly subscribeChanged: (listener: () => void) => () => void,
  ) {}

  /**
   * Read the catalog and publish its options. A read that fails leaves the
   * published snapshot untouched: a transient carrier failure must not empty a
   * live seat, and the next change event reads again.
   * @returns after the read settled and any winning result was published.
   */
  async refresh(): Promise<void> {
    const read = ++this.reads
    const catalog = await this.readCatalog()
    if (catalog === undefined || read !== this.reads) return
    this.options.set(catalog.options)
  }

  /**
   * Start the seat: read once and once more whenever the catalog changes.
   * @returns disposer removing the change subscription.
   */
  start(): () => void {
    void this.refresh()
    return this.subscribeChanged(() => { void this.refresh() })
  }

  /** One read, reporting an unusable answer as absent instead of rejecting. */
  private async readCatalog(): Promise<PermissionCatalog | undefined> {
    const result = await this.readWire()
    return result?.ok === true ? result.value : undefined
  }

  /** The Remote answer, or undefined when the carrier failed the read. */
  private async readWire(): Promise<RemoteResult<PermissionCatalog> | undefined> {
    try {
      return await this.wire.catalog()
    } catch {
      // A failed carrier read keeps the previous snapshot — an emptied seat
      // would be worse than a stale one — and the next event reads again.
      return undefined
    }
  }
}
