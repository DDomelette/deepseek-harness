/**
 * Body composition: an action prepends its prompt template to the material,
 * and resolving the action a material names is what tells a caller whether the
 * current configuration still offers it.
 */
import { describe, expect, it } from 'vitest'
import { actionFor, composeBody } from '../src/compose.ts'
import type { ActionDef } from '../src/settings.ts'
import { material, noteId } from './bench.ts'

const translate: ActionDef = {
  id: 'translate',
  label: '翻译',
  prompt: '不改变语句结构，翻译下列内容：',
  autoSend: true,
}

describe('action resolution', () => {
  it('resolves the action a material names', () => {
    expect(actionFor('translate', [translate])).toBe(translate)
  })

  it('resolves nothing for a material that names no action', () => {
    expect(actionFor(null, [translate])).toBeUndefined()
  })

  it('resolves nothing for an action the configuration no longer offers', () => {
    expect(actionFor('gone', [translate])).toBeUndefined()
  })
})

describe('body composition', () => {
  it('returns the material text unchanged without an action', () => {
    expect(composeBody(material({ noteId: noteId('n1'), text: 'body' }), undefined)).toBe('body')
  })

  it('prepends the action prompt template', () => {
    const stored = material({ noteId: noteId('n1'), text: 'body', action: 'translate' })
    expect(composeBody(stored, translate)).toBe('不改变语句结构，翻译下列内容：\nbody')
  })

  it('reads a text-less material as an empty body', () => {
    expect(composeBody(material({ noteId: noteId('n1'), text: null }), undefined)).toBe('')
  })
})
