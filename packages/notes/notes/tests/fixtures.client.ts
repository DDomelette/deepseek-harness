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
import type { PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NotesButtonProps } from '../src/client/NotesButton.tsx'
import { notesFace } from '../src/client/face.ts'
import type { NotesInjected, NotesPaneFace, NotesRemoteFace } from '../src/client/face.ts'
import type { NotesPanelProps } from '../src/client/NotesPanel.tsx'
import type { SelectionBubbleProps } from '../src/client/SelectionBubble.tsx'
import { createNotesStore } from '../src/client/store.ts'
import type {
  MaterialId, MaterialSource, NoteSessionId, NotesMaterialListResult, NotesMaterialSummary,
  NotesMaterialThreadResult, NotesSessionCreateResult, NotesSessionListResult,
  NotesSessionSummary, NotesSettingsReadResult, NotesSettingsView, NotesThreadRow,
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
  submitted: false,
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

/** One successful publication of a thread. */
export function thread(rows: readonly NotesThreadRow[] = []): RemoteResult<NotesMaterialThreadResult> {
  return { ok: true, value: { ok: true, value: { rows } } }
}

/** The answer every valueless write reports when it lands. */
export function applied(): { readonly ok: true; readonly value: { readonly ok: true; readonly value: { readonly applied: true } } } {
  return { ok: true, value: { ok: true, value: { applied: true } } }
}

/** One deployment's notes settings, as the card reads them. */
export function settings(
  overrides: Partial<NotesSettingsView> = {},
): RemoteResult<NotesSettingsReadResult> {
  return { ok: true, value: { ok: true, value: {
    strategy: 'manual',
    actions: [{
      id: 'translate',
      label: '翻译',
      prompt: '不改变语句结构，翻译下列内容：',
      autoSend: true,
    }],
    workspace: '/work/notes',
    model: null,
    writable: true,
    ...overrides,
  } } }
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

/** The scripted Remote face, one mock per operation. */
export interface HarnessRemote {
  readonly sessionList: Mock<NotesRemoteFace['sessionList']>
  readonly sessionCreate: Mock<NotesRemoteFace['sessionCreate']>
  readonly sessionSelect: Mock<NotesRemoteFace['sessionSelect']>
  readonly sessionArchive: Mock<NotesRemoteFace['sessionArchive']>
  readonly sessionRestore: Mock<NotesRemoteFace['sessionRestore']>
  readonly materialList: Mock<NotesRemoteFace['materialList']>
  readonly materialAddText: Mock<NotesRemoteFace['materialAddText']>
  readonly materialAddImage: Mock<NotesRemoteFace['materialAddImage']>
  readonly materialThread: Mock<NotesRemoteFace['materialThread']>
  readonly materialUpdate: Mock<NotesRemoteFace['materialUpdate']>
  readonly materialAnalyze: Mock<NotesRemoteFace['materialAnalyze']>
  readonly materialAsk: Mock<NotesRemoteFace['materialAsk']>
  readonly materialArchive: Mock<NotesRemoteFace['materialArchive']>
  readonly materialRestore: Mock<NotesRemoteFace['materialRestore']>
  readonly materialReorder: Mock<NotesRemoteFace['materialReorder']>
  readonly materialRemove: Mock<NotesRemoteFace['materialRemove']>
  readonly settingsRead: Mock<NotesRemoteFace['settingsRead']>
  readonly settingsUpdate: Mock<NotesRemoteFace['settingsUpdate']>
}

/** What one scripted Harness hands a spec. */
export interface Harness {
  /** The live store instance the panel reads. */
  readonly instance: ReturnType<ReturnType<typeof createNotesStore>['create']>
  /** The command face bound to this instance and the scripted Remote. */
  readonly face: NotesInjected
  /** The scripted Remote face, for assertions and re-scripting. */
  readonly remote: HarnessRemote
  /** The frame operations the panel asks for, recorded. */
  readonly frame: NotesPaneFace & {
    float: Mock<NotesPaneFace['float']>
    dock: Mock<NotesPaneFace['dock']>
  }
  /** Composed props for the panel. */
  readonly props: () => NotesPanelProps
  /** Composed props for the header control. */
  readonly buttonProps: () => NotesButtonProps
  /** Composed props for the selection bubble over one conversation. */
  readonly bubbleProps: (options?: {
    readonly view?: string
    readonly content?: HTMLElement | null
  }) => SelectionBubbleProps
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
  readonly thread?: () => RemoteResult<NotesMaterialThreadResult>
  readonly settings?: () => RemoteResult<NotesSettingsReadResult>
  readonly floating?: boolean
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
    materialAddText: vi.fn<NotesRemoteFace['materialAddText']>(
      async () => ({ ok: true, value: { ok: true, value: { id: materialId('m1') } } }),
    ),
    materialAddImage: vi.fn<NotesRemoteFace['materialAddImage']>(
      async () => ({ ok: true, value: { ok: true, value: { id: materialId('m2') } } }),
    ),
    materialThread: vi.fn<NotesRemoteFace['materialThread']>(
      async () => script.thread?.() ?? thread(),
    ),
    sessionSelect: vi.fn<NotesRemoteFace['sessionSelect']>(async () => applied()),
    sessionArchive: vi.fn<NotesRemoteFace['sessionArchive']>(async () => applied()),
    sessionRestore: vi.fn<NotesRemoteFace['sessionRestore']>(async () => applied()),
    materialUpdate: vi.fn<NotesRemoteFace['materialUpdate']>(async () => applied()),
    materialAnalyze: vi.fn<NotesRemoteFace['materialAnalyze']>(async () => applied()),
    materialAsk: vi.fn<NotesRemoteFace['materialAsk']>(async () => applied()),
    materialArchive: vi.fn<NotesRemoteFace['materialArchive']>(async () => applied()),
    materialRestore: vi.fn<NotesRemoteFace['materialRestore']>(async () => applied()),
    materialReorder: vi.fn<NotesRemoteFace['materialReorder']>(async () => applied()),
    materialRemove: vi.fn<NotesRemoteFace['materialRemove']>(async () => applied()),
    settingsRead: vi.fn<NotesRemoteFace['settingsRead']>(
      async () => script.settings?.() ?? settings(),
    ),
    settingsUpdate: vi.fn<NotesRemoteFace['settingsUpdate']>(async () => applied()),
  }
  const frame = { float: vi.fn<NotesPaneFace['float']>(), dock: vi.fn<NotesPaneFace['dock']>() }
  const face = notesFace(remote, frame, instance.actions)
  const tabActions = { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() }
  const controller = new AbortController()
  const useTabInfo = () => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1' as PaneId, floating: script.floating ?? false },
    tab: {
      id: 'tab-1' as TabId,
      kind: 'notes',
      contentId: 'sidebar://notes',
      title: 'notes',
      visible: true,
      navigation: { address: 'sidebar://notes', params: undefined, revision: 1 },
      signal: controller.signal,
      actions: tabActions,
    },
  })
  // Composed props are built once and reused: a spec spies on one of their
  // commands, and the component has to receive the object that spy belongs to.
  let panelProps: NotesPanelProps | undefined
  let controlProps: NotesButtonProps | undefined
  return {
    instance,
    face,
    remote,
    frame,
    props: () => panelProps ??= ({
      useTabInfo,
      sessionId: SESSION,
      useStore: hookOf(instance),
      actions: instance.actions,
      load: face.load,
      refresh: face.refresh,
      createConversation: face.createConversation,
      openSession: face.openSession,
      archiveSession: face.archiveSession,
      restoreSession: face.restoreSession,
      select: face.select,
      saveText: face.saveText,
      analyze: face.analyze,
      ask: face.ask,
      archive: face.archive,
      restore: face.restore,
      reorder: face.reorder,
      present: face.present,
      readSettings: face.readSettings,
      saveSettings: face.saveSettings,
      collect: face.collect,
      addImage: face.addImage,
      remove: face.remove,
      t,
    }) as unknown as NotesPanelProps,
    buttonProps: () => controlProps ??= ({
      sessionId: SESSION,
      open: vi.fn(),
      t,
    }) as unknown as NotesButtonProps,
    bubbleProps: (options = {}) => ({
      sessionId: SESSION,
      view: options.view ?? 'chat',
      content: options.content ?? null,
      useStore: hookOf(instance),
      actions: instance.actions,
      readSettings: face.readSettings,
      saveSettings: face.saveSettings,
      collect: face.collect,
      t,
    }) as unknown as SelectionBubbleProps,
  }
}
