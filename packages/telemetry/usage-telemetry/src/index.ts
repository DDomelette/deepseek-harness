/**
 * Usage telemetry service: appends one JSONL row for each session-attributed
 * live `llm/stream` invocation that yields provider usage to
 * $DSH_HOME/telemetry/usage-YYYY-MM-DD.jsonl.
 * This standalone Cordis service is not a SessionTelemetryBackend; the shipped
 * OTel backend owns that singleton slot. The shipped Web composition enables
 * local capture, and the optional settings service may override the composition
 * value through the `usage-telemetry` namespace.
 *
 * @module @deepseek-ai/dsh-usage-telemetry
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
// Merges the optional live session store onto the Cordis Context interface.
import type {} from '@deepseek-ai/dsh-session'
// Merges `settings` onto the cordis Context interface and brands the namespace id.
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { createUsageWriter, type UsageWriter } from './writer.ts'
import { serializeRow, USAGE_ROW_VERSION, type UsageRow } from './schema.ts'

/** Configuration for local usage telemetry capture. */
export interface Config {
  /** Whether live LLM usage is appended to local telemetry files. */
  enabled: boolean
}

/** Validated usage telemetry configuration. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().required(),
})

/** User-settings namespace controlling local usage telemetry. */
export const USAGE_TELEMETRY_SETTINGS_NAMESPACE = settingsNamespace('usage-telemetry')

/** Captures provider usage from session-attributed streaming model calls. */
export class UsageTelemetry extends Service {
  static Config = Config

  private enabled: boolean
  private configSource!: () => Config
  private readonly writer: UsageWriter
  private readonly writes = new Set<Promise<void>>()
  private disposeSubscription: (() => boolean) | null = null
  private stopping = false

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'usageTelemetry')
    this.enabled = config.enabled
    this.writer = createUsageWriter({ root: join(resolveDshHome(), 'telemetry') })
  }

  protected *[Service.init](): Generator<() => Promise<void>, void, void> {
    yield async () => {
      this.stopping = true
      this.disposeSubscription?.()
      this.disposeSubscription = null
      await Promise.allSettled([...this.writes])
    }
    this.syncSubscription()
    installSettingsSection(
      this.ctx,
      USAGE_TELEMETRY_SETTINGS_NAMESPACE,
      Config,
      { enabled: this.config.enabled },
      {
        setSource: (source) => { this.configSource = source },
        onChange: () => {
          this.enabled = this.configSource().enabled
          this.syncSubscription()
        },
      },
    )
  }

  /** Keep the waterfall subscription active only while capture is enabled. */
  private syncSubscription(): void {
    if (this.enabled && this.disposeSubscription === null) {
      this.disposeSubscription = this.ctx.on('llm/stream', this.onStream)
    } else if (!this.enabled && this.disposeSubscription !== null) {
      this.disposeSubscription()
      this.disposeSubscription = null
    }
  }

  private readonly onStream = (
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> => this.observeStream(options, next)

  private async *observeStream(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    let observed: { usage: TokenUsage; time: number } | undefined
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') observed = { usage: chunk.usage, time: Date.now() }
        yield chunk
      }
    } finally {
      if (observed !== undefined && options.sessionId !== undefined) this.record(options, options.sessionId, observed)
    }
  }

  private record(
    options: GenerateOptions,
    sessionId: NonNullable<GenerateOptions['sessionId']>,
    observed: { usage: TokenUsage; time: number },
  ): void {
    if (this.stopping) return
    try {
      const cwd = this.ctx.get('sessions')?.get(sessionId)?.header.cwd
      const row: UsageRow = {
        v: USAGE_ROW_VERSION,
        time: observed.time,
        sessionId: String(sessionId),
        ...(cwd === undefined ? {} : { cwd }),
        model: options.model,
        inputTokens: observed.usage.inputTokens,
        outputTokens: observed.usage.outputTokens,
        cacheReadTokens: observed.usage.cacheReadTokens ?? 0,
        cacheWriteTokens: observed.usage.cacheWriteTokens ?? 0,
      }
      const write = this.writer.write(serializeRow(row))
      this.writes.add(write)
      void write
        .catch((error: unknown) => {
          this.ctx.logger.warn(`usage telemetry: write failed: ${String(error)}`)
        })
        .finally(() => { this.writes.delete(write) })
    } catch (error) {
      this.ctx.logger.warn(`usage telemetry: capture step failed: ${String(error)}`)
    }
  }
}

export default UsageTelemetry
