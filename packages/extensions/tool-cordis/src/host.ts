/** Host-plane registration of the first-party Cordis inspect providers. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { hostInspectProviders } from './providers.ts'

/** Host provider set options. */
export interface Config {
  /** Expose the sandbox's plain-JavaScript globals as the `Builtin` provider; on only where the dynamic runner is mounted. */
  dynamicPlugins?: boolean
}

/** Validated provider-set options. */
export const Config: z<Config> = z.object({
  dynamicPlugins: z.boolean(),
})

export const name = 'cordis-inspect-providers'
/** Required services: the Host inspect registry and the Tool registry the `Tool` provider reads. */
export const inject = ['cordisInspect', 'tools']

/**
 * Register the Host inspect providers once per process. The registry keys
 * providers by id and rejects a duplicate, so this row belongs to the host
 * composition beside `cordis-host-runner`; every per-session `tool-cordis`
 * row reads the shared set through its tools.
 * @param ctx Host composition context.
 * @param config - provider-set options; `dynamicPlugins` adds the sandbox `Builtin` directory.
 */
export function apply(ctx: Context, config: Config = {}): void {
  for (const provider of hostInspectProviders(ctx, config.dynamicPlugins === true)) {
    ctx.effect(() => ctx.cordisInspect.register(provider), `cordis-inspect-providers: ${provider.manifest.id}`)
  }
}
