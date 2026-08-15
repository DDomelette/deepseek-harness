/** Skills page store: catalog × settings-namespace join with revision-guarded toggles. */
import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { SKILLS_NAMESPACE, SkillsSettingsStore } from '../src/client/store.ts'

/** Test-side brand helper: the wire face re-exports only the SessionId type. */
function sid(id: string): SessionId {
  return id as SessionId
}

const SESSION = sid('sk-store-1')

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(code: string, message: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code: code as never, message, details: {} } } }
}

const SKILLS = [
  { name: 'grouped-a', description: 'Grouped A', group: 'superpowers', source: 'user-dsh', modelInvocable: true, userInvocable: true, disabled: false },
  { name: 'solo-b', description: 'Solo B', source: 'bundled', modelInvocable: false, userInvocable: false, disabled: true },
]

/** The settings.describe value shape this suite's doubles resolve. */
type DescribeResponse = RpcResponse<{
  writable: boolean
  hasDocument: boolean
  namespaces: Array<{ ns: string; value: unknown; revision: number }>
}>

function namespace(revision = 3, disabled: string[] = ['solo-b']): { ns: string; value: { disabled: string[] }; revision: number } {
  return { ns: SKILLS_NAMESPACE, value: { disabled }, revision }
}

function api(overrides: {
  catalog?: (payload: { sessionId: SessionId }) => Promise<RpcResponse<{ skills: typeof SKILLS }>>
  describeSettings?: () => Promise<DescribeResponse>
  updateSettings?: (payload: { ns: string; patch: object; expectedRevision?: number }) => Promise<RpcResponse<unknown>>
} = {}) {
  const catalogs: SessionId[] = []
  const updates: Array<{ ns: string; patch: { disabled: string[] }; expectedRevision?: number }> = []
  const face = {
    skills: {
      catalog: (payload: { sessionId: SessionId }) => {
        catalogs.push(payload.sessionId)
        return (overrides.catalog ?? (() => Promise.resolve(ok({ skills: SKILLS }))))(payload)
      },
    },
    settings: {
      describe: overrides.describeSettings ?? (() => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [namespace()],
      }))),
      update: (payload: { ns: string; patch: { disabled: string[] }; expectedRevision?: number }) => {
        updates.push(payload)
        return (overrides.updateSettings ?? (() => Promise.resolve(ok({}))))(payload)
      },
    },
  }
  return { face: face as never, updates, catalogs }
}

function store(face: never, sessionId: () => SessionId | undefined = () => SESSION): SkillsSettingsStore {
  return new SkillsSettingsStore(face, sessionId)
}

describe('SkillsSettingsStore', () => {
  it('joins the addressed session\'s catalog with the namespace revision and write state', async () => {
    const { face, catalogs } = api()
    const subject = store(face)
    await subject.load()
    expect(catalogs).toEqual([SESSION])
    expect(subject.store.getSnapshot()).toMatchObject({
      status: 'ready',
      skills: SKILLS,
      revision: 3,
      writable: true,
      writing: [],
      noSession: false,
      error: null,
    })
  })

  it('retries when the catalog and settings descriptor observe different enablement revisions', async () => {
    const enabled = SKILLS.map(skill => skill.name === 'solo-b'
      ? { ...skill, modelInvocable: true, userInvocable: true, disabled: false }
      : skill)
    let catalogReads = 0
    const { face, catalogs } = api({
      catalog: () => Promise.resolve(ok({ skills: catalogReads++ === 0 ? SKILLS : enabled })),
      describeSettings: () => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [namespace(4, [])],
      })),
    })
    const subject = store(face)

    await subject.load()

    expect(catalogs).toEqual([SESSION, SESSION])
    expect(subject.store.getSnapshot()).toMatchObject({
      status: 'ready',
      skills: enabled,
      revision: 4,
    })
  })

  it('fails the load when the catalog cannot converge with the settings descriptor', async () => {
    const { face, catalogs } = api({
      describeSettings: () => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [namespace(4, [])],
      })),
    })
    const subject = store(face)

    await subject.load()

    expect(catalogs).toEqual([SESSION, SESSION])
    expect(subject.store.getSnapshot()).toMatchObject({
      status: 'error',
      error: expect.stringContaining('changed while the page was loading') as string,
    })
  })

  it('rejects a malformed disabled list in the skills settings descriptor', async () => {
    const { face } = api({
      describeSettings: () => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [{ ns: SKILLS_NAMESPACE, value: { disabled: 'solo-b' }, revision: 4 }],
      })),
    })
    const subject = store(face)

    await subject.load()

    expect(subject.store.getSnapshot()).toMatchObject({
      status: 'error',
      error: expect.stringContaining('invalid disabled list') as string,
    })
  })

  it('reports a load failure with the catalog error and offers a retryable error state', async () => {
    const { face } = api({ catalog: () => Promise.resolve(fail('internal', 'catalog boom')) })
    const subject = store(face)
    await subject.load()
    expect(subject.store.getSnapshot()).toMatchObject({
      status: 'error',
      error: expect.stringContaining('catalog boom') as string,
    })
  })

  it('serves the no-session posture without fetching the catalog', async () => {
    const { face, catalogs } = api()
    const subject = store(face, () => undefined)
    await subject.load()
    expect(catalogs).toEqual([])
    expect(subject.store.getSnapshot()).toMatchObject({ status: 'ready', skills: [], noSession: true })
  })

  it('records a namespace absence without a revision', async () => {
    const { face } = api({
      describeSettings: () => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [] })),
    })
    const subject = store(face)
    await subject.load()
    expect(subject.store.getSnapshot()).toMatchObject({ status: 'ready', revision: undefined })
  })

  it('reports a settings-describe failure as the page error', async () => {
    const { face } = api({ describeSettings: () => Promise.resolve(fail('internal', 'describe down')) })
    const subject = store(face)
    await subject.load()
    expect(subject.store.getSnapshot()).toMatchObject({
      status: 'error',
      error: expect.stringContaining('describe down') as string,
    })
  })

  it('keeps a superseded load from overwriting the latest state', async () => {
    let releaseDescribe: ((error: Error) => void) | undefined
    const gate = new Promise<DescribeResponse>((_resolve, reject) => { releaseDescribe = reject })
    let describeCalls = 0
    const { face } = api({
      describeSettings: () => {
        describeCalls += 1
        return describeCalls === 1
          ? gate
          : Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [namespace()] }))
      },
    })
    const subject = store(face)
    const stale = subject.load()
    await subject.load()
    releaseDescribe?.(new Error('stale failure'))
    await stale
    // The superseded rejection must not clobber the newest ready state.
    expect(subject.store.getSnapshot()).toMatchObject({ status: 'ready' })
  })

  it('keeps a superseded successful load from overwriting the latest revision', async () => {
    let releaseDescribe: ((value: DescribeResponse) => void) | undefined
    const gate = new Promise<DescribeResponse>((resolve) => { releaseDescribe = resolve })
    let describeCalls = 0
    const { face } = api({
      describeSettings: () => {
        describeCalls += 1
        return describeCalls === 1
          ? gate
          : Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [namespace(7)] }))
      },
    })
    const subject = store(face)
    const stale = subject.load()
    await subject.load()
    releaseDescribe?.(ok({ writable: true, hasDocument: true, namespaces: [namespace()] }))
    await stale
    expect(subject.store.getSnapshot()).toMatchObject({ status: 'ready', revision: 7 })
  })

  it('ignores toggles before the page reached ready', async () => {
    const { face, updates } = api()
    const subject = store(face)
    await subject.setEnabled('grouped-a', false)
    expect(updates).toEqual([])
    expect(subject.store.getSnapshot().status).toBe('idle')
  })

  it('surfaces the unexposed-namespace posture instead of writing', async () => {
    const { face, updates } = api({
      describeSettings: () => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [] })),
    })
    const subject = store(face)
    await subject.load()
    await subject.setEnabled('grouped-a', false)
    expect(updates).toEqual([])
    expect(subject.store.getSnapshot().error).toContain('not exposed')
  })

  it('disables a skill through a revision-guarded write and reloads afterwards', async () => {
    const load = vi.fn(() => Promise.resolve())
    const { face, updates } = api()
    const subject = store(face)
    await subject.load()
    vi.spyOn(subject, 'load').mockImplementation(load)

    await subject.setEnabled('grouped-a', false)

    expect(updates).toEqual([{ ns: SKILLS_NAMESPACE, patch: { disabled: ['solo-b', 'grouped-a'] }, expectedRevision: 3 }])
    expect(load).toHaveBeenCalledOnce()
    expect(subject.store.getSnapshot().writing).toEqual([])
  })

  it('preserves disabled names outside the current session catalog', async () => {
    const { face, updates } = api({
      describeSettings: () => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [namespace(3, ['solo-b', 'other-project-skill'])],
      })),
    })
    const subject = store(face)
    await subject.load()
    vi.spyOn(subject, 'load').mockResolvedValue()

    await subject.setEnabled('grouped-a', false)

    expect(updates).toEqual([{
      ns: SKILLS_NAMESPACE,
      patch: { disabled: ['solo-b', 'other-project-skill', 'grouped-a'] },
      expectedRevision: 3,
    }])
  })

  it('re-enables a skill by removing its name from the disabled list', async () => {
    const { face, updates } = api()
    const subject = store(face)
    await subject.load()
    vi.spyOn(subject, 'load').mockResolvedValue()

    await subject.setEnabled('solo-b', true)

    expect(updates).toEqual([{ ns: SKILLS_NAMESPACE, patch: { disabled: [] }, expectedRevision: 3 }])
  })

  it('marks the write in flight and surfaces a rejection as the page error', async () => {
    const { face } = api({ updateSettings: () => Promise.reject(new Error('transport down')) })
    const subject = store(face)
    await subject.load()

    const pending = subject.setEnabled('grouped-a', false)
    expect(subject.store.getSnapshot().writing).toEqual(['grouped-a'])
    await pending
    expect(subject.store.getSnapshot()).toMatchObject({
      status: 'ready',
      writing: [],
      error: expect.stringContaining('transport down') as string,
    })
  })

  it('renders a non-Error rejection through the same page error', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- deliberately rejects a non-Error to pin the fallback renderer
    const { face } = api({ updateSettings: () => Promise.reject('plain rejection') })
    const subject = store(face)
    await subject.load()

    await subject.setEnabled('grouped-a', false)

    expect(subject.store.getSnapshot().error).toContain('plain rejection')
  })

  it('reloads after a settings-conflict and surfaces the conflict message', async () => {
    const load = vi.fn(() => Promise.resolve())
    const { face } = api({ updateSettings: () => Promise.resolve(fail('settings-conflict', 'moved to revision 9')) })
    const subject = store(face)
    await subject.load()
    vi.spyOn(subject, 'load').mockImplementation(load)

    await subject.setEnabled('grouped-a', false)

    expect(load).toHaveBeenCalledOnce()
    expect(subject.store.getSnapshot().error).toContain('moved to revision 9')
  })
})
