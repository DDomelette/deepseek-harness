/**
 * Session-reference plugin, browser half: the '@' `session` source over the
 * warm session list. Candidates are same-cwd ordinary conversations; picking
 * one inserts a structured ReferenceInsert chip whose codec serializes the
 * canonical `@[label](dsh-session:<id>)` mention.
 */

import type {
  ClientContext, SessionId, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ClientSessionContext, InputTriggerCandidate, InputTriggerServiceContract,
  InputTriggerSource, ReferenceCodec,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { formatSessionReferenceMention } from './uri.ts'

export const inject = ['inputTriggers', 'sessions']

const MAX_CANDIDATES = 50

/** Human-facing error when a picked session left the ready list before submit. */
const SOURCE_GONE_MESSAGE = '会话引用已失效：所选会话不在当前工作区'

/** Return same-cwd ordinary sessions for one query, in host list order. */
function matchingSessions(sessions: ClientContext['sessions'], session: ClientSessionContext, query: string): SessionSummary[] {
  const snapshot = sessions.list.getSnapshot()
  const current = snapshot.byId[session.sessionId]
  if (current?.cwd === undefined) return []
  const needle = query.toLocaleLowerCase()
  const out: SessionSummary[] = []
  for (const id of snapshot.ids) {
    const row = snapshot.byId[id]
    if (row === undefined || id === session.sessionId) continue
    if (row.cwd !== current.cwd || row.blank || row.origin === 'subagent') continue
    if (needle !== ''
      && !row.displayTitle.toLocaleLowerCase().includes(needle)
      && !id.toLocaleLowerCase().includes(needle)) continue
    out.push(row)
    if (out.length === MAX_CANDIDATES) break
  }
  return out
}

/** Browser plugin body. */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions
  const candidateSessions = new WeakMap<InputTriggerCandidate, SessionSummary>()
  const labels = new Map<SessionId, string>()

  const labelFor = (id: SessionId): string => {
    const live = sessions.list.getSnapshot().byId[id]
    return live?.displayTitle ?? labels.get(id) ?? id
  }

  const codec: ReferenceCodec = {
    clipboardText(ref) {
      const id = ref as SessionId
      return formatSessionReferenceMention(id, labelFor(id))
    },
    serialize(ref) {
      const id = ref as SessionId
      const snapshot = sessions.list.getSnapshot()
      if (snapshot.phase === 'ready' && snapshot.byId[id] === undefined) {
        return Promise.reject(new Error(SOURCE_GONE_MESSAGE))
      }
      return Promise.resolve(formatSessionReferenceMention(id, labelFor(id)))
    },
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'session',
    order: -1,
    candidates(session, { query, signal }) {
      if (signal.aborted) return Promise.resolve([])
      const rows = matchingSessions(sessions, session, query)
      const counts = new Map<string, number>()
      for (const row of rows) counts.set(row.displayTitle, (counts.get(row.displayTitle) ?? 0) + 1)
      return Promise.resolve(rows.map((row) => {
        const candidate: InputTriggerCandidate = {
          name: row.displayTitle,
          ...(counts.get(row.displayTitle) ?? 0) > 1 ? { description: row.id } : {},
        }
        candidateSessions.set(candidate, row)
        labels.set(row.id, row.displayTitle)
        return candidate
      }))
    },
    onPick({ candidate }) {
      const row = candidateSessions.get(candidate)
      if (row === undefined) return undefined
      return {
        insert: {
          source: 'session',
          ref: row.id,
          label: row.displayTitle,
          clipboardText: formatSessionReferenceMention(row.id, row.displayTitle),
        },
      }
    },
    codec,
  }

  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-session-reference: @ source')
}
