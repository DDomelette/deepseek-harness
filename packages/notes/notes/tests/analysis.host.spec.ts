/**
 * Analysis orchestration: one material becomes one user message on its notes
 * conversation, the submitted message id is recorded, and the status walks
 * draft -> analyzing (or -> failed when the send is refused).
 *
 * Both entry points resolve the conversation's own Session, so a follow-up
 * never lands in the session the material was collected from, and both report
 * why they did not submit instead of throwing.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Analysis } from '../src/analysis.ts'
import { Materials } from '../src/materials.ts'
import { NoteSessions } from '../src/note-sessions.ts'
import type { ActionDef, Config, NotesStrategy } from '../src/settings.ts'
import { bench } from './bench.ts'
import type { Bench, FakeAgents } from './bench.ts'
import { material, messageId, noteId, noteSession, sessionId, source } from './bench.ts'
import type { MaterialId } from '../src/types.ts'

/** The mounted analysis bench. */
interface AnalysisBench {
  readonly ctx: Bench['ctx']
  readonly agents: FakeAgents
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

const config = (actions: ActionDef[], strategy: NotesStrategy = 'manual'): Config =>
  ({ strategy, actions })

/** Mount the notes services and Analysis over the given settings entry. */
async function mount(
  actions: ActionDef[] = [],
  strategy: NotesStrategy = 'manual',
): Promise<AnalysisBench> {
  const base = await bench(config(actions, strategy))
  await base.ctx.plugin(Analysis).await()
  mounted = {
    ctx: base.ctx,
    agents: base.agents,
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
    const translate: ActionDef = {
      id: 'translate',
      label: '翻译',
      prompt: '不改变语句结构，翻译下列内容：',
      autoSend: true,
    }
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

  it('ignores a follow-up on a material that never entered the conversation', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))

    await expect(bench.analysis.ask(id, 'why?')).resolves.toBeNull()

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
