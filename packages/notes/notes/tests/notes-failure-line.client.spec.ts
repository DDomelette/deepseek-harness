/**
 * The failure line each Host refusal deserves, and what the panel reports for
 * a carrier failure that names no notes condition.
 */
import { describe, expect, it } from 'vitest'
import { failureLine } from '../src/client/failure-line.ts'
import type { NotesPanelFailure } from '../src/client/failure-line.ts'
import { t } from './fixtures.client.ts'

const line = (failure: NotesPanelFailure): string => failureLine(t, failure)

describe('notes failure lines', () => {
  it('names each Host refusal in the reader\'s terms', () => {
    expect(line({ code: 'session-not-found', id: 'n1' as never })).toBe('error.sessionNotFound')
    expect(line({ code: 'material-not-found', id: 'm1' as never })).toBe('error.materialNotFound')
    expect(line({ code: 'material-submitted', id: 'm1' as never })).toBe('error.materialSubmitted')
    expect(line({ code: 'material-not-submitted', id: 'm1' as never })).toBe('error.materialNotSubmitted')
    expect(line({ code: 'workspace-missing' })).toBe('error.workspaceMissing')
    expect(line({ code: 'last-conversation', id: 'n1' as never })).toBe('error.lastConversation')
    expect(line({ code: 'session-not-live', id: 'n1' as never })).toBe('error.sessionNotLive')
    expect(line({ code: 'unknown-action', action: 'translate' })).toBe('error.unknownAction')
    expect(line({ code: 'settings-unavailable' })).toBe('error.settingsUnavailable')
    expect(line({ code: 'attachments-unavailable' })).toBe('error.attachmentsUnavailable')
  })

  it('names the two image refusals the panel makes on its own', () => {
    expect(line({ code: 'image-unsupported' })).toBe('error.imageUnsupported')
    expect(line({ code: 'image-unreadable' })).toBe('error.imageUnreadable')
  })

  it('carries the transport message a carrier failure brings', () => {
    expect(line({ code: 'remote-unavailable', message: 'socket closed' }))
      .toBe('error.remoteUnavailable(message=socket closed)')
  })
})
