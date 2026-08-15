/** HTTP sender for one ingestion endpoint, with outcome classification. */

import type { UsageRow } from '@deepseek-ai/dsh-usage-telemetry/src/schema.ts'

export type SendOutcome =
  | { kind: 'accepted'; accepted: number }
  | { kind: 'duplicate'; duplicates: number }
  | { kind: 'permanent'; status: number; message: string }
  | { kind: 'retryable'; status?: number; message: string }

export class BatchSender {
  constructor(private readonly options: {
    endpoint: string
    token: string
    sourceId: string
    rootId: string
    requestTimeoutMs: number
  }) {
    const url = new URL(options.endpoint)
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new Error('usage-exporter: endpoint must use https, or http on loopback')
    }
  }

  async send(rows: UsageRow[], batchId: string): Promise<SendOutcome> {
    return this.post({ sourceId: this.options.sourceId, rootId: this.options.rootId, batchId, sentAt: Date.now(), rows })
  }

  async sendHeartbeat(): Promise<SendOutcome> {
    return this.post({ sourceId: this.options.sourceId, rootId: this.options.rootId, heartbeat: true, sentAt: Date.now() })
  }

  private async post(envelope: Record<string, unknown>): Promise<SendOutcome> {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.options.requestTimeoutMs)
    try {
      const response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.token.length > 0 ? { authorization: `Bearer ${this.options.token}` } : {}),
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      })
      const message = await response.text().catch(() => '')
      if (response.status >= 200 && response.status < 300) {
        const body = safeJson(message)
        if (body?.ok === true && typeof body.duplicates === 'number' && body.duplicates > 0) {
          return { kind: 'duplicate', duplicates: body.duplicates }
        }
        if (body?.ok === true && typeof body.accepted === 'number') return { kind: 'accepted', accepted: body.accepted }
        if (body?.ok === true && body.heartbeat === true) return { kind: 'accepted', accepted: 0 }
        return { kind: 'permanent', status: response.status, message: message.slice(0, 500) || 'malformed success body' }
      }
      if (response.status === 400 || response.status === 401 || response.status === 413) {
        return { kind: 'permanent', status: response.status, message: message.slice(0, 500) }
      }
      return { kind: 'retryable', status: response.status, message: message.slice(0, 500) }
    } catch (error) {
      return { kind: 'retryable', message: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  }
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}
