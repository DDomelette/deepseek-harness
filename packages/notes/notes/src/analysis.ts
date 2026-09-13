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
 * @module @deepseek-ai/dsh-notes/analysis
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { composeBody } from './compose.ts'
import type { NoteSessions } from './note-sessions.ts'
import type { NotesSettings } from './settings.ts'
import type { Materials } from './materials.ts'
import type { MaterialId, NoteSessionId } from './types.ts'

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
   * conversation is left alone, so a repeated call cannot double-send.
   * @param id - material id.
   * @throws {Error} when the material's conversation is unrecorded or not live.
   */
  async analyse(id: MaterialId): Promise<void> {
    const current = this.ctx.notesMaterials.get(id)
    if (current === undefined) return
    if (current.messageIds.length > 0) return
    const agent = this.agentFor(current.noteId)
    await this.submit(id, agent, composeBody(current, this.settings.actions()))
  }

  /**
   * Ask a follow-up inside one material's thread.
   * @param id - material id.
   * @param question - the user's question.
   * @throws {Error} when the material's conversation is unrecorded or not live.
   */
  async ask(id: MaterialId, question: string): Promise<void> {
    const current = this.ctx.notesMaterials.get(id)
    if (current === undefined || current.messageIds.length === 0) return
    await this.submit(id, this.agentFor(current.noteId), question)
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
   * @returns the live agent.
   * @throws {Error} when the record is missing or its Session is not live —
   *   a persisted conversation whose process restarted has to be reopened
   *   before it can receive another message.
   */
  private agentFor(noteId: NoteSessionId): Agent {
    const note = this.sessions.get(noteId)
    if (note === undefined) throw new Error(`notes: conversation '${noteId}' is not recorded`)
    const agent = this.ctx.agents.get(note.sessionId)
    if (agent === undefined) throw new Error(`notes: conversation '${noteId}' has no live session`)
    return agent
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
   * @throws the send failure, after the material is marked `failed`.
   */
  private async submit(id: MaterialId, agent: Agent, text: string): Promise<void> {
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'notes' },
    })
    await this.materials.update(id, record => ({
      ...record,
      status: 'analyzing',
      messageIds: [...record.messageIds, message.id],
      error: null,
    }))
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
