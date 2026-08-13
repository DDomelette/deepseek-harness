/**
 * Hot-mount supervisor: diffs consecutive resolved `mcp-servers` sections and
 * mounts or disposes one dsh-mcp-client fiber per enabled entry. Status
 * tracking wraps the mount point only — mcp-client's public API stays
 * untouched.
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { deepEqualJson } from '@deepseek-ai/dsh-settings'
import type { McpServerEntryConfig, McpServersSection } from './schema.ts'

/** One reconciler action between two sections. */
export interface ServerAction {
  readonly kind: 'mount' | 'dispose' | 'remount'
  readonly serverName: string
}

/** Panel-visible state of one settings-managed server. */
export interface ManagedServerState {
  readonly serverName: string
  /** Transport copied from the settings entry at mount time. */
  readonly transport: McpServerEntryConfig['transport']
  /** Always true: disabled entries carry no state — `list()` reports mounted servers only. */
  readonly enabled: boolean
  /**
   * Activation outcome of the mounted fiber. With `failOnStartupError: false`
   * an unreachable server still activates (mcp-client keeps reconnecting), so
   * `ready` means activation settled, not that the server answered.
   */
  readonly status: 'connecting' | 'ready' | 'failed'
  /** Failure message when `status` is `failed`. */
  readonly error?: string
}

/** One live mount: the child fiber plus its last published state. */
interface Mount {
  /** Null only when fiber construction itself threw (state is then `failed`). */
  readonly fiber: Fiber | null
  state: ManagedServerState
}

/**
 * Diff two resolved sections into mount/dispose/remount actions. An entry
 * whose `enabled` flips false becomes `dispose`; any other field change on a
 * live entry becomes `remount`. Equality is deep over the resolved entry.
 * @param prev - previously applied section.
 * @param next - newly resolved section.
 * @returns actions in stable key order (disposes before mounts).
 */
export function planServerDiff(prev: McpServersSection, next: McpServersSection): ServerAction[] {
  const actions: ServerAction[] = []
  for (const [key, before] of Object.entries(prev)) {
    const after = next[key]
    if (after === undefined || !after.enabled) {
      if (before.enabled) actions.push({ kind: 'dispose', serverName: key })
      continue
    }
    if (!before.enabled) continue // handled as mount below
    if (!deepEqualJson(before, after)) actions.push({ kind: 'remount', serverName: key })
  }
  for (const [key, after] of Object.entries(next)) {
    if (!after.enabled) continue
    const before = prev[key]
    if (before === undefined || !before.enabled) actions.push({ kind: 'mount', serverName: key })
  }
  return actions
}

/**
 * Own the live mcp-client fibers for the settings-managed roster. All fibers
 * are children of the constructing context. Reconciliations run serialized on
 * an internal queue so a remount's new fiber never loads before the old one
 * finished disposing (mcp-client reserves `serverName` per app root for the
 * fiber's whole lifetime). `dispose()` waits for queued work, then tears the
 * roster down in reverse mount order.
 */
export class McpServerSupervisor {
  private readonly mounts = new Map<string, Mount>()
  private section: McpServersSection = {}
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  /**
   * @param ctx - host context the mcp-client fibers parent onto.
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Reconcile live mounts against a newly resolved section. Returns
   * immediately; the actions run on the supervisor's serial queue.
   * @param next - newly resolved `mcp-servers` section.
   */
  sync(next: McpServersSection): void {
    if (this.disposed) return
    const actions = planServerDiff(this.section, next)
    this.section = next
    if (!actions.length) return
    const reconcile = async (): Promise<void> => {
      for (const action of actions) {
        if (action.kind !== 'mount') await this.unmount(action.serverName)
        // Mount/remount actions always name an enabled entry in `next`.
        const entry = next[action.serverName]
        if (action.kind !== 'dispose' && entry && !this.disposed) {
          this.mount(action.serverName, entry)
        }
      }
    }
    // The queue needs no rejection handler: unmount only awaits
    // fiber.dispose(), which never rejects (cordis logs unload errors
    // itself), and mount folds its own failures into the entry's state.
    this.queue = this.queue.then(reconcile)
  }

  /**
   * Snapshot of the mounted roster. Disabled entries are absent by design —
   * the gateway reads the section for those rows. Returned objects are
   * replaced (never mutated) on transition, so a snapshot stays stable.
   * @returns current per-server state in mount order.
   */
  list(): ManagedServerState[] {
    return [...this.mounts.values()].map(mount => mount.state)
  }

  /**
   * Resolved section from the latest `sync`, including the disabled entries
   * `list()` omits. The reference is replaced (never mutated) on each sync, so
   * a read stays a stable snapshot.
   * @returns the current resolved `mcp-servers` section.
   */
  currentSection(): McpServersSection {
    return this.section
  }

  /**
   * Stop reconciling and tear down the roster in reverse mount order.
   * @returns settlement after queued work drained and every live fiber is disposed.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.queue
    for (const serverName of [...this.mounts.keys()].reverse()) await this.unmount(serverName)
  }

  private mount(serverName: string, entry: McpServerEntryConfig): void {
    const state: ManagedServerState = { serverName, transport: entry.transport, enabled: true, status: 'connecting' }
    const { enabled: _enabled, ...config } = entry
    let fiber: Fiber
    try {
      fiber = this.ctx.plugin(McpClient, { ...config, serverName })
    } catch (error) {
      // Synchronous throws here are config-schema rejection or a disposed
      // host fiber; the entry fails loud in its state instead of breaking
      // the rest of the roster.
      this.mounts.set(serverName, { fiber: null, state: { ...state, status: 'failed', error: errorMessage(error) } })
      return
    }
    const mount: Mount = { fiber, state }
    this.mounts.set(serverName, mount)
    // ctx.plugin returns an awaitable Fiber: settlement means the initial
    // connection plus tool discovery finished; rejection means startup failed.
    void Promise.resolve(fiber).then(
      () => { this.settle(mount, { status: 'ready' }) },
      (error: unknown) => { this.settle(mount, { status: 'failed', error: errorMessage(error) }) },
    )
  }

  private settle(mount: Mount, update: Partial<ManagedServerState>): void {
    // A remount may have replaced this mount before its fiber settled; only
    // the live mount absorbs the outcome.
    if (this.mounts.get(mount.state.serverName) !== mount) return
    mount.state = { ...mount.state, ...update }
  }

  private async unmount(serverName: string): Promise<void> {
    const mount = this.mounts.get(serverName)
    if (!mount) return
    this.mounts.delete(serverName)
    await mount.fiber?.dispose()
  }
}

/** Best-effort message extraction for an unknown thrown value. */
function errorMessage(error: unknown): string {
  /* v8 ignore next 2 -- cordis and mcp-client only ever throw Error instances */
  return error instanceof Error ? error.message : String(error)
}

/**
 * Live supervisors per app, keyed off `ctx.root` (multiple apps in one
 * process — tests — must not see each other's rosters); the same pattern as
 * mcp-client's `activeServerNames`. The manager plugin is the only registrant;
 * the gateway reads its roster through this seam.
 */
const supervisors = new WeakMap<Context, McpServerSupervisor>()

/**
 * Publish a supervisor for the app owning `ctx`. The returned disposer
 * unpublishes only when this supervisor is still the registered one, so a
 * stale teardown never removes a newer registration.
 * @param ctx - any context of the owning app; keyed on its root.
 * @param supervisor - roster owner to publish.
 * @returns unpublish disposer for the manager's teardown path.
 */
export function trackSupervisor(ctx: Context, supervisor: McpServerSupervisor): () => void {
  const root = ctx.root
  supervisors.set(root, supervisor)
  return () => {
    if (supervisors.get(root) === supervisor) supervisors.delete(root)
  }
}

/**
 * Look up the supervisor published for the app owning `ctx`.
 * @param ctx - any context of the app to query.
 * @returns the live supervisor, or undefined when no manager is mounted there.
 */
export function supervisorFor(ctx: Context): McpServerSupervisor | undefined {
  return supervisors.get(ctx.root)
}
