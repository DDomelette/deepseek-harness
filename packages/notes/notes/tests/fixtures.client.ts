/**
 * Shared harness for the browser-half specs: a real store instance, a real
 * command face over a scripted Host, and the composed props a panel or button
 * receives.
 *
 * The framework's standard kit is replaced by the few members these components
 * read, behind one documented cast, so the specs exercise the panel and not the
 * slot runtime.
 */
import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NotesButtonProps } from '../src/client/NotesButton.tsx'
import { notesFace } from '../src/client/face.ts'
import type { NotesInjected, NotesRemoteFace } from '../src/client/face.ts'
import type { NotesPanelProps } from '../src/client/NotesPanel.tsx'
import { createNotesStore } from '../src/client/store.ts'
import type {
  MaterialId, MaterialSource, NoteSessionId, NotesMaterialListResult, NotesMaterialSummary,
  NotesSessionCreateResult, NotesSessionListResult, NotesSessionSummary,
} from '../src/types.ts'

/** The session the panel is mounted beside. */
export const SESSION = brandString<SessionId>('s-1')

/** Brand one conversation id. */
export const noteId = (value: string): NoteSessionId => brandString<NoteSessionId>(value)

/** Brand one material id. */
export const materialId = (value: string): MaterialId => brandString<MaterialId>(value)

/** One collection source stamp. */
export const source = (overrides: Partial<MaterialSource> = {}): MaterialSource => ({
  sessionId: SESSION,
  view: 'chat',
  seq: null,
  messageId: null,
  callId: null,
  label: 'conversation «probe»',
  ...overrides,
})

/** One conversation as the Host lists it. */
export const sessionSummary = (overrides: Partial<NotesSessionSummary> = {}): NotesSessionSummary => ({
  id: noteId('n1'),
  sessionId: SESSION,
  title: 'Notes · probe',
  createdAt: 0,
  archivedAt: null,
  ...overrides,
})

/** One material as the Host lists it. */
export const materialSummary = (overrides: Partial<NotesMaterialSummary> = {}): NotesMaterialSummary => ({
  id: materialId('m1'),
  noteId: noteId('n1'),
  kind: 'text',
  text: 'body',
  hasImage: false,
  source: source(),
  action: null,
  order: 0,
  status: 'draft',
  error: null,
  createdAt: 0,
  archivedAt: null,
  ...overrides,
})

/** One successful conversation listing. */
export function sessions(
  listed: readonly NotesSessionSummary[] = [],
  archived: readonly NotesSessionSummary[] = [],
  activeId: NoteSessionId | null = listed[0]?.id ?? null,
): RemoteResult<NotesSessionListResult> {
  return { ok: true, value: { ok: true, value: { sessions: listed, archived, activeId } } }
}

/** One successful material listing. */
export function materials(
  listed: readonly NotesMaterialSummary[] = [],
  archived: readonly NotesMaterialSummary[] = [],
): RemoteResult<NotesMaterialListResult> {
  return { ok: true, value: { ok: true, value: { materials: listed, archived } } }
}

/** One successful conversation start. */
export function created(id = noteId('n1')): RemoteResult<NotesSessionCreateResult> {
  return { ok: true, value: { ok: true, value: { id } } }
}

/** One carrier failure, as the Remote face delivers it. */
export function unavailable(message = 'socket closed'): RemoteFailure {
  return { code: 'gateway/internal', message, name: 'RemoteError' } as unknown as RemoteFailure
}

/** Key-echoing translate that also shows its parameters. */
export function t(key: string, params?: Record<string, unknown>): string {
  return params === undefined
    ? key
    : `${key}(${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(',')})`
}

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(instance: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(select: (state: T) => S): S {
    return select(useSyncExternalStore(instance.subscribe, instance.getSnapshot))
  }
}

/** What one scripted Harness hands a spec. */
export interface Harness {
  /** The live store instance the panel reads. */
  readonly instance: ReturnType<ReturnType<typeof createNotesStore>['create']>
  /** The command face bound to this instance and the scripted Remote. */
  readonly face: NotesInjected
  /** The scripted Remote face, for assertions and re-scripting. */
  readonly remote: NotesRemoteFace & {
    sessionList: Mock<NotesRemoteFace['sessionList']>
    sessionCreate: Mock<NotesRemoteFace['sessionCreate']>
    materialList: Mock<NotesRemoteFace['materialList']>
  }
  /** Composed props for the panel. */
  readonly props: () => NotesPanelProps
  /** Composed props for the header control. */
  readonly buttonProps: () => NotesButtonProps
}

/**
 * One panel's harness over a scripted Host.
 * @param script - what each Remote operation answers; defaults are one empty listing.
 * @returns the store instance, the command face, and props builders.
 */
export function harness(script: {
  readonly sessions?: () => RemoteResult<NotesSessionListResult>
  readonly materials?: () => RemoteResult<NotesMaterialListResult>
  readonly create?: () => RemoteResult<NotesSessionCreateResult>
} = {}): Harness {
  const instance = createNotesStore().create()
  const remote = {
    sessionList: vi.fn<NotesRemoteFace['sessionList']>(
      async () => script.sessions?.() ?? sessions(),
    ),
    sessionCreate: vi.fn<NotesRemoteFace['sessionCreate']>(
      async () => script.create?.() ?? created(),
    ),
    materialList: vi.fn<NotesRemoteFace['materialList']>(
      async () => script.materials?.() ?? materials(),
    ),
  }
  const face = notesFace(remote, instance.actions)
  const tabActions = { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() }
  const controller = new AbortController()
  const useTabInfo = () => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1' },
    tab: {
      id: 'tab-1',
      kind: 'notes',
      contentId: 'sidebar://notes',
      title: 'notes',
      visible: true,
      navigation: { address: 'sidebar://notes', params: undefined, revision: 1 },
      signal: controller.signal,
      actions: tabActions,
    },
  })
  return {
    instance,
    face,
    remote,
    props: () => ({
      useTabInfo,
      sessionId: SESSION,
      useStore: hookOf(instance),
      actions: instance.actions,
      load: face.load,
      refresh: face.refresh,
      createConversation: face.createConversation,
      t,
    }) as unknown as NotesPanelProps,
    buttonProps: () => ({
      sessionId: SESSION,
      open: vi.fn(),
      t,
    }) as unknown as NotesButtonProps,
  }
}
