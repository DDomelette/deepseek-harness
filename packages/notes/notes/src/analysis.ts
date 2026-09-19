/**
 * Analysis orchestration: turning a stored material into one model request, and
 * settling the material when the turn that carried it ends.
 *
 * Every path is `followup()`, never `inject()`. `inject` parks content in the
 * inbox until the next message merges it into the SAME request, which would
 * collapse several materials into one answer and break the panel's
 * one-row-one-answer rule. The two strategies differ only in when the
 * follow-up happens, not in how.
 *
 * Both entry points resolve the live Agent from the material's own
 * conversation record, so the follow-up always lands in the notes
 * conversation — never in the session the material was collected from.
 *
 * Each entry point reports why it did not submit instead of throwing: the
 * conditions below are what the panel has to explain per row, and they are
 * named here so that enforcement and reporting read the same rules.
 * @module @deepseek-ai/dsh-notes/analysis
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { actionFor, composeContent } from './compose.ts'
import { projectThread } from './thread.ts'
import type { ThreadRow } from './thread.ts'
import { turnMessages, turnOutcome } from './turns.ts'
import type { NoteSessions } from './note-sessions.ts'
import type { NotesSettings } from './settings.ts'
import type { Materials } from './materials.ts'
import type { MaterialRecord } from './domain.ts'
import type {
  MaterialId, NoteSessionId, NotesAnalyzeFailure, NotesAskFailure, NotesSessionNotFound,
  NotesSubmitRefused,
  NotesSessionNotLive, NotesThreadFailure,
} from './types.ts'

/** One conversation's live Agent, or the failure that keeps it from receiving a message. */
type AgentTarget =
  | { readonly live: true; readonly agent: Agent }
  | { readonly live: false; readonly failure: NotesSessionNotFound | NotesSessionNotLive }

/** One material's thread, or the failure that stopped the read. */
export type ThreadRead =
  | { readonly ok: true; readonly rows: readonly ThreadRow[] }
  | { readonly ok: false; readonly failure: NotesThreadFailure }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Submits materials into their notes conversation. */
    notesAnalysis: Analysis
  }
}

/** Drives materials into their notes conversation. */
export class Analysis extends Service {
  static inject = ['agents', 'notesMaterials', 'notesSessions', 'notesSettings']

  /**
   * @param ctx - host context carrying the agent registry, the material store,
   *   the conversation records, and the live notes settings.
   */
  constructor(ctx: Context) {
    super(ctx, 'notesAnalysis')
    // A submission's outcome arrives with the turn that carried it, never at the
    // call site, so the service settles its materials from the closing event.
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return
      void this.settleTurn(session, event).catch(() => {
        // A settle that cannot write leaves the material `analyzing`; the next
        // turn of that conversation settles it, and every read of the store
        // surfaces the same medium failure again. One event observer must not
        // reject into the session's own publication.
      })
    })
  }

  /**
   * Settle the materials one conversation's closed turn carried.
   *
   * The turn's own messages come from the log rather than from memory, so a
   * conversation that was restored still settles the material it carried. Only
   * a material still `analyzing` changes: a draft was never submitted, and one
   * a later turn already settled keeps the first answer's outcome.
   * @param session - the session whose turn closed.
   * @param event - the closing `turn/end` event.
   */
  private async settleTurn(
    session: Session,
    event: Extract<SessionEvent, { type: 'turn/end' }>,
  ): Promise<void> {
    const noteIds = this.noteIdsFor(session.id)
    if (noteIds.length === 0) return
    const ids = turnMessages(session.snapshotEvents(), event.data.turn)
    if (ids.length === 0) return
    const outcome = turnOutcome(event.data)
    for (const noteId of noteIds) {
      const settled: MaterialId[] = []
      for (const stored of [...this.materials.list(noteId), ...this.materials.archived(noteId)]) {
        if (stored.status !== 'analyzing') continue
        // Only the turn that carried the material's newest message settles it:
        // a question submitted while the first turn was open would otherwise be
        // settled by that earlier turn, and its own turn skipped.
        const newest = stored.messageIds.at(-1)
        if (newest === undefined || !ids.includes(newest)) continue
        // The transform re-checks the status, so a settle that lost a race
        // leaves the winner's outcome in place; either way the material is
        // settled now, and the answer it may be showing has been replaced.
        await this.materials.update(stored.id, record => record.status === 'analyzing'
          ? { ...record, status: outcome.answered ? 'analyzed' : 'failed', error: outcome.reason }
          : record)
        settled.push(stored.id)
      }
      // A settlement happens on the Host's own clock: no browser call is
      // waiting for it, so this is the only moment a panel still showing the
      // material can learn that its answer arrived.
      if (settled.length > 0) this.ctx.emit('notes/material-settled', noteId, settled)
    }
  }

  /**
   * The notes conversations driven by one session.
   * @param sessionId - the session whose notes records to find.
   * @returns the recorded conversation ids, listed ones first.
   */
  private noteIdsFor(sessionId: SessionId): NoteSessionId[] {
    return [...this.sessions.list(), ...this.sessions.archived()]
      .filter(record => record.sessionId === sessionId)
      .map(record => record.id)
  }

  /**
   * Submit one material for analysis. A material that already entered its
   * conversation is left alone, including one a concurrent call claimed first.
   * @param id - material id.
   * @returns the failure that stopped the submission, or null when the
   *   material entered its conversation or had already entered it.
   */
  async analyse(id: MaterialId): Promise<NotesAnalyzeFailure | null> {
    const current = this.ctx.notesMaterials.get(id)
    if (current === undefined) return { code: 'material-not-found', id }
    if (current.messageIds.length > 0) return null
    const action = actionFor(current.action, this.settings.actions())
    if (current.action !== null && action === undefined) {
      return { code: 'unknown-action', action: current.action }
    }
    const target = this.targetFor(current.noteId)
    if (!target.live) return target.failure
    const content = composeContent(current, action)
    if (content.some(block => block.type === 'image') && await this.imagesUnsupported(target.agent)) {
      return { code: 'image-unsupported', id }
    }
    return await this.submit(id, target.agent, content, record => composeContent(record, action))
  }

  /**
   * Ask a follow-up inside one material's thread. Every call submits its own
   * message; a question is not idempotent the way the first analysis is.
   * @param id - material id.
   * @param question - the user's question.
   * @returns the failure that stopped the question, or null when it was
   *   submitted.
   */
  async ask(id: MaterialId, question: string): Promise<NotesAskFailure | null> {
    const current = this.ctx.notesMaterials.get(id)
    if (current === undefined) return { code: 'material-not-found', id }
    if (current.messageIds.length === 0) return { code: 'material-not-submitted', id }
    const target = this.targetFor(current.noteId)
    if (!target.live) return target.failure
    return await this.submit(id, target.agent, [{ type: 'text', text: question }])
  }

  /**
   * Whether one collected material is submitted as soon as it is stored: the
   * deployment strategy submits every collection, and a collection action may
   * ask for it regardless of the strategy.
   * @param action - the action id stored on the new material, or null for none.
   * @returns true when the material must be submitted now.
   */
  submitsOnCollection(action: string | null): boolean {
    if (this.settings.strategy() === 'auto') return true
    return actionFor(action, this.settings.actions())?.autoSend === true
  }

  /**
   * Read one material's own thread out of its conversation's log.
   *
   * The log is the content truth, so this projects the conversation's live
   * events rather than any copy the notes domain keeps: what the panel shows is
   * what the model saw.
   * @param id - material id.
   * @returns the thread's rows, or the failure that stopped the read.
   */
  thread(id: MaterialId): ThreadRead {
    const current = this.ctx.notesMaterials.get(id)
    if (current === undefined) return { ok: false, failure: { code: 'material-not-found', id } }
    const target = this.targetFor(current.noteId)
    if (!target.live) return { ok: false, failure: target.failure }
    return { ok: true, rows: projectThread(target.agent.session.snapshotEvents(), current.messageIds) }
  }

  private get materials(): Materials {
    return this.ctx.notesMaterials
  }

  private get sessions(): NoteSessions {
    return this.ctx.notesSessions
  }

  private get settings(): NotesSettings {
    return this.ctx.notesSettings
  }

  /**
   * Whether one conversation's route declares that it takes no image input.
   *
   * A route that declares text-only input would receive the request assembly's
   * placeholder instead of the screenshot, which is the silent drop the panel
   * has to explain instead. Only a resolved route is judged: an agent whose
   * options name no route, a deployment that mounts no LLM service, and a route
   * whose model metadata cannot be read are all unknown rather than negative,
   * and the submission proceeds — the request itself reports what it could not
   * resolve, and a refusal here would blame the model for a missing answer.
   * @param agent - the live notes agent whose route would carry the message.
   * @returns true when that route declares text-only input.
   */
  private async imagesUnsupported(agent: Agent): Promise<boolean> {
    const llm = this.ctx.get('llm')
    const { provider, model } = agent.options
    if (llm === undefined || provider === undefined || model === undefined) return false
    try {
      const info = await llm.resolveModelInfo(provider, model)
      return info.inputModalities !== undefined && !info.inputModalities.includes('image')
    } catch {
      // Unknown route or unreachable provider metadata: the request path owns
      // that failure, and this check owns only a declared negative capability.
      return false
    }
  }

  /**
   * The live Agent of one notes conversation.
   * @param noteId - notes conversation id.
   * @returns the agent, or the failure that stops this conversation — a
   *   persisted conversation whose process restarted has to be reopened before
   *   it can receive another message.
   */
  private targetFor(noteId: NoteSessionId): AgentTarget {
    const note = this.sessions.get(noteId)
    if (note === undefined) return { live: false, failure: { code: 'session-not-found', id: noteId } }
    const agent = this.ctx.agents.get(note.sessionId)
    if (agent === undefined) return { live: false, failure: { code: 'session-not-live', id: noteId } }
    return { live: true, agent }
  }

  /**
   * Record the message identity, send it, and roll the identity back when the
   * send is refused.
   *
   * The order is deliberate. `Agent.followup()` returns void, so the sequence a
   * message lands on is never knowable at the call site; its id is knowable
   * before the send because `createUserMessage` mints it. Recording first means
   * no committed message can exist without its id already stored. The rollback
   * keeps a refused send from parking the material in `analyzing` forever, since
   * `analyse` reads a non-empty `messageIds` as "already sent".
   * @param id - material id.
   * @param agent - the live notes agent.
   * @param content - the blocks to submit.
   * @param claim - compose the first analysis from the record that atomically
   *   accepted its message id; absent for a follow-up question.
   * @returns the refusal, after the material is marked `failed` and the id is
   *   rolled back, or null when the send was taken.
   */
  private async submit(
    id: MaterialId,
    agent: Agent,
    content: ContentBlock[],
    claim?: (record: MaterialRecord) => ContentBlock[],
  ): Promise<NotesSubmitRefused | null> {
    let message: UserMessage | undefined
    await this.materials.update(id, (record) => {
      if (claim !== undefined && record.messageIds.length > 0) return record
      message = createUserMessage({
        content: claim === undefined ? content : claim(record),
        source: { kind: 'plugin', plugin: 'notes' },
      })
      return {
        ...record,
        status: 'analyzing',
        messageIds: [...record.messageIds, message.id],
        error: null,
      }
    })
    if (message === undefined) return null
    const submittedId = message.id
    try {
      agent.followup(message)
      return null
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      await this.materials.update(id, record => ({
        ...record,
        status: 'failed',
        messageIds: record.messageIds.filter(candidate => candidate !== submittedId),
        error: reason,
      }))
      // The refusal is a value: a throw here would leave the wire vocabulary and
      // reach the panel as an unreachable Host rather than a refused send.
      return { code: 'submit-refused', id, message: reason }
    }
  }
}

export default Analysis
