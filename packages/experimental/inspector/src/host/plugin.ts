/** Host Cordis plugin for the cross-realm Inspector Worker and full fetch capture. */

import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { INSPECTOR_BOOTSTRAP_PATH } from '../shared/web.ts'
import { disposeInspectorResources } from '../shared/dispose.ts'
import { resolveInspectorOptions, startInspector, type InspectorOptions } from './bridge/controller.ts'
import { createInspectorService } from '../shared/service.ts'
import { publishCordisTree } from './inspection/cordis.ts'

export { resolveInspectorOptions, startInspector } from './bridge/controller.ts'
export type { InspectorEndpoint, InspectorHandle, InspectorOptions, InspectorSpec } from './bridge/controller.ts'
export type { CordisRuntimeTreeReader } from '../shared/cordis/reader.ts'
export type {
  CordisRuntimeConnection,
  CordisRuntimeContext,
  CordisRuntimeFiber,
  CordisRuntimeNode,
  CordisRuntimeRealm,
  CordisRuntimeSource,
  CordisRuntimeTree,
} from '../shared/cordis/model.ts'
export type { InspectorClientBootstrap } from '../shared/bridge/messages/control.ts'
export type { InspectorRecordInput, InspectorSourceDescriptor, InspectorSourceKind } from '../shared/bridge/messages/observation.ts'
export type { InspectorJsonObject, InspectorJsonPrimitive, InspectorJsonValue } from '../shared/json.ts'
export type {
  CordisContextTreeNode,
  CordisFiberTreeNode,
  CordisTreeNode,
  CordisTreeSnapshot,
} from '../shared/cordis/snapshot.ts'

/** Configuration consumed by the Host implementation after package-entry validation. */
export interface HostPluginConfig extends Omit<InspectorOptions, 'clientOrigins'> {
  /** Browser origins allowed to open the Client ingest WebSocket. */
  clientOrigins?: string[]
}

/** Start the Worker, expose `ctx.inspector`, and inject the matching Client bootstrap. */
export async function apply(ctx: Context, config: HostPluginConfig): Promise<void> {
  await ctx.effect(async () => {
    const spec = resolveInspectorOptions(config)
    const handle = await startInspector(spec)
    const disposers: Array<() => unknown> = []
    try {
      disposers.push(publishCordisTree(ctx, handle.source, {
        maxNodes: spec.maxCordisNodes,
        maxBytes: spec.maxSourceFrameBytes - 4_096,
      }))
      disposers.push(ctx.provide('inspector', createInspectorService(handle.source)))
      disposers.push(ctx.on('webserver/index-inject', (table: IndexInjection[]) => {
        table.push({ kind: 'global', name: '__DSH_INSPECTOR__', value: handle.endpoint.client })
      }))
      disposers.push(ctx.connection.fetch.register({
        path: INSPECTOR_BOOTSTRAP_PATH, methods: ['GET'], requestBody: 'none',
        fetch: () => Promise.resolve(Response.json(handle.endpoint.client, {
          headers: { 'cache-control': 'no-store' },
        })),
      }))
      // This readiness URL is emitted while the plugin tree is still loading, before a logger sink is guaranteed.
      console.log(`dsh inspector: ${handle.endpoint.devtoolsFrontendUrl}`)
    } catch (error) {
      await disposeInspectorResources(disposers, () => handle.close(), 'experimental-inspector: disposal failed').catch((cleanupError: unknown) => {
        ctx.logger.error('experimental-inspector: initialization rollback failed', cleanupError)
      })
      throw error
    }
    return async () => { await disposeInspectorResources(disposers, () => handle.close(), 'experimental-inspector: disposal failed') }
  }, 'experimental-inspector: Host Worker')
}
