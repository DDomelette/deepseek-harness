import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionFlagProvider, SessionFlags, SessionFlagsSnapshot } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionFlags: SessionFlagRegistry
  }
}

/** Merges presentation-flag providers in registration order; later providers win per key. */
export class SessionFlagRegistry extends Service {
  private readonly providers: SessionFlagProvider[] = []
  private lastGood: SessionFlagsSnapshot = { flags: {}, complete: true }

  constructor(ctx: Context) {
    super(ctx, 'sessionFlags')
  }

  /**
   * Register one flag provider. Provider ids are unique within the registry.
   *
   * @param provider - Synchronous source of flags keyed by session id.
   * @returns Disposer that removes the provider.
   */
  registerProvider(provider: SessionFlagProvider): () => void {
    if (this.providers.some(entry => entry.id === provider.id)) {
      throw new Error(`duplicate session flag provider "${provider.id}"`)
    }
    this.providers.push(provider)
    return () => {
      const index = this.providers.indexOf(provider)
      if (index !== -1) this.providers.splice(index, 1)
    }
  }

  /**
   * Merge providers in registration order. Failed providers are logged and skipped; if every
   * provider fails, the registry returns the last complete snapshot when one is available.
   *
   * @returns Merged flags and whether every provider completed.
   */
  snapshot(): SessionFlagsSnapshot {
    const flags: Record<SessionId, SessionFlags> = {}
    let failed = false
    for (const provider of this.providers) {
      let next: Readonly<Record<SessionId, SessionFlags>>
      try {
        next = provider.list()
      } catch (error) {
        failed = true
        this.ctx.logger.warn(`session flag provider "${provider.id}" failed: ${String(error)}`)
        continue
      }
      for (const [id, value] of Object.entries(next)) {
        flags[id as SessionId] = { ...flags[id as SessionId], ...value }
      }
    }
    if (!failed) {
      this.lastGood = { flags, complete: true }
      return this.lastGood
    }
    if (Object.keys(flags).length === 0 && this.lastGood.complete) return this.lastGood
    return { flags, complete: false }
  }
}

export default SessionFlagRegistry
