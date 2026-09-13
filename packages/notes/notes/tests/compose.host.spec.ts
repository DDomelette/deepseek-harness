/**
 * Body composition: an action prepends its prompt template to the material.
 */
import { describe, expect, it } from 'vitest'
import { composeBody } from '../src/compose.ts'
import type { ActionDef } from '../src/settings.ts'
import { material, noteId } from './bench.ts'

const translate: ActionDef = {
  id: 'translate',
  label: '翻译',
  prompt: '不改变语句结构，翻译下列内容：',
  autoSend: true,
}

describe('body composition', () => {
  it('returns the material text unchanged without an action', () => {
    expect(composeBody(material({ noteId: noteId('n1'), text: 'body' }), [])).toBe('body')
  })

  it('prepends the action prompt template', () => {
    const stored = material({ noteId: noteId('n1'), text: 'body', action: 'translate' })
    expect(composeBody(stored, [translate])).toBe('不改变语句结构，翻译下列内容：\nbody')
  })

  it('reads a text-less material as an empty body', () => {
    expect(composeBody(material({ noteId: noteId('n1'), text: null }), [])).toBe('')
  })

  it('throws for an action that is no longer configured', () => {
    const stored = material({ noteId: noteId('n1'), action: 'gone' })
    expect(() => composeBody(stored, [])).toThrow(/unknown action/)
  })
})
