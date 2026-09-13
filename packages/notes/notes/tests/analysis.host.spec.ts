/**
 * Analysis orchestration: one material becomes one user message on its notes
 * conversation, the submitted message id is recorded, and the status walks
 * draft -> analyzing (or -> failed when the send is refused).
 *
 * Both entry points resolve the conversation's own Session, so a follow-up
 * never lands in the session the material was collected from.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Analysis } from '../src/analysis.ts'
import { Materials } from '../src/materials.ts'
import { NoteSessions } from '../src/note-sessions.ts'
import { NotesSettings } from '../src/settings.ts'
import type { ActionDef, Config } from '../src/settings.ts'
import { NotesStore } from '../src/store.ts'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { material, noteId, noteSession, sessionId } from './bench.ts'
import type { MaterialId } from '../src/types.ts'

/**
 * Stand-in for the agent registry: one live agent per marked session id, and
 * `undefined` for a session this process does not hold.
 */
class LiveAgents {
  /** Records every message handed to a live agent. */
  readonly followup = vi.fn()

  private readonly live = new Set<string>()

  /** Mark one session id live. */
  open(id: string): void {
    this.live.add(id)
  }

  /**
   * Resolve the live agent of one session.
   * @param id - session id.
   * @returns the agent stand-in, or undefined when the session is not live.
   */
  get(id: string): { followup: LiveAgents['followup'] } | undefined {
    return this.live.has(id) ? { followup: this.followup } : undefined
  }
}

/** The mounted analysis bench. */
interface AnalysisBench {
  readonly ctx: Context
  readonly agents: LiveAgents
  readonly analysis: Analysis
  readonly materials: Materials
  readonly sessions: NoteSessions
  dispose(): Promise<void>
}

let mounted: AnalysisBench | undefined
let root: string | undefined

afterEach(async () => {
  if (mounted !== undefined) await mounted.dispose()
  mounted = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const config = (actions: ActionDef[]): Config => ({ strategy: 'manual', actions })

/** Mount the storage stack, the notes services, a live agent, and Analysis. */
async function mount(actions: ActionDef[] = []): Promise<AnalysisBench> {
  root = await mkdtemp(join(tmpdir(), 'dsh-notes-analysis-'))
  const ctx = new Context()
  const agents = new LiveAgents()
  await ctx.plugin(Storage).await()
  await ctx.plugin(StorageJson, { root }).await()
  await ctx.plugin(StorageDomain, { backend: 'json' }).await()
  await ctx.plugin(NotesStore).await()
  await ctx.plugin(Materials).await()
  await ctx.plugin(NoteSessions).await()
  await ctx.plugin(NotesSettings, config(actions)).await()
  ctx.provide('agents', agents as never)
  await ctx.plugin(Analysis).await()
  mounted = {
    ctx,
    agents,
    analysis: ctx.notesAnalysis,
    materials: ctx.notesMaterials,
    sessions: ctx.notesSessions,
    dispose: async () => { await ctx.fiber.dispose() },
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

    await bench.analysis.analyse(id)

    expect(bench.agents.followup).toHaveBeenCalledTimes(1)
    const sent = sentMessage(bench)
    expect(sent.content).toEqual([{ type: 'text', text: 'body' }])
    const stored = bench.materials.get(id)
    expect(stored?.messageIds).toEqual([sent.id])
    expect(stored?.status).toBe('analyzing')
    expect(stored?.error).toBeNull()
  })

  it('leaves a material that already entered the conversation alone', async () => {
    const bench = await mount()
    const note = await liveConversation(bench)
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))

    await bench.analysis.analyse(id)
    await bench.analysis.analyse(id)

    expect(bench.agents.followup).toHaveBeenCalledTimes(1)
  })

  it('ignores an unknown material id', async () => {
    const bench = await mount()
    await expect(bench.analysis.analyse('absent' as MaterialId)).resolves.toBeUndefined()
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

  it('refuses a material whose conversation is not recorded', async () => {
    const bench = await mount()
    const id = await bench.materials.create(material({ noteId: noteId('unrecorded'), text: 'body' }))
    await expect(bench.analysis.analyse(id)).rejects.toThrow(/is not recorded/)
  })

  it('refuses a material whose conversation has no live session', async () => {
    const bench = await mount()
    const note = await bench.sessions.record(noteSession({ sessionId: sessionId('dsh-cold'), title: 'Notes · cold' }))
    const id = await bench.materials.create(material({ noteId: note, text: 'body' }))
    await expect(bench.analysis.analyse(id)).rejects.toThrow(/has no live session/)
  })

  it('asks a follow-up inside the conversation that already answered the material', async () => {
    const bench = await mount()
    const note = await liveConversation(bench, 'dsh-notes-1')
    const id = await bench.materials.create(material({
      noteId: note,
      text: 'body',
      source: { sessionId: sessionId('collected-from'), view: 'chat', seq: 1, messageId: null, callId: null, label: 'l' },
    }))

    await bench.analysis.analyse(id)
    const first = sentMessage(bench)
    await bench.analysis.ask(id, 'why?')

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

    await expect(bench.analysis.ask(id, 'why?')).resolves.toBeUndefined()

    expect(bench.agents.followup).not.toHaveBeenCalled()
  })

  it('ignores a follow-up on an unknown material', async () => {
    const bench = await mount()
    await expect(bench.analysis.ask('absent' as MaterialId, 'why?')).resolves.toBeUndefined()
    expect(bench.agents.followup).not.toHaveBeenCalled()
  })
})
