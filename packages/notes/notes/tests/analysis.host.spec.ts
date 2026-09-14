/**
 * Analysis orchestration: one material becomes one user message on its notes
 * conversation, the submitted message id is recorded, and the status walks
 * draft -> analyzing (or -> failed when the send is refused).
 *
 * Both entry points resolve the conversation's own Session, so a follow-up
 * never lands in the session the material was collected from, and both report
 * why they did not submit instead of throwing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Analysis } from '../src/analysis.ts'
import { Materials } from '../src/materials.ts'
import { NoteSessions } from '../src/note-sessions.ts'
import type { ActionDef, Config, NotesStrategy } from '../src/settings.ts'
import { bench } from './bench.ts'
import type { Bench, FakeAgents } from './bench.ts'
import { FakeLlm, imageRef, material, messageId, noteId, noteSession, sessionId, source } from './bench.ts'
import type { MaterialId } from '../src/types.ts'

/** The mounted analysis bench. */
interface AnalysisBench {
  readonly ctx: Bench['ctx']
  readonly agents: FakeAgents
  readonly llm: FakeLlm
  readonly analysis: Analysis
  readonly materials: Materials
  readonly sessions: NoteSessions
  dispose(): Promise<void>
}

let mounted: AnalysisBench | undefined

afterEach(async () => {
  if (mounted !== undefined) await mounted.dispose()
  mounted = undefined
})

/** The one collection action the benches below configure. */
const translate: ActionDef = {
  id: 'translate',
  label: '翻译',
  prompt: '不改变语句结构，翻译下列内容：',
  autoSend: true,
}

const config = (actions: ActionDef[], strategy: NotesStrategy = 'manual'): Config =>
  ({ strategy, actions })

/** Mount the notes services and Analysis over the given settings entry. */
async function mount(
  actions: ActionDef[] = [],
  strategy: NotesStrategy = 'manual',
): Promise<AnalysisBench> {
  const base = await bench(config(actions, strategy))
  const llm = new FakeLlm()
  base.ctx.provide('llm', llm as never)
  await base.ctx.plugin(Analysis).await()
  mounted = {
    ctx: base.ctx,
    agents: base.agents,
    llm,
    analysis: base.ctx.notesAnalysis,
    materials: base.materials,
    sessions: base.sessions,
    dispose: async () => { await base.dispose() },
  }
  return mounted
}

/** Record one conversation whose Session this process holds live. */
async function liveConversation(bench: AnalysisBench, session = 'dsh-notes-1'): Promise<ReturnType<typeof noteId>> {
  bench.agents.open(session)
  return await bench.sessions.record(noteSession({ sessionId: sessionId(session), title: 'Notes · probe' }))
}

/**
 * One message handed to the live agent.
 * @param bench - the mounted bench.
 * @param index - zero-based position in the recorded call list.
 * @returns the recorded message.
 */
function sentMessage(bench: AnalysisBench, index = 0): { id: string; content: unknown } {
  return bench.agents.followup.mock.calls[index]?.[0] as { id: string; content: unknown }
}

describe('notes analysis', () => {
  it('submits once, records the submitted message id, and marks the material analyzing', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))

    await expect(bench.analysis.analyse(id)).resolves.toBeNull()

    expect(bench.agents.followup).toHaveBeenCalledTimes(1)
    const sent = sentMessage(bench)
    expect(sent.content).toEqual([{ type: 'text', text: 'body' }])
    const stored = bench.materials.get(id)
    expect(stored?.messageIds).toEqual([sent.id])
    expect(stored?.status).toBe('analyzing')
    expect(stored?.error).toBeNull()
  })

  it('submits once when two analyses race on the same material', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))

    await Promise.all([bench.analysis.analyse(id), bench.analysis.analyse(id)])

    expect(bench.agents.followup).toHaveBeenCalledTimes(1)
    expect(bench.materials.get(id)?.messageIds).toHaveLength(1)
  })

  it('leaves a material that already entered the conversation alone', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))

    await bench.analysis.analyse(id)
    await bench.analysis.analyse(id)

    expect(bench.agents.followup).toHaveBeenCalledTimes(1)
  })

  it('reports an unknown material id', async () => {
    const bench = await mount()
    await expect(bench.analysis.analyse('absent' as MaterialId))
      .resolves.toEqual({ code: 'material-not-found', id: 'absent' })
    expect(bench.agents.followup).not.toHaveBeenCalled()
  })

  it('prepends the action prompt template the material names', async () => {
    const bench = await mount([translate])
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body', action: 'translate' }))

    await bench.analysis.analyse(id)

    expect(sentMessage(bench).content)
      .toEqual([{ type: 'text', text: '不改变语句结构，翻译下列内容：\nbody' }])
  })

  it('rolls the id back and marks the material failed when the send throws', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    bench.agents.followup.mockImplementationOnce(() => { throw new Error('inbox rejected') })

    await expect(bench.analysis.analyse(id)).rejects.toThrow('inbox rejected')

    const stored = bench.materials.get(id)
    expect(stored?.messageIds).toEqual([])
    expect(stored?.status).toBe('failed')
    expect(stored?.error).toBe('inbox rejected')
  })

  it('carries a non-Error refusal into the stored reason', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    // A refusal need not be an Error; the stored reason is still readable text.
    bench.agents.followup.mockImplementationOnce(() => { throw 'refused' })

    await expect(bench.analysis.analyse(id)).rejects.toBe('refused')

    expect(bench.materials.get(id)?.error).toBe('refused')
  })

  it('reports an action the configuration no longer offers', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body', action: 'gone' }))

    await expect(bench.analysis.analyse(id))
      .resolves.toEqual({ code: 'unknown-action', action: 'gone' })

    expect(bench.agents.followup).not.toHaveBeenCalled()
  })

  it('submits a screenshot as the image block naming its stored reference', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({
      noteId: note,
      kind: 'image',
      text: null,
      image: imageRef(),
    }))

    await expect(bench.analysis.analyse(id)).resolves.toBeNull()

    expect(sentMessage(bench).content).toEqual([{ type: 'image', attachment: imageRef() }])
    expect(bench.materials.get(id)?.status).toBe('analyzing')
  })

  it('submits the action template in front of the screenshot it collected', async () => {
    const bench = await mount([translate])
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({
      noteId: note,
      kind: 'image',
      text: null,
      image: imageRef(),
      action: 'translate',
    }))

    await bench.analysis.analyse(id)

    expect(sentMessage(bench).content).toEqual([
      { type: 'text', text: '不改变语句结构，翻译下列内容：' },
      { type: 'image', attachment: imageRef() },
    ])
  })

  it('reports a route that declares text-only input, without sending the screenshot', async () => {
    const bench = await mount()
    bench.llm.modalities = ['text']
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({
      noteId: note,
      kind: 'image',
      text: null,
      image: imageRef(),
    }))

    await expect(bench.analysis.analyse(id)).resolves.toEqual({ code: 'image-unsupported', id })

    expect(bench.llm.asked).toEqual([{ provider: 'notes-provider', model: 'notes-model' }])
    expect(bench.agents.followup).not.toHaveBeenCalled()
    expect(bench.materials.get(id)?.status).toBe('draft')
  })

  it('reads an unknown or unreadable route as capable rather than as a refusal', async () => {
    const unknown = await mount()
    unknown.llm.modalities = undefined
    const note = await liveConversation(unknown)
    const id = await unknown.materials.create(material({
      noteId: note,
      kind: 'image',
      text: null,
      image: imageRef(),
    }))

    await expect(unknown.analysis.analyse(id)).resolves.toBeNull()
    expect(unknown.agents.followup).toHaveBeenCalledTimes(1)

    const unreadable = await mount()
    unreadable.llm.failure = new Error('no adapter serves this provider')
    const second = await liveConversation(unreadable)
    const other = await unreadable.materials.create(material({
      noteId: second,
      kind: 'image',
      text: null,
      image: imageRef(),
    }))

    await expect(unreadable.analysis.analyse(other)).resolves.toBeNull()
    expect(unreadable.agents.followup).toHaveBeenCalledTimes(1)
  })

  it('asks no route about a text material', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))

    await bench.analysis.analyse(id)

    expect(bench.llm.asked).toEqual([])
  })

  it('reports a material whose conversation is not recorded', async () => {
    const bench = await mount()
    const id = await bench.materials.create(material({ noteId: noteId('unrecorded'), text: 'body' }))
    await expect(bench.analysis.analyse(id))
      .resolves.toEqual({ code: 'session-not-found', id: 'unrecorded' })
    expect(bench.agents.followup).not.toHaveBeenCalled()
  })

  it('reports a material whose conversation has no live session', async () => {
    const bench = await mount()
    const note = await bench.sessions.record(noteSession({ sessionId: sessionId('dsh-cold'), title: 'Notes · cold' }))
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await expect(bench.analysis.analyse(id)).resolves.toEqual({ code: 'session-not-live', id: note })
    expect(bench.agents.followup).not.toHaveBeenCalled()
  })

  it('asks a follow-up inside the conversation that already answered the material', async () => {
    const bench = await mount()
    const note = await liveConversation(bench, 'dsh-notes-1')
    const id = await bench.materials.create(material({
      noteId: note,
      text: 'body',
      source: source({ sessionId: sessionId('collected-from') }),
    }))

    await bench.analysis.analyse(id)
    const first = sentMessage(bench)
    await expect(bench.analysis.ask(id, 'why?')).resolves.toBeNull()

    expect(bench.agents.followup).toHaveBeenCalledTimes(2)
    const question = sentMessage(bench, 1)
    expect(question.content).toEqual([{ type: 'text', text: 'why?' }])
    // The follow-up joins the material's own thread, not the collecting session.
    expect(bench.materials.get(id)?.messageIds).toEqual([first.id, question.id])
  })

  it('reports a follow-up on a material that never entered the conversation', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))

    await expect(bench.analysis.ask(id, 'why?'))
      .resolves.toEqual({ code: 'material-not-submitted', id })

    expect(bench.agents.followup).not.toHaveBeenCalled()
  })

  it('reports a follow-up on an unknown material', async () => {
    const bench = await mount()
    await expect(bench.analysis.ask('absent' as MaterialId, 'why?'))
      .resolves.toEqual({ code: 'material-not-found', id: 'absent' })
    expect(bench.agents.followup).not.toHaveBeenCalled()
  })

  it('reports a follow-up whose conversation has no live session', async () => {
    const bench = await mount()
    const note = await bench.sessions.record(
      noteSession({ sessionId: sessionId('dsh-cold'), title: 'Notes · cold' }),
    )
    const id = await bench.materials.create(material({
      noteId: note,
      text: 'body',
      status: 'analyzed',
      messageIds: [messageId('submitted')],
    }))

    await expect(bench.analysis.ask(id, 'why?')).resolves.toEqual({ code: 'session-not-live', id: note })

    expect(bench.agents.followup).not.toHaveBeenCalled()
  })

  it('submits a collection on its own when the strategy says so', async () => {
    const translate: ActionDef = {
      id: 'translate',
      label: '翻译',
      prompt: '不改变语句结构，翻译下列内容：',
      autoSend: true,
    }
    const manual = await mount([translate])
    expect(manual.analysis.submitsOnCollection(null)).toBe(false)
    expect(manual.analysis.submitsOnCollection('translate')).toBe(true)
    expect(manual.analysis.submitsOnCollection('gone')).toBe(false)
    await manual.dispose()
    mounted = undefined

    const auto = await mount([], 'auto')
    expect(auto.analysis.submitsOnCollection(null)).toBe(true)
  })
})

describe('notes material thread', () => {
  it('reads the material\'s own rows out of the conversation\'s log', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await bench.analysis.analyse(id)
    const submitted = sentMessage(bench).id
    bench.agents.record([
      { seq: 0, type: 'user/message', data: { id: submitted, role: 'user', content: [{ type: 'text', text: 'body' }] } },
      { seq: 1, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } } },
    ])

    const read = bench.analysis.thread(id)

    expect(read).toEqual({
      ok: true,
      rows: [
        { role: 'user', text: 'body', hasImage: false, seq: 0 },
        { role: 'assistant', text: 'answer', hasImage: false, seq: 1 },
      ],
    })
  })

  it('reports an unknown material', async () => {
    const bench = await mount()

    expect(bench.analysis.thread('absent' as MaterialId))
      .toEqual({ ok: false, failure: { code: 'material-not-found', id: 'absent' } })
  })

  it('reports a conversation that is not recorded', async () => {
    const bench = await mount()
    const id = await bench.materials.create(material({ noteId: noteId('unrecorded'), text: 'body' }))

    expect(bench.analysis.thread(id))
      .toEqual({ ok: false, failure: { code: 'session-not-found', id: 'unrecorded' } })
  })

  it('reports a conversation with no live session', async () => {
    const bench = await mount()
    const note = await bench.sessions.record(noteSession({ sessionId: sessionId('dsh-cold'), title: 'Notes · cold' }))
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))

    expect(bench.analysis.thread(id))
      .toEqual({ ok: false, failure: { code: 'session-not-live', id: note } })
  })
})

describe('turn settlement', () => {
  /**
   * Publish the closing event of a turn.
   * @param bench - the mounted bench.
   * @param session - the dsh session id whose turn closed.
   * @param messageId - the message the turn carried, or null for a turn that
   *   carried none.
   * @param reason - the turn's end reason.
   */
  function closeTurn(
    bench: AnalysisBench,
    session: string,
    messageId: string | null,
    reason: unknown = { kind: 'completed' },
  ): void {
    const events = [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      ...messageId === null
        ? []
        : [{ seq: 1, type: 'user/message', data: { id: messageId, role: 'user', content: [] } }],
      { seq: 2, type: 'turn/end', data: { turn: 1, reason } },
    ]
    const target = { id: sessionId(session), snapshotEvents: () => events } as never
    bench.ctx.emit('session/event', target, events[events.length - 1] as never)
  }

  /** Publish one event of a conversation, for the paths that are not turn ends. */
  function publish(bench: AnalysisBench, session: string, event: unknown): void {
    const target = { id: sessionId(session), snapshotEvents: () => [] } as never
    bench.ctx.emit('session/event', target, event as never)
  }

  it('marks a submitted material analyzed when its turn completes', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await bench.analysis.analyse(id)
    const sent = sentMessage(bench)

    closeTurn(bench, 'dsh-notes-1', sent.id)

    await vi.waitFor(() => { expect(bench.materials.get(id)?.status).toBe('analyzed') })
    expect(bench.materials.get(id)?.error).toBeNull()
  })

  it('marks a material failed with the reason its turn reports', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await bench.analysis.analyse(id)
    const sent = sentMessage(bench)

    closeTurn(bench, 'dsh-notes-1', sent.id, { kind: 'error', error: { message: 'socket closed', code: 'x' } })

    await vi.waitFor(() => { expect(bench.materials.get(id)?.status).toBe('failed') })
    expect(bench.materials.get(id)?.error).toBe('socket closed')
  })

  it('settles only the material the closed turn carried', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const first = await bench.materials.create(material({ noteId: note, text: 'first' }))
    const second = await bench.materials.create(material({ noteId: note, text: 'second' }))
    await bench.analysis.analyse(first)
    const sent = sentMessage(bench)
    await bench.materials.update(second, record => ({ ...record, status: 'analyzing' }))

    closeTurn(bench, 'dsh-notes-1', sent.id)

    await vi.waitFor(() => { expect(bench.materials.get(first)?.status).toBe('analyzed') })
    expect(bench.materials.get(second)?.status).toBe('analyzing')
  })

  it('ignores a turn of a conversation the notes do not drive', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await bench.analysis.analyse(id)
    const sent = sentMessage(bench)

    closeTurn(bench, 'some-other-session', sent.id)
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(bench.materials.get(id)?.status).toBe('analyzing')
  })

  it('leaves a draft alone when a turn closes', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))

    closeTurn(bench, 'dsh-notes-1', 'never-submitted')
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(bench.materials.get(id)?.status).toBe('draft')
  })

  it('ignores every event that is not a turn end', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await bench.analysis.analyse(id)

    publish(bench, 'dsh-notes-1', { seq: 5, type: 'step/end', data: { turn: 1, step: 1 } })
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(bench.materials.get(id)?.status).toBe('analyzing')
  })

  it('reads a turn that carried no identified message as nothing to settle', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await bench.analysis.analyse(id)

    closeTurn(bench, 'dsh-notes-1', null)
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(bench.materials.get(id)?.status).toBe('analyzing')
  })

  it('keeps the material analyzing when the settle cannot read the store', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await bench.analysis.analyse(id)
    const sent = sentMessage(bench)
    vi.spyOn(bench.materials, 'list').mockImplementation(() => { throw new Error('medium down') })

    closeTurn(bench, 'dsh-notes-1', sent.id)
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(bench.materials.get(id)?.status).toBe('analyzing')
  })

  it('keeps the outcome a concurrent settle recorded first', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await bench.analysis.analyse(id)
    const sent = sentMessage(bench)
    // The claim is checked again inside the write: a settle that lost the race
    // sees the winning record and leaves it alone.
    const write = bench.materials.update.bind(bench.materials)
    vi.spyOn(bench.materials, 'update').mockImplementationOnce(async (material, transform) => {
      await write(material, record => ({ ...record, status: 'failed', error: 'settled first' }))
      return await write(material, transform)
    })

    closeTurn(bench, 'dsh-notes-1', sent.id)

    await vi.waitFor(() => { expect(bench.materials.get(id)?.status).toBe('failed') })
    expect(bench.materials.get(id)?.error).toBe('settled first')
  })
})
