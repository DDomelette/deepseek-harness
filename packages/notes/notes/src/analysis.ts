/**
 * Analysis orchestration: turning a stored material into one model request.
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
import { actionFor, composeBody } from './compose.ts'
import { projectThread } from './thread.ts'
import type { ThreadRow } from './thread.ts'
import type { NoteSessions } from './note-sessions.ts'
import type { NotesSettings } from './settings.ts'
import type { Materials } from './materials.ts'
import type {
  MaterialId, NoteSessionId, NotesAnalyzeFailure, NotesAskFailure, NotesSessionNotFound,
  NotesSessionNotLive,
} from './types.ts'

/** One conversation's live Agent, or the failure that keeps it from receiving a message. */
type AgentTarget =
  | { readonly live: true; readonly agent: Agent }
  | { readonly live: false; readonly failure: NotesSessionNotFound | NotesSessionNotLive }

/** One material's thread, or the failure that stopped the read. */
export type ThreadRead =
  | { readonly ok: true; readonly rows: readonly ThreadRow[] }
  | { readonly ok: false; readonly failure: NotesAskFailure }

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
    await this.submit(id, target.agent, composeBody(current, action), true)
    return null
  }

  /**
   * Ask a follow-up inside one material's thread. Every call submits its own
   * message; a question is not idempotent the way the first analysis is.
   * @param id - material id.
   * @param question - the user's question.
   * @returns the failure that stopped the question, or null when it was
   *   submitted or there was no thread to ask in.
   */
  async ask(id: MaterialId, question: string): Promise<NotesAskFailure | null> {
    const current = this.ctx.notesMaterials.get(id)
    if (current === undefined) return { code: 'material-not-found', id }
    if (current.messageIds.length === 0) return null
    const target = this.targetFor(current.noteId)
    if (!target.live) return target.failure
    await this.submit(id, target.agent, question, false)
    return null
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
   * @param text - the body to submit.
   * @param claim - whether this call may only send if it is the first to record
   *   an id, which makes the first analysis idempotent under concurrency.
   * @throws the send failure, after the material is marked `failed`.
   */
  private async submit(id: MaterialId, agent: Agent, text: string, claim: boolean): Promise<void> {
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'notes' },
    })
    if (claim) {
      // The domain's write chain is the claim. Two concurrent analyses both
      // pass `analyse`'s synchronous check, so the loser must observe the
      // winner's id inside the same atomic read-modify-write and submit
      // nothing.
      const next = await this.materials.update(id, record => record.messageIds.length > 0
        ? record
        : {
          ...record,
          status: 'analyzing',
          messageIds: [...record.messageIds, message.id],
          error: null,
        })
      if (!next.messageIds.includes(message.id)) return
    } else {
      await this.materials.update(id, record => ({
        ...record,
        status: 'analyzing',
        messageIds: [...record.messageIds, message.id],
        error: null,
      }))
    }
    try {
      agent.followup(message)
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      await this.materials.update(id, record => ({
        ...record,
        status: 'failed',
        messageIds: record.messageIds.filter(candidate => candidate !== message.id),
        error: reason,
      }))
      throw error
    }
  }
}

export default Analysis
