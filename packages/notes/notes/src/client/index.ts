/**
 * Web notes panel, browser half: the right column's notes tab, and the control
 * in the conversation header that brings it back.
 *
 * The panel reaches the Host through `ctx.remote.notes` only — the same
 * operations the Host half publishes, typed by the generated Remote client —
 * and composes UI through slots only. Every other import from a client plugin
 * here is a type.
 * @module @deepseek-ai/dsh-notes/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { NOTES_ID, NOTES_KIND, notesDefinition } from './definition.ts'
import { notesFace } from './face.ts'
import type { NotesButtonInjected } from './NotesButton.tsx'
import { NotesButton } from './NotesButton.tsx'
import { NotesPanel } from './NotesPanel.tsx'
import { createNotesStore } from './store.ts'
import { en, zh } from './locales.ts'

export type { NotesPanelProps } from './NotesPanel.tsx'
export type { NotesButtonProps, NotesButtonInjected } from './NotesButton.tsx'
export type { NotesInjected, NotesRemoteFace } from './face.ts'
export type { NotesState, NotesStore } from './store.ts'
export type { NotesPanelFailure } from './failure-line.ts'
export type { NotesKey } from './locales.ts'
export type { NotesMaterialSummary, NotesSessionSummary } from '../types.ts'

/** This package's copy namespace. */
const NS = 'notes'

/** Required browser services: the tab registry, the slots, copy, and the notes Remote namespace. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.notes']

/**
 * Client plugin body: own the copy, declare the tab type, and register the
 * panel's body and the header control that opens it.
 * @param ctx - client root context carrying the registries, the frame's face, and the Remote.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'notes: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(notesDefinition(t)), 'notes: tab type')

  const store = createNotesStore()
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: NOTES_ID,
    locale: NS,
    store,
    inject: (_sessionId, actions) => notesFace(ctx.remote.notes, actions),
  }, NotesPanel)), 'notes: panel body')

  ctx.effect(() => ctx.slots.inject('conversation.session.header.corner', () => ctx.slots.register({
    name: 'conversation.session.header.corner',
    locale: NS,
    inject: (): NotesButtonInjected => ({
      open: () => { ctx.sidebarRight.openTab(NOTES_KIND) },
    }),
  }, NotesButton)), 'notes: header control')
}
