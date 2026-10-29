/**
 * Retention bookkeeping for the client sessions service. The test double in
 * `test-support/client-runtime` mirrors this service, so the record, the zero
 * snapshot, and the publication rule live here once instead of in both.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRetainInfo } from '../contract/sessions.ts'
import type { SessionReferenceSource } from '../index.ts'

/** The zero reference counts every session without references reports, shared by identity. */
export const EMPTY_RETAIN_INFO: SessionRetainInfo = Object.freeze({
  referenceCount: 0,
  retainedBy: Object.freeze({}),
})

/** Local reference counts for one session, plus the observers reading them. */
export interface RetentionRecord {
  count: number
  bySource: Partial<Record<SessionReferenceSource, number>>
  readonly listeners: Set<() => void>
  published: SessionRetainInfo
}

/**
 * Read one session's record, creating the zero record on first use.
 * @param retention - the service's per-session record map.
 * @param id - session the record belongs to.
 * @returns the existing or newly created record.
 */
export function retentionRecordOf(
  retention: Map<SessionId, RetentionRecord>,
  id: SessionId,
): RetentionRecord {
  let record = retention.get(id)
  if (record === undefined) {
    record = { count: 0, bySource: {}, listeners: new Set(), published: EMPTY_RETAIN_INFO }
    retention.set(id, record)
  }
  return record
}

/**
 * Replace the published snapshot, then notify: subscribers always read the
 * counts they were told about.
 * @param record - the record whose counts and observers move.
 */
export function publishRetention(record: RetentionRecord): void {
  record.published = record.count === 0 && Object.keys(record.bySource).length === 0
    ? EMPTY_RETAIN_INFO
    : Object.freeze({
      referenceCount: record.count,
      retainedBy: Object.freeze({ ...record.bySource }),
    })
  for (const listener of [...record.listeners]) listener()
}
