/**
 * Usage telemetry service: appends one JSONL row per completed model request
 * (assistant/message with usage) to $DSH_HOME/telemetry/usage-YYYY-MM-DD.jsonl.
 * Standalone cordis Service (NOT a SessionTelemetryBackend — that slot is
 * occupied by the OTel backend in the shipped bundles and allows exactly one
 * implementation). Enabled by default; the optional settings service may
 * override via the `usage-telemetry` namespace (`enabled: false`).
 *
 * @module @deepseek-ai/dsh-usage-telemetry
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// Merges `settings` onto the cordis Context interface and brands the namespace id.
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { createUsageWriter, type UsageWriter } from './writer.ts'
import { serializeRow, USAGE_ROW_VERSION, type UsageRow } from './schema.ts'

export interface UsageTelemetryConfig {
  enabled: boolean
}

export const UsageTelemetryConfig: z<UsageTelemetryConfig> = z.object({
  enabled: z.boolean().required(),
})

export class UsageTelemetry extends Service {
  static Config = UsageTelemetryConfig

  private enabled: boolean
  private readonly writer: UsageWriter
  private readonly lastModel = new WeakMap<Session, string | undefined>()
  private disposeSubscription: (() => boolean) | null = null

  private readonly onSessionEvent = (session: Session, event: SessionEvent): void => {
    this.contain(() => { this.handle(session, event) })
  }

  constructor(ctx: Context, config: UsageTelemetryConfig) {
    super(ctx, 'usageTelemetry')
    this.enabled = config.enabled
    this.writer = createUsageWriter({ root: join(resolveDshHome(), 'telemetry') })
  }

  protected [Service.init](): void {
    this.syncSubscription()
    // Optional settings override: `usage-telemetry:\n  enabled: false` in
    // settings.yaml disables the emitter. Absent a settings provider the
    // composition config stays authoritative.
    this.ctx.inject(['settings'], (sctx) => {
      const scope = sctx.settings.register(settingsNamespace('usage-telemetry'), UsageTelemetryConfig, {
        base: { enabled: this.enabled },
      })
      this.enabled = scope.get().enabled
      this.syncSubscription()
      scope.watch(() => {
        this.enabled = scope.get().enabled
        this.syncSubscription()
      })
    })
  }

  /** Subscribe exactly while enabled (spec: a disabled emitter costs nothing). */
  private syncSubscription(): void {
    if (this.enabled && this.disposeSubscription === null) {
      this.disposeSubscription = this.ctx.on('session/event', this.onSessionEvent)
    } else if (!this.enabled && this.disposeSubscription !== null) {
      this.disposeSubscription()
      this.disposeSubscription = null
    }
  }

  private handle(session: Session, event: SessionEvent): void {
    if (event.type === 'request/header') {
      this.lastModel.set(session, event.data.header.config.model)
      return
    }
    if (event.type !== 'assistant/message' || event.data.usage === undefined) return

    const usage: TokenUsage = event.data.usage
    const cwd = session.header.cwd
    const model = this.lastModel.get(session)
    const row: UsageRow = {
      v: USAGE_ROW_VERSION,
      time: event.time,
      sessionId: String(session.id),
      ...(cwd === undefined ? {} : { cwd }),
      ...(model === undefined || model.length === 0 ? {} : { model }),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    }
    void this.writer.write(serializeRow(row)).catch((error: unknown) => {
      this.ctx.logger.warn(`usage telemetry: write failed: ${String(error)}`)
    })
  }

  /** cordis emit is stop-on-throw: nothing here may escape into the event path. */
  private contain(step: () => void): void {
    try {
      step()
    } catch (error) {
      this.ctx.logger.warn(`usage telemetry: capture step failed: ${String(error)}`)
    }
  }
}

export default UsageTelemetry
