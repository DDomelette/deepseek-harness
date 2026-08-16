/**
 * Durable deletion-plan domain declaration for recursive session deletion.
 * @module @deepseek-ai/dsh-session-deletion/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const sessionIdSchema = z.string().transform(value => value as SessionId)

/** Durable per-member progress; ordering is defined by the member array. */
export const deletionMember = z.object({
  sessionId: sessionIdSchema,
  persistence: z.enum(['pending', 'done', 'missing']),
  workspace: z.enum(['pending', 'done', 'skipped']),
})

/** One recursive deletion transaction, persisted before the first destructive write. */
export const deletionPlanRecord = z.object({
  rootSessionId: sessionIdSchema,
  recursive: z.boolean(),
  members: z.array(deletionMember),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Inferred durable deletion-plan record. */
export type DeletionPlanRecord = z.infer<typeof deletionPlanRecord>

/**
 * The deletion domain: one `plans` table keyed by the root session id. A plan
 * is the retry authority after a crash — the service never re-derives cleanup
 * from the remaining logs.
 */
export const deletionDomainSpec = defineDomain({
  name: 'session_deletion',
  version: 1,
  tables: {
    plans: domainTable<SessionId, DeletionPlanRecord>(deletionPlanRecord),
  },
})
