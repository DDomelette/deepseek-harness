/**
 * The notes Remote namespace: one operation per call the panel makes, each
 * answering with the wire vocabulary instead of throwing, so a refusal names
 * the condition that produced it.
 *
 * The operations are thin over the notes services; what this suite pins is the
 * translation — which condition becomes which failure, and which mutation each
 * call performs.
 */
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { Analysis } from '../src/analysis.ts'
import { NotesRemote } from '../src/remote.ts'
import type { ActionDef, Config } from '../src/settings.ts'
import { bench } from './bench.ts'
import type { Bench } from './bench.ts'
import { imageRef, materialId, noteId, noteSession, sessionId, source } from './bench.ts'
import type { MaterialId, NoteSessionId, NotesApplied } from '../src/types.ts'

/** The workspace every fixture conversation is created over. */
const workspace = join('probe-root', 'notes-workspace')

/**
 * Minimal in-memory settings provider. `@deepseek-ai/dsh-settings` exports the
 * abstract `SettingsProvider`, which cannot be mounted itself, and its own
 * `tests/` directory is not part of the package's `exports`, so every consumer
 * spec declares its own.
 */
class MemorySettings extends SettingsProvider {
  private doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

/** The acknowledgment every valueless mutation reports. */
const applied: NotesApplied = { applied: true }

/** The mounted remote bench. */
interface RemoteBench {
  readonly ctx: Bench['ctx']
  readonly base: Bench
  readonly remote: NotesRemote
  /** Every image the stand-in attachment store was asked to keep. */
  readonly saved: Record<string, unknown>[]
  /** Mount the stand-in attachment store, as a deployment with screenshots has. */
  attach(): Promise<void>
  dispose(): Promise<void>
}

let mounted: RemoteBench | undefined

afterEach(async () => {
  if (mounted !== undefined) await mounted.dispose()
  mounted = undefined
})

/**
 * Mount the notes services and the Remote namespace.
 * @param settings - overrides for the composition entry; an omitted key falls
 *   back to the fixture default, and an explicit `undefined` workspace means
 *   "none configured".
 * @returns the mounted bench.
 */
async function mount(settings: {
  readonly strategy?: Config['strategy'] | undefined
  readonly actions?: Config['actions'] | undefined
  readonly workspace?: string | undefined
} = {}): Promise<RemoteBench> {
  // An explicitly supplied `workspace: undefined` means "no workspace
  // configured"; an omitted key keeps the fixture's workspace.
  const cwd = 'workspace' in settings ? settings.workspace : workspace
  const base = await bench({
    strategy: settings.strategy ?? 'manual',
    actions: settings.actions ?? [],
    ...cwd === undefined ? {} : { workspace: cwd },
  })
  await base.ctx.plugin(Analysis).await()
  await base.ctx.plugin(NotesRemote).await()
  const saved: Record<string, unknown>[] = []
  mounted = {
    ctx: base.ctx,
    base,
    remote: base.ctx.notes,
    saved,
    attach: async () => {
      // Stand-in for the deployment's attachment store: the notes Host hands it
      // bytes and keeps only what it returns.
      base.ctx.provide('attachments', {
        saveImage: async (input: Record<string, unknown>) => {
          saved.push(input)
          return {
            attachmentId: 'attachment-1',
            mediaType: input['mediaType'],
            bytes: 3,
            width: 1,
            height: 1,
          }
        },
      } as never)
      await Promise.resolve()
    },
    dispose: async () => { await base.dispose() },
  }
  return mounted
}

/** Record one conversation whose Session this process holds live. */
async function liveConversation(host: RemoteBench, session = 'dsh-notes-1'): Promise<NoteSessionId> {
  host.base.agents.open(session)
  return await host.base.sessions.record(
    noteSession({ sessionId: sessionId(session), title: 'Notes · probe' }),
  )
}

/**
 * Collect one text material over the remote namespace.
 * @param host - the mounted bench.
 * @param note - the conversation that receives it.
 * @param action - the collection action, or null for a plain collection.
 * @returns the new material id.
 */
async function collect(
  host: RemoteBench,
  note: NoteSessionId,
  action: string | null = null,
): Promise<MaterialId> {
  const result = await host.remote.materialAddText({
    noteId: note,
    text: 'body',
    source: source(),
    action,
  })
  if (!result.ok) throw new Error(`collect refused: ${result.error.code}`)
  return result.value.id
}

describe('notes remote sessions', () => {
  it('lists both buckets and the active pointer', async () => {
    const host = await mount()
    const active = await liveConversation(host)
    const archived = await liveConversation(host, 'dsh-notes-2')
    await host.base.sessions.archive(archived)

    const result = host.remote.sessionList()

    expect(result.ok).toBe(true)
    expect(result.ok && result.value.activeId).toBe(active)
    expect(result.ok && result.value.sessions.map(row => row.id)).toEqual([active])
    expect(result.ok && result.value.archived.map(row => row.id)).toEqual([archived])
  })

  it('starts a conversation and makes it active', async () => {
    const host = await mount()

    const result = await host.remote.sessionCreate()

    expect(result.ok).toBe(true)
    const id = result.ok ? result.value.id : undefined
    expect(host.base.sessions.active()).toBe(id)
    expect(host.base.agents.created).toHaveLength(1)
  })

  it('refuses to start a conversation without a workspace', async () => {
    const host = await mount({ workspace: undefined })

    await expect(host.remote.sessionCreate()).resolves.toEqual({
      ok: false,
      error: { code: 'workspace-missing' },
    })

    expect(host.base.agents.created).toEqual([])
  })

  it('points the panel at a listed conversation', async () => {
    const host = await mount()
    const first = await liveConversation(host)
    const second = await liveConversation(host, 'dsh-notes-2')

    await expect(host.remote.sessionSelect({ id: first })).resolves.toEqual({ ok: true, value: applied })

    expect(host.base.sessions.active()).toBe(first)
    expect(host.base.sessions.get(second)).toBeDefined()
  })

  it('refuses to select a conversation that is not recorded', async () => {
    const host = await mount()

    await expect(host.remote.sessionSelect({ id: noteId('absent') })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', id: 'absent' },
    })
  })

  it('archives a conversation and moves the active pointer off it', async () => {
    const host = await mount()
    const first = await liveConversation(host)
    const second = await liveConversation(host, 'dsh-notes-2')
    await host.base.sessions.setActive(first)

    await expect(host.remote.sessionArchive({ id: first })).resolves.toEqual({ ok: true, value: applied })

    expect(host.base.sessions.archived().map(row => row.id)).toEqual([first])
    expect(host.base.sessions.active()).toBe(second)
  })

  it('refuses to archive a conversation that is not recorded', async () => {
    const host = await mount()
    await liveConversation(host)

    await expect(host.remote.sessionArchive({ id: noteId('absent') })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', id: 'absent' },
    })
  })

  it('refuses to archive the last listed conversation', async () => {
    const host = await mount()
    const only = await liveConversation(host)

    await expect(host.remote.sessionArchive({ id: only })).resolves.toEqual({
      ok: false,
      error: { code: 'last-conversation', id: only },
    })

    expect(host.base.sessions.list().map(row => row.id)).toEqual([only])
  })

  it('restores an archived conversation and makes it active', async () => {
    const host = await mount()
    const first = await liveConversation(host)
    const second = await liveConversation(host, 'dsh-notes-2')
    await host.base.sessions.archive(first)

    await expect(host.remote.sessionRestore({ id: first })).resolves.toEqual({ ok: true, value: applied })

    expect(host.base.sessions.list().map(row => row.id).sort()).toEqual([first, second].sort())
    expect(host.base.sessions.active()).toBe(first)
  })

  it('refuses to restore a conversation that is not recorded', async () => {
    const host = await mount()

    await expect(host.remote.sessionRestore({ id: noteId('absent') })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', id: 'absent' },
    })
  })
})

describe('notes remote materials', () => {
  it('lists a conversation with the archived bucket separated', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const kept = await collect(host, note)
    const archived = await collect(host, note)
    await host.base.materials.archive(archived)

    const result = host.remote.materialList({ noteId: note })

    expect(result.ok).toBe(true)
    expect(result.ok && result.value.materials.map(row => row.id)).toEqual([kept])
    expect(result.ok && result.value.materials[0]).toMatchObject({
      noteId: note,
      kind: 'text',
      text: 'body',
      hasImage: false,
      submitted: false,
      action: null,
      status: 'draft',
      error: null,
      archivedAt: null,
    })
    expect(result.ok && result.value.materials[0]?.source.label).toBe('conversation «probe» turn 1')
    expect(result.ok && result.value.archived.map(row => row.id)).toEqual([archived])
  })

  it('refuses to list a conversation that is not recorded', async () => {
    const host = await mount()

    expect(host.remote.materialList({ noteId: noteId('absent') })).toEqual({
      ok: false,
      error: { code: 'session-not-found', id: 'absent' },
    })
  })

  it('collects a material at the top of its conversation as a draft', async () => {
    const host = await mount()
    const note = await liveConversation(host)

    const result = await host.remote.materialAddText({
      noteId: note,
      text: 'collected body',
      source: source({ view: 'trajectory', label: 'tool call «bash»' }),
      action: null,
    })

    expect(result.ok).toBe(true)
    const stored = result.ok ? host.base.materials.get(result.value.id) : undefined
    expect(stored).toMatchObject({
      noteId: note,
      kind: 'text',
      text: 'collected body',
      image: null,
      status: 'draft',
      messageIds: [],
      archivedAt: null,
    })
    expect(stored?.source.view).toBe('trajectory')
    expect(host.base.agents.followup).not.toHaveBeenCalled()
  })

  it('submits a collection the strategy sends on its own', async () => {
    const host = await mount({ strategy: 'auto' })
    const note = await liveConversation(host)

    await collect(host, note)

    expect(host.base.agents.followup).toHaveBeenCalledTimes(1)
  })

  it('leaves a collection alone when the strategy waits and the action does not send', async () => {
    const host = await mount()
    const note = await liveConversation(host)

    await collect(host, note, 'translate')

    expect(host.base.agents.followup).not.toHaveBeenCalled()
  })

  it('submits a collection whose action sends on its own', async () => {
    const translate: ActionDef = {
      id: 'translate',
      label: '翻译',
      prompt: '不改变语句结构，翻译下列内容：',
      autoSend: true,
    }
    const host = await mount({ actions: [translate] })
    const note = await liveConversation(host)

    await collect(host, note, 'translate')

    expect(host.base.agents.followup).toHaveBeenCalledTimes(1)
    const sent = host.base.agents.followup.mock.calls[0]?.[0] as { content: unknown }
    expect(sent.content).toEqual([{ type: 'text', text: '不改变语句结构，翻译下列内容：\nbody' }])
  })

  it('refuses to collect into a conversation that is not recorded', async () => {
    const host = await mount()

    await expect(host.remote.materialAddText({
      noteId: noteId('absent'),
      text: 'body',
      source: source(),
      action: null,
    })).resolves.toEqual({ ok: false, error: { code: 'session-not-found', id: 'absent' } })
  })

  it('stores a screenshot and keeps the reference its store returned', async () => {
    const host = await mount()
    await host.attach()
    const note = await liveConversation(host)

    const result = await host.remote.materialAddImage({
      noteId: note,
      data: Buffer.from([1, 2, 3]).toString('base64'),
      mediaType: 'image/png',
      source: source({ label: 'screenshot' }),
      action: null,
    })

    expect(result.ok).toBe(true)
    const id = result.ok ? result.value.id : undefined
    expect(host.base.materials.get(id as MaterialId)).toMatchObject({
      noteId: note,
      kind: 'image',
      text: null,
      image: imageRef(),
    })
    const listed = host.remote.materialList({ noteId: note })
    expect(listed.ok && listed.value.materials[0]).toMatchObject({ kind: 'image', hasImage: true, text: null })
    // The bytes reach the deployment's store; the material keeps the reference.
    expect(host.saved[0]).toMatchObject({ mediaType: 'image/png' })
  })

  it('submits a screenshot an auto-sending action collects', async () => {
    const translate: ActionDef = {
      id: 'translate',
      label: '翻译',
      prompt: '不改变语句结构，翻译下列内容：',
      autoSend: true,
    }
    const host = await mount({ actions: [translate] })
    await host.attach()
    const note = await liveConversation(host)

    const result = await host.remote.materialAddImage({
      noteId: note,
      data: Buffer.from([1]).toString('base64'),
      mediaType: 'image/png',
      source: source(),
      action: 'translate',
    })

    // The collection lands and the strategy's submission carries the image.
    const id = result.ok ? result.value.id : undefined
    expect(result.ok).toBe(true)
    expect(host.base.agents.followup).toHaveBeenCalledTimes(1)
    const sent = host.base.agents.followup.mock.calls[0]?.[0] as { content: unknown }
    expect(sent.content).toEqual([
      { type: 'text', text: '不改变语句结构，翻译下列内容：' },
      { type: 'image', attachment: imageRef() },
    ])
    expect(host.base.materials.get(id as MaterialId)?.status).toBe('analyzing')
  })

  it('refuses a screenshot into a conversation that is not recorded', async () => {
    const host = await mount()
    await host.attach()

    await expect(host.remote.materialAddImage({
      noteId: noteId('absent'),
      data: Buffer.from([1]).toString('base64'),
      mediaType: 'image/png',
      source: source(),
      action: null,
    })).resolves.toEqual({ ok: false, error: { code: 'session-not-found', id: 'absent' } })
  })

  it('refuses a screenshot while no attachment store is mounted', async () => {
    const host = await mount()
    const note = await liveConversation(host)

    await expect(host.remote.materialAddImage({
      noteId: note,
      data: Buffer.from([1]).toString('base64'),
      mediaType: 'image/png',
      source: source(),
      action: null,
    })).resolves.toEqual({ ok: false, error: { code: 'attachments-unavailable' } })
  })

  it('replaces the body of a draft', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note)

    await expect(host.remote.materialUpdate({ id, text: 'edited' }))
      .resolves.toEqual({ ok: true, value: applied })

    expect(host.base.materials.get(id)?.text).toBe('edited')
  })

  it('refuses to edit a material that is not stored', async () => {
    const host = await mount()

    await expect(host.remote.materialUpdate({ id: materialId('absent'), text: 'edited' })).resolves.toEqual({
      ok: false,
      error: { code: 'material-not-found', id: 'absent' },
    })
  })

  it('refuses to edit a screenshot, which has no text body', async () => {
    const host = await mount()
    await host.attach()
    const note = await liveConversation(host)
    const collected = await host.remote.materialAddImage({
      noteId: note,
      data: Buffer.from([1]).toString('base64'),
      mediaType: 'image/png',
      source: source(),
      action: null,
    })
    const id = collected.ok ? collected.value.id : materialId('absent')

    await expect(host.remote.materialUpdate({ id, text: 'edited' })).resolves.toEqual({
      ok: false,
      error: { code: 'material-not-text', id },
    })

    expect(host.base.materials.get(id)?.text).toBeNull()
  })

  it('refuses to edit a material that already entered its conversation', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note)
    await host.remote.materialAnalyze({ id })

    await expect(host.remote.materialUpdate({ id, text: 'edited' })).resolves.toEqual({
      ok: false,
      error: { code: 'material-submitted', id },
    })

    expect(host.base.materials.get(id)?.text).toBe('body')
    // The listing the panel reads says the same thing the write enforces.
    const listed = host.remote.materialList({ noteId: note })
    expect(listed.ok && listed.value.materials[0]?.submitted).toBe(true)
  })

  it('submits one material for analysis', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note)

    await expect(host.remote.materialAnalyze({ id })).resolves.toEqual({ ok: true, value: applied })

    expect(host.base.materials.get(id)?.status).toBe('analyzing')
  })

  it('reports why a material could not be analysed', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note, 'gone')

    await expect(host.remote.materialAnalyze({ id })).resolves.toEqual({
      ok: false,
      error: { code: 'unknown-action', action: 'gone' },
    })
  })

  it('reports a refused send as a refusal, not as an unreachable Host', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note)
    host.base.agents.followup.mockImplementationOnce(() => { throw new Error('inbox rejected') })

    await expect(host.remote.materialAnalyze({ id })).resolves.toEqual({
      ok: false,
      error: { code: 'submit-refused', id, message: 'inbox rejected' },
    })

    expect(host.base.materials.get(id)?.status).toBe('failed')
  })

  it('keeps an auto-collected material and reports the refused submission', async () => {
    const host = await mount({ strategy: 'auto' })
    const note = await liveConversation(host)
    host.base.agents.followup.mockImplementationOnce(() => { throw new Error('inbox rejected') })

    const added = await host.remote.materialAddText({
      noteId: note,
      text: 'body',
      source: source(),
      action: null,
    })

    expect(added.ok).toBe(false)
    if (added.ok) throw new Error('expected the submission to be refused')
    expect(added.error).toMatchObject({ code: 'submit-refused', message: 'inbox rejected' })
    // The material stays: the reader can see it failed and collect again.
    expect(host.base.materials.list(note)).toHaveLength(1)
    expect(host.base.materials.list(note)[0]?.status).toBe('failed')
  })

  it('reports a refused auto-submission of a collected screenshot too', async () => {
    const host = await mount({ strategy: 'auto' })
    await host.attach()
    const note = await liveConversation(host)
    host.base.agents.followup.mockImplementationOnce(() => { throw new Error('inbox rejected') })

    const added = await host.remote.materialAddImage({
      noteId: note,
      data: Buffer.from([1]).toString('base64'),
      mediaType: 'image/png',
      source: source(),
      action: null,
    })

    expect(added.ok).toBe(false)
    if (added.ok) throw new Error('expected the submission to be refused')
    expect(added.error).toMatchObject({ code: 'submit-refused', message: 'inbox rejected' })
    expect(host.base.materials.list(note)).toHaveLength(1)
  })

  it('analyses a collected screenshot', async () => {
    const host = await mount()
    await host.attach()
    const note = await liveConversation(host)
    const collected = await host.remote.materialAddImage({
      noteId: note,
      data: Buffer.from([1]).toString('base64'),
      mediaType: 'image/png',
      source: source(),
      action: null,
    })
    const id = collected.ok ? collected.value.id : materialId('absent')

    await expect(host.remote.materialAnalyze({ id })).resolves.toEqual({ ok: true, value: applied })

    expect(host.base.materials.get(id)?.status).toBe('analyzing')
    const sent = host.base.agents.followup.mock.calls[0]?.[0] as { content: unknown }
    expect(sent.content).toEqual([{ type: 'image', attachment: imageRef() }])
  })

  it('asks a follow-up inside a material thread', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note)
    await host.remote.materialAnalyze({ id })

    await expect(host.remote.materialAsk({ id, question: 'why?' }))
      .resolves.toEqual({ ok: true, value: applied })

    expect(host.base.agents.followup).toHaveBeenCalledTimes(2)
    expect(host.base.materials.get(id)?.messageIds).toHaveLength(2)
  })

  it('reports a follow-up on an unknown material', async () => {
    const host = await mount()

    await expect(host.remote.materialAsk({ id: materialId('absent'), question: 'why?' })).resolves.toEqual({
      ok: false,
      error: { code: 'material-not-found', id: 'absent' },
    })
  })

  it('refuses a follow-up on a material that has not entered its conversation', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note)

    await expect(host.remote.materialAsk({ id, question: 'why?' })).resolves.toEqual({
      ok: false,
      error: { code: 'material-not-submitted', id },
    })
  })

  it('reads one material\'s own thread', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note)
    await host.remote.materialAnalyze({ id })
    const sent = host.base.agents.followup.mock.calls[0]?.[0] as { id: string }
    host.base.agents.record([
      { seq: 0, type: 'user/message', data: { id: sent.id, role: 'user', content: [{ type: 'text', text: 'body' }] } },
      { seq: 1, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } } },
    ])

    expect(host.remote.materialThread({ id })).toEqual({
      ok: true,
      value: {
        rows: [
          { role: 'user', text: 'body', hasImage: false, seq: 0 },
          { role: 'assistant', text: 'answer', hasImage: false, seq: 1 },
        ],
      },
    })
  })

  it('reports why a thread could not be read', async () => {
    const host = await mount()

    expect(host.remote.materialThread({ id: materialId('absent') })).toEqual({
      ok: false,
      error: { code: 'material-not-found', id: 'absent' },
    })
  })

  it('archives and restores one material', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note)

    await expect(host.remote.materialArchive({ id })).resolves.toEqual({ ok: true, value: applied })

    expect(host.base.materials.archived(note).map(row => row.id)).toEqual([id])

    await expect(host.remote.materialRestore({ id })).resolves.toEqual({ ok: true, value: applied })

    expect(host.base.materials.list(note).map(row => row.id)).toEqual([id])
  })

  it('refuses to archive or restore a material that is not stored', async () => {
    const host = await mount()

    await expect(host.remote.materialArchive({ id: materialId('absent') })).resolves.toEqual({
      ok: false,
      error: { code: 'material-not-found', id: 'absent' },
    })
    await expect(host.remote.materialRestore({ id: materialId('absent') })).resolves.toEqual({
      ok: false,
      error: { code: 'material-not-found', id: 'absent' },
    })
  })

  it('applies a complete manual ordering', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const first = await collect(host, note)
    const second = await collect(host, note)

    await expect(host.remote.materialReorder({ noteId: note, orderedIds: [first, second] }))
      .resolves.toEqual({ ok: true, value: applied })

    expect(host.base.materials.list(note).map(row => row.id)).toEqual([first, second])
  })

  it('refuses to reorder a conversation that is not recorded', async () => {
    const host = await mount()

    await expect(host.remote.materialReorder({ noteId: noteId('absent'), orderedIds: [] })).resolves.toEqual({
      ok: false,
      error: { code: 'session-not-found', id: 'absent' },
    })
  })

  it('refuses to order up a material that is not visible in that conversation', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const other = await liveConversation(host, 'dsh-notes-2')
    await collect(host, note)
    const foreign = await collect(host, other)

    await expect(host.remote.materialReorder({ noteId: note, orderedIds: [foreign] })).resolves.toEqual({
      ok: false,
      error: { code: 'material-not-found', id: foreign },
    })
  })

  it('deletes one material record', async () => {
    const host = await mount()
    const note = await liveConversation(host)
    const id = await collect(host, note)

    await expect(host.remote.materialRemove({ id })).resolves.toEqual({ ok: true, value: applied })

    expect(host.base.materials.get(id)).toBeUndefined()
    expect(host.base.materials.list(note)).toEqual([])
  })

  it('refuses to delete a material that is not stored', async () => {
    const host = await mount()

    await expect(host.remote.materialRemove({ id: materialId('absent') })).resolves.toEqual({
      ok: false,
      error: { code: 'material-not-found', id: 'absent' },
    })
  })
})

describe('notes remote settings', () => {
  it('refuses to read or write the section while no provider is mounted', async () => {
    const host = await mount()

    expect(host.remote.settingsRead()).toEqual({
      ok: false,
      error: { code: 'settings-unavailable' },
    })
    await expect(host.remote.settingsUpdate({ strategy: 'auto' })).resolves.toEqual({
      ok: false,
      error: { code: 'settings-unavailable' },
    })
  })

  it('reads the resolved section and writes one field at a time', async () => {
    const host = await mount()
    await host.ctx.plugin(MemorySettings).await()

    expect(host.remote.settingsRead()).toEqual({
      ok: true,
      value: { strategy: 'manual', actions: [], workspace, model: null },
    })

    await expect(host.remote.settingsUpdate({ model: { provider: 'deepseek', model: 'deepseek-flash' } }))
      .resolves.toEqual({ ok: true, value: applied })
    expect(host.base.settings.model()).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })

    // A named effort is stored, and the read reports it; an absent one reads
    // as null rather than as a missing field.
    await host.remote.settingsUpdate({
      model: { provider: 'deepseek', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
    })
    expect(host.base.settings.model())
      .toEqual({ provider: 'deepseek', model: 'deepseek-v4-pro', reasoningEffort: 'max' })
    expect(host.remote.settingsRead()).toMatchObject({
      ok: true,
      value: { model: { provider: 'deepseek', model: 'deepseek-v4-pro', reasoningEffort: 'max' } },
    })

    await expect(host.remote.settingsUpdate({ model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: null } }))
      .resolves.toEqual({ ok: true, value: applied })
    expect(host.base.settings.model()).toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
    expect(host.remote.settingsRead()).toMatchObject({
      ok: true,
      value: { model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: null } },
    })

    await expect(host.remote.settingsUpdate({ model: null })).resolves.toEqual({ ok: true, value: applied })
    expect(host.base.settings.model()).toBeNull()
  })

  it('carries the collection actions and writes the strategy and workspace', async () => {
    const translate: ActionDef = {
      id: 'translate',
      label: '翻译',
      prompt: '不改变语句结构，翻译下列内容：',
      autoSend: true,
    }
    const host = await mount({ actions: [translate] })
    await host.ctx.plugin(MemorySettings).await()

    const read = host.remote.settingsRead()
    expect(read.ok && read.value.actions).toEqual([translate])

    await expect(host.remote.settingsUpdate({ strategy: 'auto' })).resolves.toEqual({ ok: true, value: applied })
    expect(host.base.settings.strategy()).toBe('auto')

    await expect(host.remote.settingsUpdate({ workspace: '/work/other' })).resolves.toEqual({ ok: true, value: applied })
    expect(host.base.settings.workspace()).toBe('/work/other')

    // Clearing the user value returns the field to the composition entry.
    await expect(host.remote.settingsUpdate({ workspace: null })).resolves.toEqual({ ok: true, value: applied })
    expect(host.base.settings.workspace()).toBe(workspace)
  })

  it('replaces the collection actions through one write, and refuses a list the notes cannot use', async () => {
    const translate: ActionDef = {
      id: 'translate',
      label: '翻译',
      prompt: '不改变语句结构，翻译下列内容：',
      autoSend: true,
    }
    const edited: ActionDef = { ...translate, label: '译', prompt: '翻译下面这段：' }
    const host = await mount({ actions: [translate] })
    await host.ctx.plugin(MemorySettings).await()

    await expect(host.remote.settingsUpdate({ actions: [edited] })).resolves.toEqual({ ok: true, value: applied })
    expect(host.base.settings.actions()).toEqual([edited])

    await expect(host.remote.settingsUpdate({ actions: [{ ...edited, prompt: '   ' }] }))
      .resolves.toEqual({ ok: false, error: { code: 'invalid-actions' } })
    expect(host.base.settings.actions()).toEqual([edited])

    // Clearing the user value returns the list to the composition entry.
    await expect(host.remote.settingsUpdate({ actions: null })).resolves.toEqual({ ok: true, value: applied })
    expect(host.base.settings.actions()).toEqual([translate])
  })
})
