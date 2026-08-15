import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'

const sessionIds = z.array(z.string().transform(SessionId))

const sessionPinsDomainState = z.object({
  pinnedSessionIds: sessionIds.default([]),
  groupOrder: z.record(z.string(), sessionIds).default({}),
  flatOrder: sessionIds.default([]),
})

export type SessionPinsDomainState = z.infer<typeof sessionPinsDomainState>

export const sessionPinsDomainSpec = defineDomain({
  name: 'session_pins',
  version: 1,
  global: {
    schema: sessionPinsDomainState,
    initial: { pinnedSessionIds: [], groupOrder: {}, flatOrder: [] },
  },
  tables: {},
})
