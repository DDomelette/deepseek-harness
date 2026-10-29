// @vitest-environment jsdom
/**
 * Resolving the collection action one material names against the settings
 * section the panel read: the label a row shows, and the action a detail echoes.
 */
import { describe, expect, it } from 'vitest'
import { actionBadge, configuredAction } from '../src/client/actions.ts'
import type { NotesActionView } from '../src/types.ts'

const translate: NotesActionView = {
  id: 'translate',
  label: '翻译',
  prompt: '不改变语句结构，翻译下列内容：',
  autoSend: true,
}
const polish: NotesActionView = { id: 'polish', label: '润色', prompt: '润色：', autoSend: false }

describe('configured action', () => {
  it('resolves the action a material names', () => {
    expect(configuredAction('polish', [translate, polish])).toBe(polish)
  })

  it('resolves nothing for a material that names no action', () => {
    expect(configuredAction(null, [translate])).toBeUndefined()
  })

  it('resolves nothing for an action the configuration dropped', () => {
    expect(configuredAction('gone', [translate])).toBeUndefined()
  })
})

describe('action badge', () => {
  it('carries the stored id and the configured label', () => {
    expect(actionBadge('translate', [translate])).toEqual({ id: 'translate', label: '翻译' })
  })

  it('falls back to the stored id when the configuration dropped the action', () => {
    expect(actionBadge('gone', [translate])).toEqual({ id: 'gone', label: 'gone' })
  })

  it('draws no badge for a material that names no action', () => {
    expect(actionBadge(null, [translate])).toBeNull()
  })
})
